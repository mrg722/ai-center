'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import type { KnowledgeDocumentView } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal, timeAgo } from '@/components/ui';

/**
 * Knowledge Store: reference material (documents, chunked on insert).
 * Distinct from Memory (/memory) — experience/decisions/state, not reference
 * docs. See docs/ARCHITECTURE_AI_PLATFORM.md § 3.
 */
export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocumentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const params = category ? `?category=${encodeURIComponent(category)}` : '';
      const r = await api<{ documents: KnowledgeDocumentView[] }>(`/api/knowledge${params}`);
      setDocs(r.documents);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const categories = useMemo(() => [...new Set(docs.map((d) => d.category).filter(Boolean))].sort(), [docs]);

  async function remove(id: string) {
    if (!confirm('¿Borrar este documento y sus chunks?')) return;
    try {
      await api(`/api/knowledge/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggle(d: KnowledgeDocumentView) {
    try {
      await api(`/api/knowledge/${d.id}`, { method: 'PATCH', body: { enabled: !d.enabled } });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Knowledge</h1>
          <p className="text-xs text-fg-dim">Biblioteca de referencia. Se trocea (chunking) al guardar; la recuperación es acotada, con o sin embeddings.</p>
        </div>
        <Button variant="accent" className="ml-auto" onClick={() => setCreating(true)}>
          + Nuevo documento
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={!category} label="Todas" onClick={() => setCategory('')} />
        {categories.map((c) => (
          <FilterChip key={c} active={category === c} label={c} onClick={() => setCategory(c)} />
        ))}
      </div>

      {loading ? (
        <Empty>Cargando…</Empty>
      ) : docs.length === 0 ? (
        <Empty>Sin documentos todavía.</Empty>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-900 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{d.title}</span>
                  <span className={cx('shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]', d.scope === 'global' ? 'bg-accent-soft text-accent' : 'bg-ink-800 text-fg-dim')}>
                    {d.scope}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-dim">
                  <span>{d.category || 'sin categoría'}</span>
                  <span>· v{d.version}</span>
                  <span>· {d.source}</span>
                  {d.path && <span>· {d.path}</span>}
                  <span>· {timeAgo(d.updated_at)}</span>
                  {!d.enabled && <span className="rounded border border-st-error/40 px-1.5 py-0.5 text-st-error">deshabilitado</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => toggle(d)}>
                {d.enabled ? 'Deshabilitar' : 'Habilitar'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove(d.id)}>
                Borrar
              </Button>
            </div>
          ))}
        </div>
      )}

      <CreateDocModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx('rounded-full border px-2.5 py-1 text-[11px]', active ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line-strong text-fg-dim hover:text-fg-muted')}
    >
      {label}
    </button>
  );
}

function CreateDocModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', category: '', content: '' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ chunks: number }>('/api/knowledge', { body: form });
      alert(`Documento creado (${r.chunks} chunk(s)).`);
      setForm({ title: '', category: '', content: '' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo documento de conocimiento" wide>
      <div className="space-y-3">
        <Field label="Título">
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Categoría">
          <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="security" />
        </Field>
        <Field label="Contenido" hint="Se trocea automáticamente por párrafos.">
          <textarea className={cx(inputCls, 'min-h-48')} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.title.trim() || !form.content.trim()} onClick={submit}>
            Crear
          </Button>
        </div>
      </div>
    </Modal>
  );
}
