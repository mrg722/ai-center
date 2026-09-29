import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from '../db';
import { upsertImportedAgentDefinition } from './agent-definitions';
import type { AgentDefinitionRow } from './types';

/**
 * Agency Agents importer/normalizer (Fase 1 / Fase 19).
 *
 * Source format (https://github.com/msitarzewski/agency-agents, MIT):
 *   <division>/<division>-<slug>.md
 *   ---
 *   name: ...
 *   description: ...
 *   color: "#..."
 *   emoji: ...
 *   vibe: ...
 *   ---
 *   # Title
 *   ## <heading with "Identity">   → identity
 *   ## <heading with "Mission">    → mission
 *   ## <heading with "Workflow">   → workflows (one entry per bullet)
 *   ## <heading with "Deliverable">→ deliverables
 *   (full body)                   → instructions
 *
 * We do NOT vendor the source repository into this codebase. This module
 * only normalizes a file's *content* (passed in as text) into our internal
 * AgentDefinition shape; scripts/import-agency-agents.mjs reads files from a
 * local checkout and calls this per file.
 */

export interface ParsedAgencyFile {
  slug: string;
  name: string;
  description: string;
  identity: string;
  mission: string;
  workflows: string[];
  deliverables: string;
  instructions: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[kv[1]] = value;
  }
  return { fields, body: m[2] };
}

/** Splits the markdown body into `## heading` sections, keyed by lowercased heading text. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) out.set(current, buf.join('\n').trim());
    buf = [];
  };
  for (const line of lines) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      current = h[1].replace(/[^\p{L}\p{N} &/-]/gu, '').trim().toLowerCase();
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function findSection(map: Map<string, string>, ...needles: string[]): string {
  for (const [heading, text] of map) {
    if (needles.some((n) => heading.includes(n))) return text;
  }
  return '';
}

function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

/** Parses one Agency Agents markdown file's raw text into our normalized shape. */
export function parseAgencyAgentFile(division: string, filename: string, raw: string): ParsedAgencyFile {
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

export interface ImportSourceFile {
  division: string;
  filename: string;
  content: string;
}

export interface ImportResult {
  slug: string;
  division: string;
  action: 'created' | 'updated' | 'skipped-customized' | 'unchanged' | 'error';
  error?: string;
}

/**
 * Imports a batch of already-read files (caller reads them from a local
 * checkout — see scripts/import-agency-agents.mjs). `sourceVersion` is the
 * upstream commit (short hash) the checkout is pinned to, stored for
 * diff/rollback per file.
 */
export async function importAgencyAgentFiles(
  db: Db,
  files: ImportSourceFile[],
  opts: { sourceRepo: string; sourceVersion: string },
): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const f of files) {
    try {
      const parsed = parseAgencyAgentFile(f.division, f.filename, f.content);
      const source_hash = createHash('sha256').update(f.content).digest('hex');
      const { action } = await upsertImportedAgentDefinition(db, {
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        division: f.division,
        identity: parsed.identity,
        mission: parsed.mission,
        workflows: parsed.workflows,
        deliverables: parsed.deliverables,
        instructions: parsed.instructions,
        source: 'agency-agents',
        source_repo: opts.sourceRepo,
        source_path: `${f.division}/${f.filename}`,
        source_version: opts.sourceVersion,
        source_hash,
      });
      out.push({ slug: parsed.slug, division: f.division, action });
    } catch (e) {
      out.push({ slug: f.filename, division: f.division, action: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function summarizeImport(results: ImportResult[]): Record<ImportResult['action'], number> {
  const summary: Record<ImportResult['action'], number> = { created: 0, updated: 0, 'skipped-customized': 0, unchanged: 0, error: 0 };
  for (const r of results) summary[r.action]++;
  return summary;
}

export type { AgentDefinitionRow };
