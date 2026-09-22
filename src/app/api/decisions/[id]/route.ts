import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { decisionUpdateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

/** Accept / supersede a decision proposed by an agent (moderator only). */
export const PATCH = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  const body = await readJson(req, decisionUpdateSchema);
  const project = await requireProject(db);
  await db.query(`update decisions set status=$3, decided_by_user=$4 where id=$1 and project_id=$2`, [params.id, project.id, body.status, user.id]);
  await emit(db, { project_id: project.id, type: 'decision.updated', actor: userActor(user), payload: { id: params.id, status: body.status } });
  return { ok: true };
});
