#!/usr/bin/env node
// Imports/syncs Agency Agents (https://github.com/msitarzewski/agency-agents, MIT)
// agent definitions from a LOCAL checkout into agent_definitions.
//
// We never vendor that repository into this one: clone it yourself, then run
// this script against the checkout. Re-running is safe (idempotent, skips
// rows a human has since customized).
//
// Usage:
//   git clone --depth 1 https://github.com/msitarzewski/agency-agents /tmp/agency-agents
//   DATABASE_URL=postgres://... node scripts/import-agency-agents.mjs \
//     --source /tmp/agency-agents [--division security --division engineering] [--limit 20]
//
// Mirrors scripts/migrate.mjs: self-contained (no app bootstrap), talks to
// Postgres directly so it can run against Supabase from any machine.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';

const NON_DIVISION_DIRS = new Set(['integrations', 'strategy', 'examples', 'scripts', '.git', 'node_modules']);

function parseArgs(argv) {
  const out = { divisions: [], limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--division') out.divisions.push(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
  }
  return out;
}

// ── pure parsing (kept in sync with src/server/registry/import-agency.ts) ──
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { fields: {}, body: raw };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fields[kv[1]] = value;
  }
  return { fields, body: m[2] };
}
function sections(body) {
  const out = new Map();
  let current = null;
  let buf = [];
  const flush = () => {
    if (current) out.set(current, buf.join('\n').trim());
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      current = h[1].replace(/[^\p{L}\p{N} &/-]/gu, '').trim().toLowerCase();
    } else if (current) buf.push(line);
  }
  flush();
  return out;
}
function findSection(map, ...needles) {
  for (const [heading, text] of map) if (needles.some((n) => heading.includes(n))) return text;
  return '';
}
function bullets(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}
function parseAgencyAgentFile(division, filename, raw) {
  const { fields, body } = parseFrontmatter(raw);
  const secs = sections(body);
  const name = fields.name || filename.replace(/\.md$/, '');
  const base = filename.replace(/\.md$/, '');
  const prefix = `${division}-`;
  const slugBase = base.startsWith(prefix) ? base.slice(prefix.length) : base;
  const slug = slugBase.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
  return {
    slug: slug.length > 1 && /^[a-z]/.test(slug) ? slug : `a-${slug}`,
    name,
    description: fields.description || '',
    identity: findSection(secs, 'identity'),
    mission: findSection(secs, 'mission', 'objective'),
    workflows: bullets(findSection(secs, 'workflow')),
    deliverables: findSection(secs, 'deliverable'),
    instructions: body.trim(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !existsSync(args.source)) {
    console.error('Usage: node scripts/import-agency-agents.mjs --source <path-to-local-clone> [--division x] [--limit n]');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: args.source }).toString().trim();
  } catch {
    // not a git checkout (e.g. a tarball extract) — keep 'unknown'
  }

  const divisions = (args.divisions.length ? args.divisions : readdirSync(args.source, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)).filter(
    (d) => !NON_DIVISION_DIRS.has(d),
  );

  const files = [];
  for (const division of divisions) {
    const dir = `${args.source}/${division}`;
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      if (files.length >= args.limit) break;
      files.push({ division, filename, content: readFileSync(`${dir}/${filename}`, 'utf8') });
    }
  }
  console.log(`Parsing ${files.length} agent definitions from ${divisions.length} divisions…`);

  const client = new pg.Client({ connectionString: url, ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined });
  await client.connect();

  const summary = { created: 0, updated: 0, 'skipped-customized': 0, unchanged: 0, error: 0 };
  for (const f of files) {
    try {
      const parsed = parseAgencyAgentFile(f.division, f.filename, f.content);
      const source_hash = createHash('sha256').update(f.content).digest('hex');
      const existing = await client.query('select id, customized, source_hash from agent_definitions where slug=$1', [parsed.slug]);
      if (!existing.rows[0]) {
        await client.query(
          `insert into agent_definitions
            (slug, name, description, division, identity, mission, workflows, deliverables, instructions,
             source, source_repo, source_path, source_version, source_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'agency-agents',$10,$11,$12,$13)`,
          [
            parsed.slug,
            parsed.name,
            parsed.description,
            f.division,
            parsed.identity,
            parsed.mission,
            JSON.stringify(parsed.workflows),
            parsed.deliverables,
            parsed.instructions,
            'https://github.com/msitarzewski/agency-agents',
            `${f.division}/${f.filename}`,
            commit,
            source_hash,
          ],
        );
        summary.created++;
      } else if (existing.rows[0].customized) {
        summary['skipped-customized']++;
      } else if (existing.rows[0].source_hash === source_hash) {
        summary.unchanged++;
      } else {
        await client.query(
          `update agent_definitions set name=$2, description=$3, division=$4, identity=$5, mission=$6, workflows=$7,
              deliverables=$8, instructions=$9, source_path=$10, source_version=$11, source_hash=$12, customized=false
            where id=$1`,
          [
            existing.rows[0].id,
            parsed.name,
            parsed.description,
            f.division,
            parsed.identity,
            parsed.mission,
            JSON.stringify(parsed.workflows),
            parsed.deliverables,
            parsed.instructions,
            `${f.division}/${f.filename}`,
            commit,
            source_hash,
          ],
        );
        summary.updated++;
      }
    } catch (e) {
      console.error(`  ✗ ${f.division}/${f.filename}: ${e.message}`);
      summary.error++;
    }
  }
  await client.end();
  console.log('Done:', summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
