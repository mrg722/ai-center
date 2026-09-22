/**
 * Basic fixed-window rate limiter (in-memory, per server instance).
 * Good enough for a single-moderator control plane. For multi-instance
 * production deployments swap the store for Redis/Upstash (same interface).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __accRate?: Map<string, Bucket> };
const buckets = (g.__accRate ??= new Map());

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterS: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterS: Math.ceil((b.resetAt - now) / 1000) };
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  userWrite: { limit: 120, windowMs: 60_000 },
  agentAction: { limit: 240, windowMs: 60_000 },
  bridge: { limit: 600, windowMs: 60_000 },
  webhook: { limit: 120, windowMs: 60_000 },
};
