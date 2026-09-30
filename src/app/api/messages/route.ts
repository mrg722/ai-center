import { after } from 'next/server';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { userMessageSchema } from '@/server/validation';
import { findTask, getAgent, requireProject } from '@/server/orchestrator/repo';
import { postMessage } from '@/server/orchestrator/router';
import { listMessages } from '@/server/orchestrator/state';
import { drainHostedQueue } from '@/server/orchestrator/hosted';
import { listOpenRouterModels } from '@/server/providers/openrouter';
import { resolveChatSkills } from '@/server/registry/skill-definitions';
import type { MessageType } from '@/shared/domain';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // these routes trigger after(() => drainHostedQueue()), which calls a real provider and can take a while (non-streamed, large-model completions)

export const GET = userRoute(async ({ req, db, user }) => {
  const project = await requireProject(db, user.id);
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
  const project = await requireProject(db, user.id);
  const task = body.task_id ? await findTask(db, project.id, body.task_id) : null;
  if (body.to !== 'room' && body.to !== 'all') {
    const a = await getAgent(db, body.to);
    if (a.project_id !== project.id) throw new HttpError(400, 'unknown agent');

    // OpenRouter's free catalogue is dynamic. Repair a stale persisted model
    // before dispatch so an old paid-only slug can never cause a 404 run.
    if (a.runtime === 'openrouter') {
      const free = (await listOpenRouterModels()).filter((m) => m.free);
      if (!free.length) throw new HttpError(503, 'OpenRouter has no free models available right now');
      if (a.model !== 'openrouter/free' && !free.some((m) => m.id === a.model)) {
        await db.query('update agents set model=$2 where id=$1', [a.id, free[0].id]);
      }
    }
  } else if (body.to === 'all') {
    const openRouterAgents = await db.query<{ id: string; model: string }>(
      "select id, model from agents where project_id=$1 and runtime='openrouter' and enabled=true",
      [project.id],
    );
    if (openRouterAgents.rows.length) {
      const free = (await listOpenRouterModels()).filter((m) => m.free);
      if (!free.length) throw new HttpError(503, 'OpenRouter has no free models available right now');
      for (const a of openRouterAgents.rows) {
        if (a.model !== 'openrouter/free' && !free.some((m) => m.id === a.model)) {
          await db.query('update agents set model=$2 where id=$1', [a.id, free[0].id]);
        }
      }
    }
  }
  // Chat Skill Selection (third way to use skill_definitions, alongside
  // Agent Definitions — see resolveChatSkills). Validated server-side; only
  // stable slugs (never instructions/security_level from the client) land in
  // meta.skills, where buildContext() picks them up for this request only.
  const chatSkills = body.skill_slugs?.length ? await resolveChatSkills(db, body.skill_slugs) : [];

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
    meta: chatSkills.length ? { skills: chatSkills.map((s) => s.slug) } : undefined,
  });
  after(() => drainHostedQueue());
  return { message_id: message.id, deliveries: deliveries.length, held: deliveries.filter((d) => d.status === 'HELD').length };
});
