import { after } from 'next/server';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { createTaskSchema } from '@/server/validation';
import { getAgent, requireProject } from '@/server/orchestrator/repo';
import { createTask } from '@/server/orchestrator/tasks';
import { drainHostedQueue } from '@/server/orchestrator/hosted';

export const dynamic = 'force-dynamic';

export const GET = userRoute(async ({ req, db }) => {
  const project = await requireProject(db);
  const status = req.nextUrl.searchParams.get('status');
  const r = await db.query(
    `select id, key, title, status, priority, assigned_agent, parent_task_id, paused, updated_at, created_at
       from tasks where project_id=$1 ${status ? 'and status=$2' : ''} order by seq desc limit 200`,
    status ? [project.id, status] : [project.id],
  );
  return { tasks: r.rows };
});

export const POST = userRoute(async ({ req, db, user }) => {
  const body = await readJson(req, createTaskSchema);
  const project = await requireProject(db);
  if (body.assigned_agent) {
    const a = await getAgent(db, body.assigned_agent);
    if (a.project_id !== project.id) throw new HttpError(400, 'unknown agent');
  }
  const task = await createTask(db, {
    project,
    actor: userActor(user),
    title: body.title,
    description: body.description,
    priority: body.priority,
    assignedAgentId: body.assigned_agent ?? null,
    parentTaskId: body.parent_task_id ?? null,
    requiresHumanApproval: body.requires_human_approval,
  });
  after(() => drainHostedQueue());
  return { task };
});
