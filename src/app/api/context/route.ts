import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { contextDocSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

/** Permanent memory: rules, architecture notes, documentation, decisions. */
export const GET = userRoute(async ({ db }) => {
  const project = await requireProject(db);
  const [docs, decisions] = await Promise.all([
    db.query(`select * from project_context where project_id=$1 order by pinned desc, updated_at desc`, [project.id]),
    db.query(
      `select d.*, a.name as proposed_by_name from decisions d left join agents a on a.id=d.proposed_by_agent
        where d.project_id=$1 order by d.created_at desc limit 100`,
      [project.id],
    ),
  ]);
  return { docs: docs.rows, decisions: decisions.rows };
});

export const POST = userRoute(async ({ req, db, user }) => {
  const body = await readJson(req, contextDocSchema);
  const project = await requireProject(db);
  const r = await db.query<{ id: string }>(
    `insert into project_context (project_id, kind, title, content, pinned, updated_by) values ($1,$2,$3,$4,$5,$6) returning id`,
    [project.id, body.kind, body.title, body.content, body.pinned, user.id],
  );
  await emit(db, { project_id: project.id, type: 'context.updated', actor: userActor(user), payload: { id: r.rows[0].id } });
  return { id: r.rows[0].id };
});
