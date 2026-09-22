import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { projectUpdateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { clearGithubCache } from '@/server/github/client';

export const dynamic = 'force-dynamic';

export const PATCH = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, projectUpdateSchema);
    const project = await requireProject(db);
    const [owner, name] = body.repo === undefined ? [project.repo_owner, project.repo_name] : body.repo ? body.repo.split('/') : [null, null];
    const settings = {
      ...project.settings,
      ...(body.tool_servers ? { tool_servers: body.tool_servers } : {}),
      ...(body.default_reviewer !== undefined ? { default_reviewer: body.default_reviewer } : {}),
      ...(body.daily_token_budget !== undefined ? { daily_token_budget: body.daily_token_budget } : {}),
      ...(body.deploy_workflow !== undefined ? { deploy_workflow: body.deploy_workflow || undefined } : {}),
    };
    await db.query(
      `update projects set name=coalesce($2,name), description=coalesce($3,description), repo_owner=$4, repo_name=$5,
          default_branch=coalesce($6,default_branch), mode=coalesce($7,mode), max_auto_hops=coalesce($8,max_auto_hops), settings=$9
        where id=$1`,
      [project.id, body.name ?? null, body.description ?? null, owner, name, body.default_branch ?? null, body.mode ?? null, body.max_auto_hops ?? null, JSON.stringify(settings)],
    );
    clearGithubCache();
    await emit(db, { project_id: project.id, type: 'project.updated', actor: userActor(user), payload: { fields: Object.keys(body) } });
    return { ok: true };
  },
  { roles: ['owner', 'moderator'] },
);
