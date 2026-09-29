'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { MemoryView } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal, timeAgo } from '@/components/ui';

const TYPES = ['episodic', 'semantic', 'project', 'decision', 'preference', 'fact', 'lesson', 'security_finding', 'task_state'] as const;
const SCOPE_LABEL: Record<MemoryView['scope'], string> = { global: 'Global', project: 'Proyecto', agent: 'Agente', task: 'Tarea', conversation: 'Conversación' };

/**
 * Memory Store dashboard. Distinct from Knowledge (/knowledge): this is
 * experience/state/decisions an agent chose to remember, not reference
 * material. Never auto-populated from every message — see the `remember`
 * agent action and docs/ARCHITECTURE_AI_PLATFORM.md.
 */
export default function MemoryPage() {
  const { snap } = useLive();
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [scope, setScope] = useState('');
  const [type, setType] = useState('');
  const [agentId, setAgentId] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (type) params.set('type', type);
    if (agentId) params.set('agent_id', agentId);
    if (query) params.set('q', query);
    params.set('archived', String(showArchived));
    try {
      const r = await api<{ memories: MemoryView[] }>(`/api/memory?${params}`);
      setMemories(r.memories);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, type, agentId, showArchived]);

  const agentName = useMemo(() => {
    const m = new Map((snap?.agents ?? []).map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? (m.get(id) ?? id.slice(0, 8)) : null);
  }, [snap]);

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/memory/${id}`, { method: 'PATCH', body });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Borrar este recuerdo?')) return;
    try {
      await api(`/api/memory/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Memoria</h1>
          <p className="text-xs text-fg-dim">
            Independiente del modelo: sobrevive a un cambio de runtime/proveedor. Distinta de{' '}
            <a href="/knowledge" className="underline hover:text-fg">Knowledge</a> (material de referencia).
          </p>
        </div>
        <Button variant="accent" className="ml-auto" onClick={() => setCreating(true)}>
          + Recordar algo
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={cx(inputCls, 'w-auto')} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Todo el scope</option>
          {Object.entries(SCOPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className={cx(inputCls, 'w-auto')} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={cx(inputCls, 'w-auto')} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">Todos los agentes</option>
          {(snap?.agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input className={cx(inputCls, 'w-48')} placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reload()} />
        <Button size="sm" onClick={reload}>
          Buscar
        </Button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-dim">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          mostrar archivadas
        </label>
      </div>

      {loading ? (
        <Empty>Cargando…</Empty>
      ) : memories.length === 0 ? (
        <Empty>Sin memorias todavía. Un agente las crea con la acción &quot;remember&quot;, o añádela tú arriba.</Empty>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <div key={m.id} className="rounded-lg border border-line bg-ink-900 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-dim">
                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono uppercase tracking-wide text-fg-muted">{m.type}</span>
                <span>{SCOPE_LABEL[m.scope]}</span>
                {m.agent_id && <span>· {agentName(m.agent_id)}</span>}
                <span>· importancia {m.importance}/5</span>
                <span>· {m.source}</span>
                <span>· {timeAgo(m.created_at)}</span>
                {m.embedding_model && <span>· embedding: {m.embedding_model}</span>}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => patch(m.id, { pinned: !m.pinned })} className={cx('rounded px-1.5 py-0.5', m.pinned ? 'text-accent' : 'hover:text-fg-muted')} title="Fijar">
                    {m.pinned ? '📌' : '📍'}
                  </button>
                  <button onClick={() => patch(m.id, { archived: !m.archived })} className="rounded px-1.5 py-0.5 hover:text-fg-muted" title="Archivar">
                    {m.archived ? '↩ desarchivar' : '🗄 archivar'}
                  </button>
                  <button onClick={() => remove(m.id)} className="rounded px-1.5 py-0.5 hover:text-st-error" title="Borrar">
                    ✕
                  </button>
                </div>
              </div>
              {m.summary && <p className="mt-1.5 text-sm font-medium">{m.summary}</p>}
              <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{m.content}</p>
            </div>
          ))}
        </div>
      )}

      <CreateMemoryModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
    </div>
  );
}

function CreateMemoryModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ scope: 'project' as MemoryView['scope'], type: 'fact', content: '', summary: '', importance: 3 });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/memory', { body: form });
      setForm({ scope: 'project', type: 'fact', content: '', summary: '', importance: 3 });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Recordar algo">
      <div className="space-y-3">
        <Field label="Scope">
          <select className={inputCls} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as MemoryView['scope'] })}>
            <option value="project">Proyecto</option>
            <option value="global">Global</option>
          </select>
        </Field>
        <Field label="Tipo">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Resumen (opcional)">
          <input className={inputCls} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </Field>
        <Field label="Contenido">
          <textarea className={cx(inputCls, 'min-h-24')} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
        <Field label={`Importancia: ${form.importance}`}>
          <input type="range" min={1} max={5} value={form.importance} onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })} className="w-full" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.content.trim()} onClick={submit}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
