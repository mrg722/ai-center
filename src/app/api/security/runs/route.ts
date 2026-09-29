import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { securityRunCreateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { createSecurityRun, listSecurityRuns } from '@/server/security/store';

export const dynamic = 'force-dynamic';

/**
 * Security runs. Creating one only succeeds when `engagement_id` is an
 * ACTIVE, in-window engagement (see createSecurityRun/assertEngagementAuthorizesRun
 * in src/server/security/store.ts) — this is the allowlist gate, enforced
 * server-side regardless of what the UI shows.
 */
export const GET = userRoute(async ({ db, user }) => {
  const project = await requireProject(db, user.id);
  const runs = await listSecurityRuns(db, project.id);
  return { runs };
});

export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, securityRunCreateSchema);
    const project = await requireProject(db, user.id);
    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: body.engagement_id, scan_mode: body.scan_mode || 'standard', requested_by: user.id });
    await emit(db, { project_id: project.id, type: 'security.run_created', actor: userActor(user), payload: { run_id: run.id, engagement_id: body.engagement_id, scan_mode: body.scan_mode } });
    return { run };
  },
  { roles: ['owner', 'moderator'] },
);
