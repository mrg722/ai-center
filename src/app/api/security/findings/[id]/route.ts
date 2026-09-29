import { userRoute, HttpError, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { findingStatusSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { getFinding, setFindingStatus } from '@/server/security/store';

export const dynamic = 'force-dynamic';

export const PATCH = userRoute<{ id: string }>(
  async ({ req, db, user, params }) => {
    const body = await readJson(req, findingStatusSchema);
    const project = await requireProject(db, user.id);
    const existing = await getFinding(db, params.id);
    if (existing.project_id !== project.id) throw new HttpError(404, 'finding not found');
    const finding = await setFindingStatus(db, params.id, body.status);
    await emit(db, { project_id: project.id, type: 'security.finding_updated', actor: userActor(user), payload: { finding_id: params.id, status: body.status } });
    return { finding };
  },
  { roles: ['owner', 'moderator'] },
);
