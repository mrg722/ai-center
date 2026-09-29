import { userRoute } from '@/server/http/route';
import { clearSecurityUnlock } from '@/server/security/pin';

export const dynamic = 'force-dynamic';

/** Owner-only. Re-locks Security Lab for this browser session before the 2h window expires. */
export const POST = userRoute(
  async () => {
    await clearSecurityUnlock();
    return { ok: true };
  },
  { roles: ['owner'] },
);
