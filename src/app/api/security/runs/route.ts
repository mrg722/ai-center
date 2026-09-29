import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { securityRunCreateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { assertSecurityUnlocked } from '@/server/security/pin';
import { createSecurityRun, getOrCreateOwnerEngagement, listSecurityRuns } from '@/server/security/store';

export const dynamic = 'force-dynamic';

/**
 * Security runs. Owner-only (Strix performs real active exploitation, not a
 * passive scan) and gated by the Security Lab PIN (assertSecurityUnlocked)
 * on top of the session cookie. Creating one only succeeds when the
 * resolved engagement is ACTIVE and in-window (createSecurityRun /
 * assertEngagementAuthorizesRun in src/server/security/store.ts) — either
 * an explicit `engagement_id`, or `target`+`target_type` for the owner's
 * own no-friction fast path (getOrCreateOwnerEngagement), which still
 * leaves an audit record, just without a manual draft→active step.
 */
export const GET = userRoute(
  async ({ db, user }) => {
    const project = await requireProject(db, user.id);
    await assertSecurityUnlocked(project.id, user.id);
    const runs = await listSecurityRuns(db, project.id);
    return { runs };
  },
  { roles: ['owner'] },
);

export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, securityRunCreateSchema);
    const project = await requireProject(db, user.id);
    await assertSecurityUnlocked(project.id, user.id);
    const scanMode = body.scan_mode || 'standard';
    const engagementId = body.engagement_id ?? (await getOrCreateOwnerEngagement(db, project.id, body.target!, body.target_type || 'url', user.display_name, user.id)).id;
    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: engagementId, scan_mode: scanMode, requested_by: user.id });
    await emit(db, { project_id: project.id, type: 'security.run_created', actor: userActor(user), payload: { run_id: run.id, engagement_id: engagementId, scan_mode: scanMode } });
    return { run };
  },
  { roles: ['owner'] },
);
