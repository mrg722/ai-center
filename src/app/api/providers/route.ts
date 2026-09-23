import { userRoute } from '@/server/http/route';
import { describeRuntimes } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { listNvidiaModels } from '@/server/providers/nvidia';
import { userActor } from '@/server/auth/session';
import { emit } from '@/server/events/bus';
import { getAgentBySlug, requireProject } from '@/server/orchestrator/repo';
import { seedPermissions } from '@/server/orchestrator/moderator';
import { getRuntime } from '@/server/providers/registry';

export const dynamic = 'force-dynamic';

/** Runtime catalogue plus the live NVIDIA model catalogue. Secrets are never returned. */
export const GET = userRoute(async ({ db }) => {
  const runtimes = describeRuntimes();
  const project = await requireProject(db);
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
        await seedPermissions(db, inserted.rows[0].id, 'GENERIC', db.userId);
        for (const capability of runtime.capabilities) {
          await db.query(
            'insert into agent_capabilities (agent_id, capability) values ($1, $2) on conflict do nothing',
            [inserted.rows[0].id, capability],
          );
        }
        await emit(db, {
          project_id: project.id,
          type: 'agent.created',
          actor: userActor(db.user),
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
      nvidia: { configured: false, models: [], total: 0, providers: [] as string[], agent: agent ? { id: agent.id, model: agent.model } : null },
    };
  }

  try {
    const models = await listNvidiaModels();
    return {
      runtimes,
      nvidia: {
        configured: true,
        models,
        total: models.length,
        providers: [...new Set(models.map((m) => m.id.split('/')[0]).filter(Boolean))].sort(),
        agent: agent ? { id: agent.id, model: agent.model } : null,
      },
    };
  } catch (e) {
    return {
      runtimes,
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
