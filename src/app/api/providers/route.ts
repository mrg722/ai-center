import { userRoute } from '@/server/http/route';
import { describeRuntimes } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { listNvidiaModels } from '@/server/providers/nvidia';

export const dynamic = 'force-dynamic';

/** Runtime catalogue plus the live NVIDIA model catalogue. Secrets are never returned. */
export const GET = userRoute(async () => {
  const runtimes = describeRuntimes();
  const configured = Boolean(readApiKey('NVIDIA_API_KEY'));

  if (!configured) {
    return {
      runtimes,
      nvidia: { configured: false, models: [], total: 0, providers: [] as string[] },
    };
  }

  try {
    const models = await listNvidiaModels();
    return {
      runtimes,
      nvidia: {
        configured: true,
        models,
        total: models.length,
        providers: [...new Set(models.map((m) => m.id.split('/')[0]).filter(Boolean))].sort(),
      },
    };
  } catch (e) {
    return {
      runtimes,
      nvidia: {
        configured: true,
        models: [],
        total: 0,
        providers: [] as string[],
        error: e instanceof Error ? e.message.slice(0, 500) : 'NVIDIA catalogue request failed',
      },
    };
  }
});
