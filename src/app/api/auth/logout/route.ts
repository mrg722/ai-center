import { publicRoute } from '@/server/http/route';
import { destroySession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export const POST = publicRoute(
  async () => {
    await destroySession();
    return { ok: true };
  },
  { key: 'logout', limit: { limit: 60, windowMs: 60_000 }, checkOrigin: true },
);
