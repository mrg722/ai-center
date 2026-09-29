import { z } from 'zod';
import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { setCurrentProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ activate: z.literal(true) });

/** Switches the CALLING USER's current project. Other moderators are unaffected. */
export const PATCH = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  await readJson(req, patchSchema);
  await setCurrentProject(db, user.id, params.id);
  await emit(db, { project_id: params.id, type: 'project.updated', actor: userActor(user), payload: { activated_by: user.id } });
  return { ok: true };
});
