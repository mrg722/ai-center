'use client';

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/client/api';

type Model = { id: string; object?: string; created?: number; owned_by?: string };
type Payload = {
  nvidia: {
    configured: boolean;
    models: Model[];
    total: number;
    providers: string[];
    agent: { id: string; model: string } | null;
    error?: string;
  };
};

const GREEN = '#76b900';

// Memoized: this panel manages its own data (a 60s poll of /api/providers,
// not the SSE snapshot), so it has no reason to re-render just because the
// dashboard page re-renders for something unrelated (e.g. an agent status
// tick). Requires the parent to pass a stable `onSelectAgent`.
export const NvidiaNimPanel = memo(function NvidiaNimPanel({ onSelectAgent }: { onSelectAgent?: (id: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const x = await api<Payload>('/api/providers');
      setData(x);
      setSelected((current) => current || x.nvidia.agent?.model || x.nvidia.models[0]?.id || '');
      setMsg(x.nvidia.error ?? '');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar NVIDIA NIM');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.nvidia.models ?? [];
    return (data?.nvidia.models ?? []).filter((m) =>
      [m.id, m.owned_by ?? ''].join(' ').toLowerCase().includes(needle),
    );
  }, [data, q]);

  async function choose(model: Model) {
    const agentId = data?.nvidia.agent?.id;
    if (!agentId) return;
    setBusy(true);
    setMsg('');
    try {
      await api<{ ok: boolean; model: string }>(`/api/agents/${agentId}/control`, {
        method: 'POST',
        body: { op: 'set_model', model: model.id },
      });
      setSelected(model.id);
      setData((d) => (d ? { ...d, nvidia: { ...d.nvidia, agent: { id: agentId, model: model.id } } } : d));
      onSelectAgent?.(agentId);
      setMsg('Modelo NVIDIA activo: ' + model.id);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo seleccionar el modelo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-lg border border-line bg-ink-900">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: GREEN }} />
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded bg-[#76b900] text-[10px] font-black text-black">N</span>
            <div>
              <h2 className="text-sm font-semibold">NVIDIA NIM</h2>
              <p className="text-[11px] text-fg-dim">Un agente · catálogo dinámico · cambio de modelo sin crear agentes</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 font-mono text-[10px]">
            <Badge>{data ? `${data.nvidia.total} modelos` : 'cargando…'}</Badge>
            <Badge>{data ? `${data.nvidia.providers.length} proveedores` : '—'}</Badge>
            <Badge tone={data?.nvidia.configured ? 'green' : 'amber'}>
              {data?.nvidia.configured ? 'NVIDIA_API_KEY ✓' : 'Falta NVIDIA_API_KEY'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cualquier modelo NVIDIA…"
            className="h-9 rounded-md border border-line bg-ink-850 px-3 text-xs"
          />
          <button onClick={() => void load()} className="h-9 rounded-md border border-line px-3 text-xs text-fg-muted">
            Actualizar
          </button>
        </div>

        {data?.nvidia.configured && (
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4">
            {visible.slice(0, 80).map((m) => {
              const active = m.id === selected;
              return (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() => void choose(m)}
                  className={'rounded-md border p-2 text-left ' + (active ? 'border-[#76b900]/70 bg-[#76b900]/10' : 'border-line bg-ink-850')}
                >
                  <div className="truncate text-xs font-medium">{m.id}</div>
                  <div className="mt-1 truncate text-[9px] text-fg-dim">{m.owned_by ?? 'NVIDIA API Catalog'}</div>
                </button>
              );
            })}
          </div>
        )}

        {visible.length > 80 && (
          <div className="text-[10px] text-fg-dim">Mostrando 80 de {visible.length}. Usa la búsqueda para localizar cualquier modelo.</div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
          <span className="text-[10px] text-fg-dim">
            {msg || (data?.nvidia.configured ? 'Selecciona un modelo; el agente NVIDIA sigue siendo uno solo.' : 'Configura NVIDIA_API_KEY en Vercel para cargar el catálogo.')}
          </span>
          <div className="flex gap-2">
            {data?.nvidia.agent && (
              <button onClick={() => onSelectAgent?.(data.nvidia.agent!.id)} className="rounded bg-[#76b900] px-3 py-1.5 text-[11px] font-semibold text-black">
                Hablar con NVIDIA
              </button>
            )}
            <a href="https://build.nvidia.com/models" target="_blank" rel="noreferrer" className="rounded border border-line px-3 py-1.5 text-[11px]">
              Catálogo NVIDIA ↗
            </a>
          </div>
        </div>
        <p className="text-[10px] text-fg-dim">El catálogo se consulta desde el servidor y se refresca automáticamente. La clave nunca llega al navegador.</p>
      </div>
    </section>
  );
});

function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'green' | 'amber' }) {
  return (
    <span className={'rounded border px-1.5 py-0.5 ' + (tone === 'green' ? 'border-st-online/30 text-st-online' : tone === 'amber' ? 'border-st-warn/30 text-st-warn' : 'border-line text-fg-dim')}>
      {children}
    </span>
  );
}
