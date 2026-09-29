import { readApiKey } from '@/server/env';

/**
 * OpenRouter model catalogue + usage status. Mirrors src/server/providers/nvidia.ts
 * (same cache/error-shape pattern) but stays read-only — unlike NVIDIA, OpenRouter
 * isn't a singleton auto-provisioned agent; any agent can point at it via the
 * `openrouter` runtime, so this module only exposes data for the UI's model
 * picker and usage display.
 */
export interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  free: boolean;
}

export interface OpenRouterKeyStatus {
  limit: number | null;
  usage: number;
  limit_remaining: number | null;
  is_free_tier: boolean;
  rate_limit: { requests: number; interval: string } | null;
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/auth/key';
const CACHE_MS = 60_000;

const g = globalThis as typeof globalThis & { __accOpenRouterModels?: { expiresAt: number; models: OpenRouterModel[] } };

function isFree(m: { id?: string; pricing?: { prompt?: string; completion?: string } }): boolean {
  if (typeof m.id === 'string' && m.id.endsWith(':free')) return true;
  const p = m.pricing;
  return Boolean(p && Number(p.prompt ?? '1') === 0 && Number(p.completion ?? '1') === 0);
}

/** Public catalogue — no API key required, so this works even before the operator configures OPENROUTER_API_KEY. */
export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  const cached = g.__accOpenRouterModels;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const res = await fetch(MODELS_URL, { cache: 'no-store', redirect: 'error' });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter model catalogue responded ${res.status}: ${raw.slice(0, 300)}`);

  const parsed = JSON.parse(raw) as { data?: unknown };
  const models = (Array.isArray(parsed.data) ? parsed.data : [])
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string'))
    .map((m) => ({
      id: m.id as string,
      name: typeof m.name === 'string' ? m.name : undefined,
      context_length: typeof m.context_length === 'number' ? m.context_length : undefined,
      free: isFree(m as { id?: string; pricing?: { prompt?: string; completion?: string } }),
    }));

  g.__accOpenRouterModels = { expiresAt: Date.now() + CACHE_MS, models };
  return models;
}

export function invalidateOpenRouterModelsCache(): void {
  g.__accOpenRouterModels = undefined;
}

/** Usage/limit/reset info for the configured key — best-effort; returns null rather than throwing so it never blocks the models list. */
export async function getOpenRouterKeyStatus(): Promise<OpenRouterKeyStatus | null> {
  const key = readApiKey('OPENROUTER_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch(KEY_URL, { cache: 'no-store', redirect: 'error', headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const parsed = (await res.json()) as { data?: { limit?: number | null; usage?: number; limit_remaining?: number | null; is_free_tier?: boolean; rate_limit?: { requests?: number; interval?: string } } };
    const d = parsed.data;
    if (!d) return null;
    return {
      limit: d.limit ?? null,
      usage: d.usage ?? 0,
      limit_remaining: d.limit_remaining ?? null,
      is_free_tier: Boolean(d.is_free_tier),
      rate_limit: d.rate_limit?.requests && d.rate_limit?.interval ? { requests: d.rate_limit.requests, interval: d.rate_limit.interval } : null,
    };
  } catch {
    return null;
  }
}
