import { agentRoute } from '@/server/http/route';
import { getProjectById, findTask } from '@/server/orchestrator/repo';
import { buildContext } from '@/server/orchestrator/context';

export const dynamic = 'force-dynamic';

export const GET = agentRoute(async ({ req, db, agent }) => {
  const project = await getProjectById(db, agent.project_id);
  const taskId = req.nextUrl.searchParams.get('task_id');
  const task = taskId ? await findTask(db, project.id, taskId) : null;
  const ctx = await buildContext(db, { project, agent, task, incoming: null });
  return { prompt: ctx.prompt, sections: ctx.sections };
});
