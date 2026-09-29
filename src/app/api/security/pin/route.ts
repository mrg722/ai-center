import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { securityPinSetSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { hasSecurityPin, hasSecurityUnlock, setSecurityPin } from '@/server/security/pin';

export const dynamic = 'force-dynamic';

/** Owner-only. Setting/changing the PIN never requires the unlock cookie —
 * changing it with the correct current_pin IS the proof of knowledge. */
export const GET = userRoute(
  async ({ db, user }) => {
    const project = await requireProject(db, user.id);
    return { pin_set: await hasSecurityPin(db, project.id), unlocked: await hasSecurityUnlock(project.id, user.id) };
  },
  { roles: ['owner'] },
);

export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, securityPinSetSchema);
    const project = await requireProject(db, user.id);
    await setSecurityPin(db, project.id, body.pin, body.current_pin);
    await emit(db, { project_id: project.id, type: 'security.pin_changed', actor: userActor(user), payload: {} });
    return { ok: true };
  },
  { roles: ['owner'] },
);
