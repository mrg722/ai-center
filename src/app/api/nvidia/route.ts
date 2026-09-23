import { userRoute, HttpError, readJson } from '@/server/http/route';
import { getAgentBySlug, agentViews, requireProject } from '@/server/orchestrator/repo';
import { seedPermissions } from '@/server/orchestrator/moderator';
import { getRuntime } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { userActor } from '@/server/auth/session';
import { emit } from '@/server/events/bus';
import { listNvidiaModels, nvidiaModelAvailable } from '@/server/providers/nvidia';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function ensureAgent(db: Parameters<typeof requireProject>[0], project: Awaited<ReturnType<typeof requireProject>>, user: Parameters<typeof userActor>[0]) {
  let agent = await getAgentBySlug(db, project.id, 'nvidia');
  if (agent) return agent;

  const runtime = getRuntime('nvidia-nim');
  if (!runtime) throw new HttpError(500, 'NVIDIA NIM runtime is not registered');

  const u = await db.query<{ id: string }>('select id from users order by created_at asc limit 1');
  const q = await db.query<{ id: string }>(
    `insert into agents
      (project_id,slug,name,runtime,transport,model,role,role_label,description,color,config,enabled,sort_order)
     values
      ($1,'nvidia','NVIDIA NIM',$2,$3,$4,'GENERIC','NVIDIA multimodel',
       'NVIDIA NIM API Catalog: modelos descubiertos dinámicamente desde NVIDIA.',
       $5,$6,true,coalesce((select max(sort_order)+1 from agents where project_id=$1),0))
     returning id`,
    [
      project.id,
      runtime.id,
      runtime.transport,
      runtime.defaultModel ?? '',
      '#76b900',
      JSON.stringify({ office_style: 'generic', api_key_env: 'NVIDIA_API_KEY' }),
    ],
  );

  await seedPermissions(db, q.rows[0].id, 'GENERIC', u.rows[0]?.id ?? user.id);
  for (const capability of runtime.capabilities) {
    await db.query('insert into agent_capabilities (agent_id,capability) values ($1,$2) on conflict do nothing', [q.rows[0].id, capability]);
  }
  await emit(db, {
    project_id: project.id,
    type: 'agent.created',
    actor: userActor(user),
    agent_id: q.rows[0].id,
    payload: { slug: 'nvidia' },
  });
  return getAgentBySlug(db, project.id, 'nvidia');
}

export const GET = userRoute(async ({ db, user }) => {
  const project = await requireProject(db);
  const configured = Boolean(readApiKey('NVIDIA_API_KEY'));
  const agent = await ensureAgent(db, project, user);

  if (!configured) {
    return {
      configured: false,
      models: [],
      total: 0,
      providers: [],
      agent: (await agentViews(db, project)).find((a) => a.slug === 'nvidia') ?? null,
      error: 'NVIDIA_API_KEY no está configurada en el servidor',
    };
  }

  try {
    const models = await listNvidiaModels();
    if (agent && !agent.model && models[0]) {
      await db.query('update agents set model=$2 where id=$1', [agent.id, models[0].id]);
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
    throw new HttpError(502, (e as Error).message.slice(0, 500));
  }
});

export const POST = userRoute(async ({ req, db, user }) => {
  const project = await requireProject(db);
  const body = await readJson(req, z.object({ model: z.string().trim().min(1).max(200) }));

  if (!readApiKey('NVIDIA_API_KEY')) throw new HttpError(503, 'NVIDIA_API_KEY no está configurada en el servidor');
  let available = false;
  try {
    available = await nvidiaModelAvailable(body.model);
  } catch (e) {
    throw new HttpError(502, (e as Error).message.slice(0, 500));
  }
  if (!available) throw new HttpError(400, 'El modelo no está disponible en el catálogo NVIDIA actual');

  const agent = await ensureAgent(db, project, user);
  if (!agent) throw new HttpError(409, 'agente NVIDIA no inicializado');

  await db.query('update agents set model=$2, enabled=true where id=$1', [agent.id, body.model]);
  await emit(db, {
    project_id: project.id,
    type: 'agent.updated',
    actor: userActor(user),
    agent_id: agent.id,
    payload: { model: body.model, provider: 'nvidia-nim' },
  });

  const updated = (await agentViews(db, project)).find((a) => a.id === agent.id);
  if (!updated) throw new HttpError(500, 'agente NVIDIA no disponible');
  return { ok: true, agent: updated };
});
