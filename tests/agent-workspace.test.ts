/**
 * Agent Workspace pipeline (Bloque 8): an Agent Definition linked to an
 * executable agent actually shapes what the Context Engine hands the model
 * — identity/mission + only its SELECTED skills' instructions. This is the
 * real "Security Engineer + api-security + owasp + memory + LLM" wiring
 * from docs/ARCHITECTURE_AI_PLATFORM.md § 1, not just a UI mock.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject, getAgentBySlug } from '@/server/orchestrator/repo';
import { buildContext } from '@/server/orchestrator/context';
import { createAgentDefinition, setDefinitionSkills } from '@/server/registry/agent-definitions';
import { createSkillDefinition } from '@/server/registry/skill-definitions';
import type { ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;

async function fresh() {
  __setDb(undefined);
  process.env.PGLITE_DIR = 'memory';
  delete process.env.DATABASE_URL;
  db = await getDb();
  const s = await runSetup(db, {
    email: 'mod@example.com',
    display_name: 'Mar',
    password: 'a-very-long-password',
    project_name: 'Demo',
    project_key: 'DF',
    repo: 'acme/web',
    default_branch: 'main',
  });
  project = await requireProject(db, s.userId);
}

describe('agent workspace: definition → skills → context', () => {
  beforeEach(fresh, 30_000);

  it('an agent linked to a definition receives its identity/mission and ONLY its selected skills', async () => {
    const idor = await createSkillDefinition(db, { slug: 'ws-idor', name: 'IDOR Testing', category: 'security', instructions: 'Test object-level authorization on every endpoint.' });
    await createSkillDefinition(db, { slug: 'ws-unrelated', name: 'Totally Unrelated Skill', category: 'design', instructions: 'Never appears for this agent.' });

    const definition = await createAgentDefinition(db, {
      slug: 'ws-security-engineer',
      name: 'Security Engineer',
      division: 'security',
      identity: 'Senior application security engineer, skeptical of defaults.',
      mission: 'Find and prove real vulnerabilities before attackers do.',
    });
    await setDefinitionSkills(db, definition.id, [{ skillId: idor.id }]);

    const claude = (await getAgentBySlug(db, project.id, 'claude'))!;
    await db.query('update agents set agent_definition_id=$2 where id=$1', [claude.id, definition.id]);
    const linked = (await getAgentBySlug(db, project.id, 'claude'))!;
    expect(linked.agent_definition_id).toBe(definition.id);

    const ctx = await buildContext(db, { project, agent: linked, task: null, incoming: null });
    expect(ctx.sections).toContain('definition');
    expect(ctx.prompt).toContain('Security Engineer');
    expect(ctx.prompt).toContain('skeptical of defaults');
    expect(ctx.prompt).toContain('Find and prove real vulnerabilities');
    expect(ctx.prompt).toContain('IDOR Testing');
    expect(ctx.prompt).toContain('Test object-level authorization');
    expect(ctx.prompt).not.toContain('Totally Unrelated Skill');
    expect(ctx.prompt).not.toContain('Never appears for this agent');
  });

  it('an agent with no linked definition renders no definition section (backward compatible)', async () => {
    const claude = (await getAgentBySlug(db, project.id, 'claude'))!;
    expect(claude.agent_definition_id).toBeNull();
    const ctx = await buildContext(db, { project, agent: claude, task: null, incoming: null });
    expect(ctx.sections).not.toContain('definition');
  });

  it('PATCH /api/agents/[id] semantics: omitting agent_definition_id preserves it, explicit null unlinks', async () => {
    // Mirrors the exact conditional-update SQL in src/app/api/agents/[id]/route.ts
    // (a plain `coalesce` can't distinguish "not sent" from "send null to unlink").
    const definition = await createAgentDefinition(db, { slug: 'ws-patch-def', name: 'Patch Def' });
    const claude = (await getAgentBySlug(db, project.id, 'claude'))!;
    const patch = (hasField: boolean, value: string | null) =>
      db.query('update agents set agent_definition_id = case when $2 then $3::uuid else agent_definition_id end where id=$1', [claude.id, hasField, value]);

    await patch(true, definition.id);
    expect((await getAgentBySlug(db, project.id, 'claude'))!.agent_definition_id).toBe(definition.id);

    // a patch that doesn't touch the field at all must leave it as-is
    await patch(false, null);
    expect((await getAgentBySlug(db, project.id, 'claude'))!.agent_definition_id).toBe(definition.id);

    // an explicit null unlinks
    await patch(true, null);
    expect((await getAgentBySlug(db, project.id, 'claude'))!.agent_definition_id).toBeNull();
  });

  it('a disabled definition is not loaded into context (fails closed, not silently stale)', async () => {
    const definition = await createAgentDefinition(db, { slug: 'ws-disabled-def', name: 'Disabled Def', enabled: true });
    const claude = (await getAgentBySlug(db, project.id, 'claude'))!;
    await db.query('update agents set agent_definition_id=$2 where id=$1', [claude.id, definition.id]);
    await db.query('update agent_definitions set enabled=false where id=$1', [definition.id]);
    const linked = (await getAgentBySlug(db, project.id, 'claude'))!;
    const ctx = await buildContext(db, { project, agent: linked, task: null, incoming: null });
    expect(ctx.sections).not.toContain('definition');
  });
});
