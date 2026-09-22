/**
 * Runs once per server instance. On long-running servers (local dev,
 * `next start`, Docker) it polls the hosted-agent queue so API agents answer
 * even if a request's after() hook was missed. Disable with
 * ACC_INPROCESS_WORKER=false (serverless deployments rely on after() + cron).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const enabled = (process.env.ACC_INPROCESS_WORKER ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  if (!enabled) return;
  const { drainHostedQueue } = await import('./server/orchestrator/hosted');
  const { sweepPresence } = await import('./server/orchestrator/bridge');
  const { getDb } = await import('./server/db');
  const timer = setInterval(() => {
    drainHostedQueue().catch((e) => console.error('[acc] hosted worker', e));
    getDb()
      .then((db) => sweepPresence(db))
      .catch((e) => console.error('[acc] presence sweep', e));
  }, 5000);
  timer.unref?.();
}
