import { after } from 'next/server';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { userMessageSchema } from '@/server/validation';
import { findTask, getAgent, requireProject } from '@/server/orchestrator/repo';
import { postMessage } from '@/server/orchestrator/router';
import { listMessages } from '@/server/orchestrator/state';
import { drainHostedQueue } from '@/server/orchestrator/hosted';
import type { MessageType } from '@/shared/domain';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // these routes trigger after(() => drainHostedQueue()), which calls a real provider and can take a while (non-streamed, large-model completions)

export const GET = userRoute(async ({ req, db }) => {
  const project = await requireProject(db);
  const sp = req.nextUrl.searchParams;
  const task = sp.get('task');
  const messages = await listMessages(db, project, {
    taskId: task ? (await findTask(db, project.id, task)).id : undefined,
    conversationId: sp.get('conversation') ?? undefined,
    beforeSeq: sp.get('before') ? Number(sp.get('before')) : undefined,
    afterSeq: sp.get('after') ? Number(sp.get('after')) : undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  });
  return { messages };
});

/** Moderator writes into the room: to one agent, to all agents, or a note. */
export const POST = userRoute(async ({ req, db, user }) => {
  const body = await readJson(req, userMessageSchema);
  const project = await requireProject(db);
  const task = body.task_id ? await findTask(db, project.id, body.task_id) : null;
  if (body.to !== 'room' && body.to !== 'all') {
    const a = await getAgent(db, body.to);
    if (a.project_id !== project.id) throw new HttpError(400, 'unknown agent');
  }
  const { message, deliveries } = await postMessage(db, {
    project,
    task,
    from: userActor(user),
    to: body.to === 'room' ? { moderator: true } : body.to === 'all' ? { all: true } : { agentId: body.to },
    type: (body.to === 'room' ? 'NOTE' : body.type) as MessageType,
    content: body.content,
    priority: body.priority,
    replyTo: body.reply_to ?? null,
    requiresAction: body.to !== 'room',
  });
  after(() => drainHostedQueue());
  return { message_id: message.id, deliveries: deliveries.length, held: deliveries.filter((d) => d.status === 'HELD').length };
});
