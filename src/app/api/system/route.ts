import { after } from 'next/server';
import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { systemControlSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { resumeAll, setMode, stopAll } from '@/server/orchestrator/moderator';
import { drainHostedQueue } from '@/server/orchestrator/hosted';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // these routes trigger after(() => drainHostedQueue()), which calls a real provider and can take a while (non-streamed, large-model completions)

/** STOP ALL / RESUME / mode switch. */
export const POST = userRoute(async ({ req, db, user }) => {
  const body = await readJson(req, systemControlSchema);
  const project = await requireProject(db);
  const actor = userActor(user);
  if (body.op === 'stop_all') await stopAll(db, project, actor, body.reason ?? '');
  else if (body.op === 'resume_all') {
    await resumeAll(db, project, actor);
    after(() => drainHostedQueue());
  } else await setMode(db, project, actor, body.mode);
  return { ok: true };
});
