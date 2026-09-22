import { userRoute } from '@/server/http/route';
import { describeRuntimes } from '@/server/providers/registry';

export const dynamic = 'force-dynamic';

/** Runtime catalogue (provider · runtime · transport). Reports only whether a key is present — never its value. */
export const GET = userRoute(async () => ({ runtimes: describeRuntimes() }));
