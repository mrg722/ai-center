/**
 * Runs once per server instance. On long-running servers (local dev,
 * `next start`, Docker) it periodically ticks the hosted-agent queue and
 * presence sweeper through the protected HTTP endpoint instead of importing
 * Node-only database drivers into Next's special instrumentation bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const enabled = (process.env.ACC_INPROCESS_WORKER ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  if (!enabled) return;

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[acc] in-process worker disabled: CRON_SECRET is missing');
    return;
  }

  const tick = () => {
    fetch(new URL('/api/cron/tick', appUrl), {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    }).catch((e) => console.error('[acc] worker tick', e));
  };

  const timer = setInterval(tick, 5000);
  timer.unref?.();
}
