/**
 * Wakes the hosted-agent runner. Kept in its own module to avoid import
 * cycles (router → hosted → actions → router).
 *
 * On long-running servers the kick runs the queue in-process right away.
 * On serverless, API routes additionally call `after(drainHostedQueue)` and a
 * cron hits /api/cron/tick as a safety net.
 */
let pending: ReturnType<typeof setTimeout> | null = null;

export function kickHosted(delayMs = 50): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void import('./hosted').then((m) => m.drainHostedQueue()).catch((e) => console.error('[acc] hosted runner', e));
  }, delayMs);
  pending.unref?.();
}
