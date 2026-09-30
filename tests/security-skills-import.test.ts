/**
 * The 5 complete skills from the user-provided "AI_Center_Security_Skills_v2"
 * package (AgentSkills format) are seeded verbatim by
 * supabase/migrations/0006_seed_agentskills_security_pack.sql. This asserts
 * they're actually inserted, resolvable through the normal Chat Skill
 * Selection path, and that their `instructions` are byte-for-byte identical
 * to the source SKILL.md files (never modified, per explicit requirement).
 * `john-the-ripper-hash-audit` is intentionally absent: the source package
 * only ships its references/SOURCES.md, no SKILL.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { getSkillDefinitionBySlug, resolveChatSkills } from '@/server/registry/skill-definitions';

let db: Db;

async function fresh() {
  __setDb(undefined);
  process.env.PGLITE_DIR = 'memory';
  delete process.env.DATABASE_URL;
  db = await getDb();
  await runSetup(db, {
    email: 'mod@example.com',
    display_name: 'Mar',
    password: 'a-very-long-password',
    project_name: 'Demo',
    project_key: 'DF',
    repo: 'acme/web',
    default_branch: 'main',
  });
}

const IMPORTED = [
  { slug: 'feroxbuster-content-discovery', security_level: 'elevated', required_tools: ['feroxbuster'] },
  { slug: 'ffuf-web-fuzzing', security_level: 'elevated', required_tools: ['ffuf'] },
  { slug: 'hashcat-password-audit', security_level: 'standard', required_tools: ['hashcat'] },
  { slug: 'impacket-windows-ad-audit', security_level: 'restricted', required_tools: ['python3', 'impacket'] },
  { slug: 'metasploit-controlled-validation', security_level: 'restricted', required_tools: ['msfconsole'] },
] as const;

describe('AI_Center_Security_Skills_v2 import', () => {
  beforeEach(fresh, 30_000);

  it.each(IMPORTED)('$slug is seeded, enabled, and matches its source SKILL.md verbatim', async ({ slug, security_level, required_tools }) => {
    const row = await getSkillDefinitionBySlug(db, slug);
    expect(row).not.toBeNull();
    expect(row!.enabled).toBe(true);
    expect(row!.category).toBe('security');
    expect(row!.security_level).toBe(security_level);
    expect(row!.required_tools).toEqual(required_tools);

    const src = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'security-skills-v2', slug, 'SKILL.md'), 'utf8');
    expect(row!.instructions).toBe(src);
  });

  it('john-the-ripper-hash-audit is not present (incomplete in the source package — never fabricated)', async () => {
    expect(await getSkillDefinitionBySlug(db, 'john-the-ripper-hash-audit')).toBeNull();
  });

  it('the imported skills are usable through Chat Skill Selection', async () => {
    const resolved = await resolveChatSkills(db, ['feroxbuster-content-discovery', 'metasploit-controlled-validation']);
    expect(resolved.map((s) => s.slug).sort()).toEqual(['feroxbuster-content-discovery', 'metasploit-controlled-validation']);
  });
});
