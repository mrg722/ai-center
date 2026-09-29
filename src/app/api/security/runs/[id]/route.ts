import { userRoute, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { assertSecurityUnlocked } from '@/server/security/pin';
import { getSecurityRun, listFindings, stopSecurityRun } from '@/server/security/store';

export const dynamic = 'force-dynamic';

export const GET = userRoute<{ id: string }>(
  async ({ db, user, params }) => {
    const project = await requireProject(db, user.id);
    await assertSecurityUnlocked(project.id, user.id);
    const run = await getSecurityRun(db, params.id);
    if (run.project_id !== project.id) throw new HttpError(404, 'run not found');
    const findings = await listFindings(db, project.id, { securityRunId: run.id });
    return { run, findings };
  },
  { roles: ['owner'] },
);

/** Owner-only stop. Bridge-side status/finding reporting uses the separate
 * agentRoute [id]/claim and [id]/report endpoints (StrixRuntime adapter). */
export const PATCH = userRoute<{ id: string }>(
  async ({ db, user, params }) => {
    const project = await requireProject(db, user.id);
    await assertSecurityUnlocked(project.id, user.id);
    const existing = await getSecurityRun(db, params.id);
    if (existing.project_id !== project.id) throw new HttpError(404, 'run not found');
    const run = await stopSecurityRun(db, params.id);
    await emit(db, { project_id: project.id, type: 'security.run_stopped', actor: userActor(user), payload: { run_id: params.id } });
    return { run };
  },
  { roles: ['owner'] },
);
