import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { agentUpsertSchema } from '@/server/validation';
import { getAgent, requireProject } from '@/server/orchestrator/repo';
import { getRuntime } from '@/server/providers/registry';
import { isApiKeyEnvAllowed } from '@/server/env';
import { emit } from '@/server/events/bus';
import { reconcileHolds } from '@/server/orchestrator/router';

export const dynamic = 'force-dynamic';

export const PATCH = userRoute<{ id: string }>(
  async ({ req, db, user, params }) => {
    const body = await readJson(req, agentUpsertSchema.partial());
    const project = await requireProject(db);
    const agent = await getAgent(db, params.id);
    if (agent.project_id !== project.id) throw new HttpError(404, 'agent not found');
    const provider = getRuntime(body.runtime ?? agent.runtime);
    if (!provider || provider.transport === 'in-process') throw new HttpError(400, 'unknown runtime');
    if (body.config?.api_key_env && !isApiKeyEnvAllowed(body.config.api_key_env)) {
      throw new HttpError(400, 'api_key_env must be the NAME of an env var ending in _API_KEY or _TOKEN');
    }
    const config = { ...agent.config, ...(body.config ?? {}) };
    if (!provider.baseUrlEditable) delete config.base_url;
    await db.query(
      `update agents set name=coalesce($2,name), runtime=$3, transport=$4, model=coalesce($5,model), role=coalesce($6,role),
          role_label=coalesce($7,role_label), description=coalesce($8,description), color=coalesce($9,color),
          config=$10, enabled=coalesce($11,enabled)
        where id=$1`,
      [
        agent.id,
        body.name ?? null,
        provider.id,
        provider.transport,
        body.model ?? null,
        body.role ?? null,
        body.role_label ?? null,
        body.description ?? null,
        body.color ?? null,
        JSON.stringify(config),
        body.enabled ?? null,
      ],
    );
    if (body.enabled !== undefined) await reconcileHolds(db, project.id);
    await emit(db, { project_id: project.id, type: 'agent.updated', actor: userActor(user), agent_id: agent.id, payload: {} });
    return { ok: true };
  },
  { roles: ['owner', 'moderator'] },
);
