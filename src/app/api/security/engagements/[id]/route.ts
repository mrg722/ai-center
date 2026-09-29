import { userRoute, HttpError, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { engagementStatusSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { getEngagement, setEngagementStatus } from '@/server/security/store';

export const dynamic = 'force-dynamic';

export const GET = userRoute<{ id: string }>(async ({ db, user, params }) => {
  const project = await requireProject(db, user.id);
  const engagement = await getEngagement(db, params.id);
  if (engagement.project_id !== project.id) throw new HttpError(404, 'engagement not found');
  return { engagement };
});

export const PATCH = userRoute<{ id: string }>(
  async ({ req, db, user, params }) => {
    const body = await readJson(req, engagementStatusSchema);
    const project = await requireProject(db, user.id);
    const existing = await getEngagement(db, params.id);
    if (existing.project_id !== project.id) throw new HttpError(404, 'engagement not found');
    const engagement = await setEngagementStatus(db, params.id, body.status);
    await emit(db, { project_id: project.id, type: 'security.engagement_updated', actor: userActor(user), payload: { engagement_id: params.id, status: body.status } });
    return { engagement };
  },
  { roles: ['owner', 'moderator'] },
);
