import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { projectCreateSchema } from '@/server/validation';
import { getProjectByKey, listProjects, requireProject } from '@/server/orchestrator/repo';
import { createProject } from '@/server/orchestrator/setup';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

/** Every project (multi-project support) plus which one is "current" for this user. */
export const GET = userRoute(async ({ db, user }) => {
  const [projects, current] = await Promise.all([listProjects(db), requireProject(db, user.id)]);
  return { projects, current_project_id: current.id };
});

/** Creates a new project, fully bootstrapped (default agents/permissions/rules — same as first-run setup), and switches to it. */
export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, projectCreateSchema);
    if (await getProjectByKey(db, body.project_key)) throw new HttpError(409, `Project key "${body.project_key}" is already in use.`);
    const project = await createProject(db, { ...body, default_branch: body.default_branch || 'main' }, user.id, user.display_name);
    await emit(db, { project_id: project.id, type: 'project.updated', actor: userActor(user), payload: { created: true } });
    return { project };
  },
  { roles: ['owner', 'moderator'] },
);
