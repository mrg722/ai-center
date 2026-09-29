/**
 * Model Router (Bloque 7): deterministic, configuration-based capability →
 * agent resolution on top of the existing runtime registry. An agent never
 * changes provider by itself; the router only picks WHICH already-configured
 * agent handles a capability.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject, getAgentBySlug } from '@/server/orchestrator/repo';
import { executeAgentAction } from '@/server/orchestrator/actions';
import { resolveAgentForCapability, describeRouting } from '@/server/providers/router';
import { setMode } from '@/server/orchestrator/moderator';
import type { AgentRow, ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let claude: AgentRow;
let gpt: AgentRow;
let gemini: AgentRow;
const user = { kind: 'user' as const, id: '', name: 'Mar' };

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
  user.id = s.userId;
  project = await requireProject(db);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
  gpt = (await getAgentBySlug(db, project.id, 'gpt'))!;
  gemini = (await getAgentBySlug(db, project.id, 'gemini'))!;
}

describe('model router', () => {
  beforeEach(fresh, 30_000);

  it('falls back to the default role mapping when nothing is configured', async () => {
    expect(claude.role).toBe('PRIMARY_BUILDER');
    expect(gpt.role).toBe('AUDITOR_INTEGRATOR');
    expect(gemini.role).toBe('RESEARCHER');

    expect((await resolveAgentForCapability(db, project, 'code'))?.slug).toBe('claude');
    expect((await resolveAgentForCapability(db, project, 'security'))?.slug).toBe('gpt');
    expect((await resolveAgentForCapability(db, project, 'research'))?.slug).toBe('gemini');
  });

  it('operator configuration (project.settings.model_routing) wins over the default role mapping', async () => {
    await db.query(`update projects set settings = settings || '{"model_routing":{"code":"gemini"}}'::jsonb where id=$1`, [project.id]);
    const reloaded = await requireProject(db);
    const resolved = await resolveAgentForCapability(db, reloaded, 'code');
    expect(resolved?.slug).toBe('gemini');
  });

  it('never resolves to a disabled agent', async () => {
    await db.query('update agents set enabled=false where id=$1', [claude.id]);
    const resolved = await resolveAgentForCapability(db, project, 'code');
    expect(resolved?.slug).not.toBe('claude');
  });

  it('describeRouting reports the full table (configured + resolved), never a partial view', async () => {
    const table = await describeRouting(db, project);
    expect(table.map((r) => r.capability).sort()).toEqual(['code', 'reasoning', 'research', 'security', 'simple']);
    expect(table.every((r) => r.resolved_agent)).toBe(true);
  });

  it('create_subtask with a capability (no assign_to) is routed through the Model Router', async () => {
    await setMode(db, project, { kind: 'user', id: user.id, name: user.name }, 'SUPERVISED');
    project = await requireProject(db);
    const parent = await db.query<{ id: string }>(
      `insert into tasks (project_id, key, seq, title, status, requires_human_approval)
       values ($1,'DF-900',900,'Parent','OPEN',false) returning id`,
      [project.id],
    );
    const result = await executeAgentAction(db, claude, {
      action: 'create_subtask',
      parent_task_id: parent.rows[0].id,
      title: 'Security review of the new endpoint',
      description: 'Check authz and IDOR',
      capability: 'security',
    });
    expect(result.ok).toBe(true);
    const t = await db.query<{ assigned_agent: string }>('select assigned_agent from tasks where id=$1', [(result as { task_id: string }).task_id]);
    expect(t.rows[0].assigned_agent).toBe(gpt.id);
  });
});
