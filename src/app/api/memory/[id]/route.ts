import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { memoryUpdateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { deleteMemory, getMemory, updateMemory } from '@/server/memory/store';
import type { Db } from '@/server/db';

export const dynamic = 'force-dynamic';

async function ownedMemory(db: Db, projectId: string, id: string) {
  const m = await getMemory(db, id);
  if (m.project_id !== projectId) throw new HttpError(404, 'memory not found');
  return m;
}

export const PATCH = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  const body = await readJson(req, memoryUpdateSchema);
  const project = await requireProject(db);
  await ownedMemory(db, project.id, params.id);
  const memory = await updateMemory(db, params.id, body);
  await emit(db, { project_id: project.id, type: 'memory.updated', actor: userActor(user), payload: { memory_id: params.id } });
  return { memory };
});

export const DELETE = userRoute<{ id: string }>(async ({ db, user, params }) => {
  const project = await requireProject(db);
  await ownedMemory(db, project.id, params.id);
  await deleteMemory(db, params.id);
  await emit(db, { project_id: project.id, type: 'memory.updated', actor: userActor(user), payload: { memory_id: params.id, deleted: true } });
  return { ok: true };
});
