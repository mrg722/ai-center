import { userRoute, HttpError, readJson } from '@/server/http/route';
import { securityPinUnlockSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { grantSecurityUnlock, hasSecurityPin, verifySecurityPin } from '@/server/security/pin';

export const dynamic = 'force-dynamic';

/** Owner-only. Enters the Security Lab PIN, grants a 2h unlock cookie. */
export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, securityPinUnlockSchema);
    const project = await requireProject(db, user.id);
    if (!(await hasSecurityPin(db, project.id))) throw new HttpError(409, 'No PIN set yet — set one first (POST /api/security/pin)');
    if (!(await verifySecurityPin(db, project.id, body.pin))) throw new HttpError(403, 'incorrect PIN');
    await grantSecurityUnlock(project.id, user.id);
    return { ok: true };
  },
  { roles: ['owner'] },
);
