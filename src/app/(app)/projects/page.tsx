'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { ProjectListItem } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal, timeAgo } from '@/components/ui';

/**
 * Multi-project switcher. Each project is fully independent (own agents,
 * tasks, memory, knowledge — see supabase/migrations/0008_multi_project.sql):
 * switching changes which project THIS user's requests resolve against.
 * Other moderators keep whatever project they last switched to.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await api<{ projects: ProjectListItem[]; current_project_id: string }>('/api/projects');
      setProjects(r.projects);
      setCurrentId(r.current_project_id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function activate(id: string) {
    if (id === currentId) return;
    setSwitching(id);
    try {
      await api(`/api/projects/${id}`, { method: 'PATCH', body: { activate: true } });
      setCurrentId(id);
      // most of the app reads the project from the live snapshot; a reload
      // is the simplest way to make every page (including the SSE stream) agree.
      window.location.href = '/';
    } catch (e) {
      alert((e as Error).message);
      setSwitching(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Proyectos</h1>
          <p className="text-xs text-fg-dim">
            Cada proyecto tiene sus propios agentes, tareas, memoria y knowledge. Cambiar de proyecto solo te afecta a ti.
          </p>
        </div>
        <Button variant="accent" className="ml-auto" onClick={() => setCreating(true)}>
          + Nuevo proyecto
        </Button>
      </div>

      {loading ? (
        <Empty>Cargando…</Empty>
      ) : projects.length === 0 ? (
        <Empty>Sin proyectos todavía.</Empty>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div key={p.id} className={cx('flex items-center gap-3 rounded-lg border p-3', p.id === currentId ? 'border-accent/50 bg-accent-soft' : 'border-line bg-ink-900')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">{p.key}</span>
                  {p.id === currentId && <span className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent">actual</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-dim">
                  <span>{p.repo_owner && p.repo_name ? `${p.repo_owner}/${p.repo_name}` : 'sin repo'}</span>
                  <span>⎇ {p.default_branch}</span>
                  <span>· modo {p.mode.toLowerCase()}</span>
                  <span>· creado {timeAgo(p.created_at)}</span>
                </div>
              </div>
              <Button size="sm" variant={p.id === currentId ? 'default' : 'primary'} disabled={p.id === currentId || switching === p.id} onClick={() => activate(p.id)}>
                {p.id === currentId ? 'En uso' : switching === p.id ? 'Cambiando…' : 'Usar este proyecto'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <CreateProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          // creating a project also activates it — reload everything (same as
          // `activate`), not just this page's local list, so the header/chat/
          // agents/etc. agree with the new current project immediately.
          window.location.href = '/';
        }}
      />
    </div>
  );
}

function CreateProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ project_name: '', project_key: '', repo: '', default_branch: 'main' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/projects', { body: form });
      setForm({ project_name: '', project_key: '', repo: '', default_branch: 'main' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo proyecto">
      <div className="space-y-3">
        <Field label="Nombre">
          <input className={inputCls} value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} />
        </Field>
        <Field label="Clave" hint="2–10 mayúsculas/dígitos, empieza con letra (p. ej. SEC).">
          <input
            className={inputCls}
            value={form.project_key}
            onChange={(e) => setForm({ ...form, project_key: e.target.value.toUpperCase() })}
            placeholder="SEC"
          />
        </Field>
        <Field label="Repositorio (opcional)" hint="owner/nombre">
          <input className={inputCls} value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="acme/web" />
        </Field>
        <Field label="Rama por defecto">
          <input className={inputCls} value={form.default_branch} onChange={(e) => setForm({ ...form, default_branch: e.target.value })} />
        </Field>
        <p className="text-[11px] text-fg-dim">Se crea con el mismo roster de agentes por defecto (Claude, GPT/Codex, NVIDIA NIM, Gemini) que el primer proyecto.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.project_name.trim() || !/^[A-Z][A-Z0-9]{1,9}$/.test(form.project_key)} onClick={submit}>
            Crear y usar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
