/**
 * Bulk permission shortcuts ("Permitir todo" / "Preguntar antes de" in the
 * Agents page) — setPermissionPolicy() applies a base grant to every
 * PermissionAction in one call, through the exact same `permissions` table
 * and Policy Engine (decide()) that per-action grants already use.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { effectivePermissions, getAgentBySlug, requireProject } from '@/server/orchestrator/repo';
import { setPermissionPolicy } from '@/server/orchestrator/moderator';
import { PERMISSION_ACTIONS } from '@/shared/domain';
import type { AgentRow, ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let claude: AgentRow;
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
  project = await requireProject(db, s.userId);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
}

describe('bulk permission policy', () => {
  beforeEach(fresh, 30_000);

  it('allow_all grants every PermissionAction', async () => {
    await setPermissionPolicy(db, claude, user, { policy: 'allow_all', reason: 'test' });
    const perms = await effectivePermissions(db, claude.id);
    for (const action of PERMISSION_ACTIONS) expect(perms[action]).toBe(true);
  });

  it('ask_first keeps read/write but revokes every other action', async () => {
    // start from allow_all so the test proves ask_first actually revokes, not just "was already off"
    await setPermissionPolicy(db, claude, user, { policy: 'allow_all', reason: 'test' });
    await setPermissionPolicy(db, claude, user, { policy: 'ask_first', reason: 'test' });
    const perms = await effectivePermissions(db, claude.id);
    expect(perms.read).toBe(true);
    expect(perms.write).toBe(true);
    for (const action of PERMISSION_ACTIONS) {
      if (action === 'read' || action === 'write') continue;
      expect(perms[action]).toBe(false);
    }
  });
});
