/**
 * The 6 native security skills (seeded in 0005) are upgraded by 0006's
 * successor migration to the same explicit operational contract used by the
 * imported AgentSkills pack (states, checklist, evidence requirements) —
 * "mejorar las skills actuales para que las IAs actúen mejor". Only
 * `instructions` changes; slug/category/security_level stay put so nothing
 * that references these skills by slug breaks.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { getSkillDefinitionBySlug } from '@/server/registry/skill-definitions';

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

const NATIVE_SKILLS = ['api-security', 'owasp', 'authentication', 'authorization', 'idor', 'reporting'];

describe('native security skills improvement (0007)', () => {
  beforeEach(fresh, 30_000);

  it.each(NATIVE_SKILLS)('%s keeps its identity (slug/category/security_level) but gains an explicit operational contract', async (slug) => {
    const row = await getSkillDefinitionBySlug(db, slug);
    expect(row).not.toBeNull();
    expect(row!.category).toBe('security');
    expect(row!.instructions).toContain('Contrato operacional');
    expect(row!.instructions).toContain('Policy Engine');
    expect(row!.instructions).toMatch(/### Estados|## Estados/);
  });

  it('reporting keeps its "never report an unreproduced finding" rule', async () => {
    const row = await getSkillDefinitionBySlug(db, 'reporting');
    expect(row!.instructions).toMatch(/nunca .*reproducid|no se reporta/i);
  });
});
