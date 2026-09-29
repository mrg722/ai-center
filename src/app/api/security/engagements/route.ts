import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { engagementCreateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { createEngagement, listEngagements } from '@/server/security/store';

export const dynamic = 'force-dynamic';

/** Engagements: the authorization record a security run must be covered by. */
export const GET = userRoute(async ({ db, user }) => {
  const project = await requireProject(db, user.id);
  const engagements = await listEngagements(db, project.id);
  return { engagements };
});

export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, engagementCreateSchema);
    const project = await requireProject(db, user.id);
    const engagement = await createEngagement(db, { ...body, target_type: body.target_type || 'repo', project_id: project.id, created_by: user.id });
    await emit(db, { project_id: project.id, type: 'security.engagement_created', actor: userActor(user), payload: { engagement_id: engagement.id, target: engagement.target } });
    return { engagement };
  },
  { roles: ['owner', 'moderator'] },
);
