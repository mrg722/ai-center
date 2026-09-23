import { userRoute, HttpError, readJson } from '@/server/http/route';
import type { NextRequest } from 'next/server';
import { getAgentBySlug, agentViews, requireProject } from '@/server/orchestrator/repo';
import { seedPermissions } from '@/server/orchestrator/moderator';
import { getRuntime } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { userActor, type SessionUser } from '@/server/auth/session';
import type { Db } from '@/server/db';
import type { ProjectRow } from '@/server/types';
import { emit } from '@/server/events/bus';
import { listNvidiaModels } from '@/server/providers/nvidia';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function ensureNvidiaAgent(db: Db, project: ProjectRow, user: SessionUser) {
  const existing = await getAgentBySlug(db, project.id, 'nvidia');
  if (existing) return existing;

  const runtime = getRuntime('nvidia-nim');
  if (!runtime) throw new HttpError(500, 'NVIDIA NIM runtime is not registered');

  const inserted = await db.query<{ id: string }>(
    `insert into agents
      (project_id, slug, name, runtime, transport, model, role, role_label, description, color, config, enabled, sort_order)
     values
      ($1, 'nvidia', 'NVIDIA NIM', $2, $3, $4, 'GENERIC', 'NVIDIA multimodel',
       'NVIDIA NIM API Catalog: modelos descubiertos dinámicamente desde NVIDIA.',
       '#76b900', $5, true, coalesce((select max(sort_order)+1 from agents where project_id=$1), 0))
     returning id`,
    [
      project.id,
      runtime.id,
      runtime.transport,
      runtime.defaultModel ?? '',
      JSON.stringify({ office_style: 'generic', api_key_env: 'NVIDIA_API_KEY' }),
    ],
  );

  const agentId = inserted.rows[0]?.id;
  if (!agentId) throw new HttpError(500, 'failed to create NVIDIA agent');

  await seedPermissions(db, agentId, 'GENERIC', user.id);
  for (const capability of runtime.capabilities) {
    await db.query(
      'insert into agent_capabilities (agent_id, capability) values ($1, $2) on conflict do nothing',
      [agentId, capability],
    );
  }

  await emit(db, {
    project_id: project.id,
    type: 'agent.created',
    actor: userActor(user),
    agent_id: agentId,
    payload: { slug: 'nvidia' },
  });

  return getAgentBySlug(db, project.id, 'nvidia');
}

const getNvidia = userRoute(async ({ db, user }) => {
  const project = await requireProject(db);
  const agent = await ensureNvidiaAgent(db, project, user);
  const configured = Boolean(readApiKey('NVIDIA_API_KEY'));

  if (!configured) {
    const agents = await agentViews(db, project);
    return {
      configured: false,
      models: [],
      total: 0,
      providers: [],
      agent: agents.find((a) => a.slug === 'nvidia') ?? null,
      error: 'NVIDIA_API_KEY no está configurada en el servidor',
    };
  }

  try {
    const models = await listNvidiaModels();
    const selectedModel = agent?.model || models[0]?.id || '';
    if (agent && selectedModel && agent.model !== selectedModel) {
      await db.query('update agents set model=$2 where id=$1', [agent.id, selectedModel]);
    }

    const agents = await agentViews(db, project);
    return {
      configured: true,
      models,
      total: models.length,
      providers: [...new Set(models.map((m) => m.id.split('/')[0]).filter(Boolean))].sort(),
      agent: agents.find((a) => a.slug === 'nvidia') ?? null,
    };
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message.slice(0, 500) : 'NVIDIA catalogue request failed');
  }
});

const postNvidia = userRoute(async ({ req, db, user }) => {
  const project = await requireProject(db);
  const body = await readJson(req, z.object({ model: z.string().trim().min(1).max(200) }));

  if (!readApiKey('NVIDIA_API_KEY')) {
    throw new HttpError(503, 'NVIDIA_API_KEY no está configurada en el servidor');
  }

  let models;
  try {
    models = await listNvidiaModels();
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message.slice(0, 500) : 'NVIDIA catalogue request failed');
  }

  if (!models.some((model) => model.id === body.model)) {
    throw new HttpError(400, 'El modelo no está disponible en el catálogo NVIDIA actual');
  }

  const agent = await ensureNvidiaAgent(db, project, user.id, user.name);
  if (!agent) throw new HttpError(409, 'agente NVIDIA no inicializado');

  await db.query('update agents set model=$2, enabled=true where id=$1', [agent.id, body.model]);
  await emit(db, {
    project_id: project.id,
    type: 'agent.updated',
    actor: userActor(user),
    agent_id: agent.id,
    payload: { model: body.model, provider: 'nvidia-nim' },
  });

  const agents = await agentViews(db, project);
  const updated = agents.find((a) => a.id === agent.id);
  if (!updated) throw new HttpError(500, 'agente NVIDIA no disponible');
  return { ok: true, agent: updated };
});



export async function GET(req: NextRequest) {
  return getNvidia(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return postNvidia(req, { params: Promise.resolve({}) });
}
