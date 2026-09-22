import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { contextDocSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

export const PATCH = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  const body = await readJson(req, contextDocSchema.partial());
  const project = await requireProject(db);
  await db.query(
    `update project_context set kind=coalesce($3,kind), title=coalesce($4,title), content=coalesce($5,content),
        pinned=coalesce($6,pinned), updated_by=$7 where id=$1 and project_id=$2`,
    [params.id, project.id, body.kind ?? null, body.title ?? null, body.content ?? null, body.pinned ?? null, user.id],
  );
  await emit(db, { project_id: project.id, type: 'context.updated', actor: userActor(user), payload: { id: params.id } });
  return { ok: true };
});

export const DELETE = userRoute<{ id: string }>(async ({ db, user, params }) => {
  const project = await requireProject(db);
  await db.query(`delete from project_context where id=$1 and project_id=$2`, [params.id, project.id]);
  await emit(db, { project_id: project.id, type: 'context.updated', actor: userActor(user), payload: { id: params.id, deleted: true } });
  return { ok: true };
});
