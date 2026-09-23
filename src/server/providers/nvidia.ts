import { readApiKey } from '@/server/env';

export interface NvidiaModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

const CATALOG_URL = 'https://integrate.api.nvidia.com/v1/models';
const CACHE_MS = 60_000;

const globalCache = globalThis as typeof globalThis & {
  __accNvidiaModels?: { expiresAt: number; models: NvidiaModel[] };
};

export async function listNvidiaModels(): Promise<NvidiaModel[]> {
  const cached = globalCache.__accNvidiaModels;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const key = readApiKey('NVIDIA_API_KEY');
  if (!key) throw new Error('NVIDIA_API_KEY is not configured');

  const res = await fetch(CATALOG_URL, {
    cache: 'no-store',
    redirect: 'error',
    headers: { authorization: `Bearer ${key}` },
  });
  const raw = await res.text();

  if (!res.ok) {
    let detail = raw.slice(0, 300);
    try {
      const body = JSON.parse(raw) as { error?: { message?: string }; message?: string; detail?: string };
      detail = body.error?.message ?? body.message ?? body.detail ?? detail;
    } catch {
      // Keep the bounded raw response.
    }
    throw new Error(`NVIDIA catalogue responded ${res.status}: ${detail}`);
  }

  const parsed = JSON.parse(raw) as { data?: unknown };
  const models = Array.isArray(parsed.data)
    ? parsed.data.filter((m): m is NvidiaModel => Boolean(m && typeof m === 'object' && typeof (m as NvidiaModel).id === 'string'))
    : [];

  globalCache.__accNvidiaModels = { expiresAt: Date.now() + CACHE_MS, models };
  return models;
}

export async function nvidiaModelAvailable(model: string): Promise<boolean> {
  if (!model) return false;
  return (await listNvidiaModels()).some((m) => m.id === model);
}
