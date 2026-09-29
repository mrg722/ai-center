/**
 * Multi-project support (Bloque: Projects). A moderator's "current project"
 * is per-user (users.current_project_id), not a single global — switching
 * never affects other moderators, and every userRoute request resolves
 * against the CALLING user's project.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { createProject } from '@/server/orchestrator/setup';
import { getAgentBySlug, getProjectByKey, listProjects, requireProject, setCurrentProject } from '@/server/orchestrator/repo';
import type { ProjectRow } from '@/server/types';

let db: Db;
let userId: string;

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
  userId = s.userId;
}

describe('multi-project', () => {
  beforeEach(fresh, 30_000);

  it('first-run setup sets the owner current_project_id to the project it created', async () => {
    const p = await requireProject(db, userId);
    expect(p.key).toBe('DF');
  });

  it('createProject fully bootstraps a second project (same default agents/rules) and switches the creator to it', async () => {
    const second = await createProject(db, { project_name: 'Security', project_key: 'SEC', default_branch: 'main' }, userId, 'Mar');
    expect(second.key).toBe('SEC');

    // the creator is now on the new project...
    const current = await requireProject(db, userId);
    expect(current.id).toBe(second.id);

    // ...which is fully seeded, same as the first one.
    expect(await getAgentBySlug(db, second.id, 'claude')).not.toBeNull();
    expect(await getAgentBySlug(db, second.id, 'gpt')).not.toBeNull();
    const rules = await db.query('select count(*)::int n from project_context where project_id=$1 and kind=$2', [second.id, 'rule']);
    expect(rules.rows[0].n).toBeGreaterThan(0);
  });

  it('rejects a duplicate project key', async () => {
    await expect(createProject(db, { project_name: 'Dup', project_key: 'DF', default_branch: 'main' }, userId, 'Mar')).rejects.toThrow();
  });

  it('listProjects returns every project, most recent first', async () => {
    await createProject(db, { project_name: 'Security', project_key: 'SEC', default_branch: 'main' }, userId, 'Mar');
    const all = await listProjects(db);
    expect(all.map((p) => p.key)).toEqual(['SEC', 'DF']);
  });

  it('switching is per-user: one moderator switching never moves another', async () => {
    const second = await createProject(db, { project_name: 'Security', project_key: 'SEC', default_branch: 'main' }, userId, 'Mar');
    const first = (await getProjectByKey(db, 'DF')) as ProjectRow;

    // a second moderator, still on the first project (never switched)
    const u2 = await db.query<{ id: string }>(
      `insert into users (email, display_name, password_hash, role) values ('other@example.com','Other','x','moderator') returning id`,
    );
    await setCurrentProject(db, u2.rows[0].id, first.id);

    expect((await requireProject(db, userId)).id).toBe(second.id); // creator, switched by createProject
    expect((await requireProject(db, u2.rows[0].id)).id).toBe(first.id); // untouched
  });

  it('falls back to the oldest project if current_project_id is unset (new user, never switched)', async () => {
    const u2 = await db.query<{ id: string }>(
      `insert into users (email, display_name, password_hash, role) values ('nobody@example.com','Nobody','x','viewer') returning id`,
    );
    const p = await requireProject(db, u2.rows[0].id);
    expect(p.key).toBe('DF');
  });
});
