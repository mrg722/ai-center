import { z } from 'zod';
import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { memoryCreateSchema, queryBool } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { createMemory, listMemories } from '@/server/memory/store';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  agent_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  scope: z.enum(['global', 'project', 'agent', 'task', 'conversation']).optional(),
  type: z.string().optional(),
  pinned: queryBool,
  archived: queryBool,
  q: z.string().optional(),
});

/** Memory Store dashboard: view/filter memories by scope, agent, task, type, importance, source. */
export const GET = userRoute(async ({ req, db, user }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const project = await requireProject(db, user.id);
  const memories = await listMemories(db, {
    projectId: project.id,
    agentId: q.agent_id,
    taskId: q.task_id,
    scope: q.scope,
    type: q.type,
    pinned: q.pinned,
    archived: q.archived,
    query: q.q,
    limit: 200,
  });
  return { memories, total: memories.length };
});

/** Moderator can also persist a memory directly (not only via an agent's `remember` action). */
export const POST = userRoute(async ({ req, db, user }) => {
  const body = await readJson(req, memoryCreateSchema);
  const project = await requireProject(db, user.id);
  const memory = await createMemory(db, {
    ...body,
    project_id: project.id,
    source: 'user',
    created_by_user: user.id,
  });
  await emit(db, { project_id: project.id, type: 'memory.created', actor: userActor(user), payload: { memory_id: memory.id } });
  return { memory };
});
