import { userRoute } from '@/server/http/route';
import { describeRuntimes } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { listNvidiaModels, resolveNvidiaModel } from '@/server/providers/nvidia';
import { getOpenRouterKeyStatus, listOpenRouterModels } from '@/server/providers/openrouter';
import { userActor } from '@/server/auth/session';
import { emit } from '@/server/events/bus';
import { getAgentBySlug, requireProject } from '@/server/orchestrator/repo';
import { seedPermissions } from '@/server/orchestrator/moderator';
import { getRuntime } from '@/server/providers/registry';
import { describeRouting } from '@/server/providers/router';

export const dynamic = 'force-dynamic';

/** Free-tier catalogue + usage/limit status — same shape regardless of whether OPENROUTER_API_KEY is set (the model list is public; only key_status needs the key). Best-effort: never throws, so it can't take down the rest of /api/providers. */
async function openRouterPayload(): Promise<{ configured: boolean; models: { id: string; name?: string; context_length?: number }[]; total: number; key_status: Awaited<ReturnType<typeof getOpenRouterKeyStatus>>; error?: string }> {
  const configured = Boolean(readApiKey('OPENROUTER_API_KEY'));
  try {
    const all = await listOpenRouterModels();
    const free = all.filter((m) => m.free);
    const key_status = configured ? await getOpenRouterKeyStatus() : null;
    return { configured, models: free, total: free.length, key_status };
  } catch (e) {
    return { configured, models: [], total: 0, key_status: null, error: e instanceof Error ? e.message.slice(0, 300) : 'OpenRouter catalogue request failed' };
  }
}

/** Runtime catalogue plus the live NVIDIA model catalogue. Secrets are never returned. */
export const GET = userRoute(async ({ db, user }) => {
  const runtimes = describeRuntimes();
  const project = await requireProject(db, user.id);
  const modelRouting = await describeRouting(db, project);
  const openrouter = await openRouterPayload();
  let agent = await getAgentBySlug(db, project.id, 'nvidia');

  if (!agent) {
    const runtime = getRuntime('nvidia-nim');
    if (runtime) {
      const inserted = await db.query<{ id: string }>(
        `insert into agents
          (project_id, slug, name, runtime, transport, model, role, role_label, description, color, config, enabled, sort_order)
         values
          ($1, 'nvidia', 'NVIDIA NIM', $2, $3, $4, 'GENERIC', 'NVIDIA multimodel',
           'NVIDIA NIM API Catalog with one agent and dynamic model switching.',
           '#76b900', $5, true, coalesce((select max(sort_order)+1 from agents where project_id=$1), 0))
         on conflict (project_id, slug) do nothing
         returning id`,
        [
          project.id,
          runtime.id,
          runtime.transport,
          runtime.defaultModel ?? '',
          JSON.stringify({ office_style: 'generic', api_key_env: 'NVIDIA_API_KEY' }),
        ],
      );
      if (inserted.rows[0]?.id) {
        await seedPermissions(db, inserted.rows[0].id, 'GENERIC', user.id);
        for (const capability of runtime.capabilities) {
          await db.query(
            'insert into agent_capabilities (agent_id, capability) values ($1, $2) on conflict do nothing',
            [inserted.rows[0].id, capability],
          );
        }
        await emit(db, {
          project_id: project.id,
          type: 'agent.created',
          actor: userActor(user),
          agent_id: inserted.rows[0].id,
          payload: { slug: 'nvidia' },
        });
      }
      agent = await getAgentBySlug(db, project.id, 'nvidia');
    }
  }
  const configured = Boolean(readApiKey('NVIDIA_API_KEY'));

  if (!configured) {
    return {
      runtimes,
      model_routing: modelRouting,
      openrouter,
      nvidia: { configured: false, models: [], total: 0, providers: [] as string[], agent: agent ? { id: agent.id, model: agent.model } : null },
    };
  }

  try {
    const models = await listNvidiaModels();
    let agentModel = agent?.model ?? '';
    let modelRepair: { from: string; to: string } | undefined;
    if (agent) {
      const resolved = await resolveNvidiaModel(agentModel);
      if (resolved.repaired) {
        const from = agentModel;
        await db.query('update agents set model=$2 where id=$1', [agent.id, resolved.model]);
        agentModel = resolved.model;
        modelRepair = { from, to: resolved.model };
      } else {
        agentModel = resolved.model;
      }
    }
    return {
      runtimes,
      model_routing: modelRouting,
      openrouter,
      nvidia: {
        configured: true,
        models,
        total: models.length,
        providers: [...new Set(models.map((m) => m.id.split('/')[0]).filter(Boolean))].sort(),
        agent: agent ? { id: agent.id, model: agentModel } : null,
        ...(modelRepair ? { model_repair: modelRepair } : {}),
      },
    };
  } catch (e) {
    return {
      runtimes,
      model_routing: modelRouting,
      openrouter,
      nvidia: {
        configured: true,
        models: [],
        total: 0,
        providers: [] as string[],
        error: e instanceof Error ? e.message.slice(0, 500) : 'NVIDIA catalogue request failed',
      },
    };
  }
});
