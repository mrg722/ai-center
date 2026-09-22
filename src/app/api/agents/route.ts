import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { agentUpsertSchema } from '@/server/validation';
import { agentViews, getAgentBySlug, requireProject } from '@/server/orchestrator/repo';
import { describeRuntimes, getRuntime } from '@/server/providers/registry';
import { isApiKeyEnvAllowed } from '@/server/env';
import { nextSortOrder, seedPermissions } from '@/server/orchestrator/moderator';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

export const GET = userRoute(async ({ db }) => {
  const project = await requireProject(db);
  return { agents: await agentViews(db, project), runtimes: describeRuntimes() };
});

/** Add a new AI to the team — any registered runtime, no core changes. */
export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, agentUpsertSchema);
    const project = await requireProject(db);
    const config = body.config ?? {};
    const provider = getRuntime(body.runtime);
    if (!provider || provider.transport === 'in-process') throw new HttpError(400, `unknown runtime ${body.runtime}`);
    if (config.api_key_env && !isApiKeyEnvAllowed(config.api_key_env)) {
      throw new HttpError(400, 'api_key_env must be the NAME of an env var ending in _API_KEY or _TOKEN (never the key itself)');
    }
    if (config.base_url && !provider.baseUrlEditable) delete config.base_url;
    if (await getAgentBySlug(db, project.id, body.slug)) throw new HttpError(409, 'slug already in use');
    const r = await db.query<{ id: string }>(
      `insert into agents (project_id, slug, name, runtime, transport, model, role, role_label, description, color, config, enabled, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [
        project.id,
        body.slug,
        body.name,
        provider.id,
        provider.transport,
        body.model,
        body.role,
        body.role_label,
        body.description,
        body.color,
        JSON.stringify(config),
        body.enabled,
        await nextSortOrder(db, project.id),
      ],
    );
    await seedPermissions(db, r.rows[0].id, body.role, user.id);
    for (const c of provider.capabilities) {
      await db.query('insert into agent_capabilities (agent_id, capability) values ($1,$2) on conflict do nothing', [r.rows[0].id, c]);
    }
    await emit(db, { project_id: project.id, type: 'agent.created', actor: userActor(user), agent_id: r.rows[0].id, payload: { slug: body.slug } });
    return { id: r.rows[0].id };
  },
  { roles: ['owner', 'moderator'] },
);
