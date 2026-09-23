import { after } from 'next/server';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { taskControlSchema } from '@/server/validation';
import { findTask, getAgent, getTask, requireProject } from '@/server/orchestrator/repo';
import { taskDetail } from '@/server/orchestrator/state';
import { patchTask, pauseTask, cancelTask } from '@/server/orchestrator/tasks';
import { approveTask, assignTask, moderatorSetStatus } from '@/server/orchestrator/moderator';
import { postMessage, reconcileHolds } from '@/server/orchestrator/router';
import { drainHostedQueue } from '@/server/orchestrator/hosted';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // these routes trigger after(() => drainHostedQueue()), which calls a real provider and can take a while (non-streamed, large-model completions)

export const GET = userRoute<{ id: string }>(async ({ db, params }) => {
  const project = await requireProject(db);
  const task = await findTask(db, project.id, params.id);
  return taskDetail(db, project, task);
});

/** Moderator control over a task. */
export const POST = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  const body = await readJson(req, taskControlSchema);
  const project = await requireProject(db);
  const task = await findTask(db, project.id, params.id);
  const actor = userActor(user);
  const agentOf = async (id: string) => {
    const a = await getAgent(db, id);
    if (a.project_id !== project.id) throw new HttpError(400, 'unknown agent');
    return a;
  };

  switch (body.op) {
    case 'assign':
      await assignTask(db, project, task, await agentOf(body.agent_id), actor, body.note);
      break;
    case 'status':
      await moderatorSetStatus(db, task, body.status, actor, body.note);
      break;
    case 'pause':
      await pauseTask(db, task, true, actor);
      break;
    case 'resume':
      await pauseTask(db, task, false, actor);
      break;
    case 'cancel':
      await cancelTask(db, task, actor, body.chain);
      break;
    case 'approve':
      await approveTask(db, project, task, actor, true, body.note);
      break;
    case 'reject':
      await approveTask(db, project, task, actor, false, body.note);
      break;
    case 'request_review': {
      const a = await agentOf(body.agent_id);
      await patchTask(db, task, { next_agent: a.id }, actor);
      await moderatorSetStatus(db, await getTask(db, task.id), 'WAITING_REVIEW', actor, `review by ${a.name}`);
      await postMessage(db, {
        project,
        task: await getTask(db, task.id),
        from: actor,
        to: { agentId: a.id },
        type: 'REVIEW',
        content: body.note?.trim() || `Please review the current state of ${task.key}: ${task.title}. Record your verdict with acc_record_review.`,
        requiresAction: true,
      });
      break;
    }
    case 'continue': {
      const t = await moderatorSetStatus(db, task, 'IN_PROGRESS', actor, 'continued by moderator');
      await reconcileHolds(db, project.id);
      const targetId = body.agent_id ?? task.assigned_agent;
      if (targetId) {
        await postMessage(db, {
          project,
          task: t && typeof t === 'object' ? t : task,
          from: actor,
          to: { agentId: (await agentOf(targetId)).id },
          type: 'REQUEST',
          content: body.note?.trim() || 'Continue with the task.',
          requiresAction: true,
        });
      }
      break;
    }
    case 'update':
      await patchTask(
        db,
        task,
        {
          title: body.title,
          description: body.description,
          priority: body.priority,
          requires_human_approval: body.requires_human_approval,
          current_branch: body.current_branch,
        },
        actor,
      );
      break;
  }
  after(() => drainHostedQueue());
  return { task: await getTask(db, task.id) };
});
