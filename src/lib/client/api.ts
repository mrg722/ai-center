'use client';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: init.signal,
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const d = data as { error?: string; issues?: { path: string; message: string }[] } | undefined;
    const detail = d?.issues?.length ? `: ${d.issues.map((i) => `${i.path} ${i.message}`).join(', ')}` : '';
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth')) {
      window.location.href = '/login';
    }
    throw new ApiError(res.status, (d?.error ?? res.statusText) + detail);
  }
  return data as T;
}
