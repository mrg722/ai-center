'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import type { AgentDefinitionView, SkillDefinitionView } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal } from '@/components/ui';

type Tab = 'skills' | 'agents';

const SECURITY_LEVEL_TONE: Record<SkillDefinitionView['security_level'], string> = {
  standard: 'text-fg-muted border-line-strong',
  elevated: 'text-st-thinking border-st-thinking/40',
  restricted: 'text-st-error border-st-error/40',
};

/**
 * Skill Registry + Agent Registry (catalogue) browser. These are TEMPLATES
 * (identity/mission/skills) — never the executable agent, which stays the
 * `agents` table shown on /agents (runtime + model + permissions). See
 * docs/ARCHITECTURE_AI_PLATFORM.md.
 */
export default function SkillsPage() {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<SkillDefinitionView[]>([]);
  const [definitions, setDefinitions] = useState<AgentDefinitionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [division, setDivision] = useState('');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [inspectSkill, setInspectSkill] = useState<SkillDefinitionView | null>(null);
  const [inspectAgent, setInspectAgent] = useState<AgentDefinitionView | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api<{ skills: SkillDefinitionView[] }>('/api/registry/skills'),
        api<{ definitions: AgentDefinitionView[] }>('/api/registry/agents'),
      ]);
      setSkills(s.skills);
      setDefinitions(a.definitions);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const categories = useMemo(() => [...new Set(skills.map((s) => s.category).filter(Boolean))].sort(), [skills]);
  const divisions = useMemo(() => [...new Set(definitions.map((d) => d.division).filter(Boolean))].sort(), [definitions]);
  const filteredSkills = useMemo(() => (category ? skills.filter((s) => s.category === category) : skills), [skills, category]);
  const filteredAgents = useMemo(() => (division ? definitions.filter((d) => d.division === division) : definitions), [definitions, division]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Skills &amp; Catálogo de Agentes</h1>
          <p className="text-xs text-fg-dim">
            Skills = conocimiento/procedimiento, independiente del modelo. Definiciones de agente = identidad + misión + skills; se convierten en
            un agente ejecutable en <a href="/agents" className="underline hover:text-fg">/agents</a> eligiendo runtime/modelo.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {tab === 'skills' ? (
            <Button variant="accent" onClick={() => setCreatingSkill(true)}>
              + Nueva skill
            </Button>
          ) : (
            <Button variant="accent" onClick={() => setCreatingAgent(true)}>
              + Nueva definición
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-line" role="tablist">
        {(
          [
            { id: 'skills' as const, label: `Skills (${skills.length})` },
            { id: 'agents' as const, label: `Definiciones de agentes (${definitions.length})` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx('px-3 py-2 text-xs font-medium', tab === t.id ? 'border-b-2 border-accent text-fg' : 'text-fg-dim hover:text-fg-muted')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Empty>Cargando…</Empty>
      ) : tab === 'skills' ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={!category} label="Todas" onClick={() => setCategory('')} />
            {categories.map((c) => (
              <FilterChip key={c} active={category === c} label={c} onClick={() => setCategory(c)} />
            ))}
          </div>
          {filteredSkills.length === 0 ? (
            <Empty>Sin skills todavía.</Empty>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSkills.map((s) => (
                <button key={s.id} onClick={() => setInspectSkill(s)} className="rounded-lg border border-line bg-ink-900 p-3 text-left hover:border-line-strong">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{s.name}</span>
                    <span className={cx('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', SECURITY_LEVEL_TONE[s.security_level])}>
                      {s.security_level}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-fg-dim">{s.description || 'Sin descripción.'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-dim">
                    <span className="rounded bg-ink-800 px-1.5 py-0.5">{s.category || 'sin categoría'}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5">v{s.version}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5">{s.source}</span>
                    {!s.enabled && <span className="rounded border border-st-error/40 px-1.5 py-0.5 text-st-error">deshabilitada</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={!division} label="Todas" onClick={() => setDivision('')} />
            {divisions.map((d) => (
              <FilterChip key={d} active={division === d} label={d} onClick={() => setDivision(d)} />
            ))}
          </div>
          {filteredAgents.length === 0 ? (
            <Empty>
              Sin definiciones todavía. Importa el catálogo de{' '}
              <code className="rounded bg-ink-800 px-1 py-0.5">github.com/msitarzewski/agency-agents</code> con{' '}
              <code className="rounded bg-ink-800 px-1 py-0.5">npm run registry:import:agency</code>, o crea una a mano.
            </Empty>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((d) => (
                <button key={d.id} onClick={() => setInspectAgent(d)} className="rounded-lg border border-line bg-ink-900 p-3 text-left hover:border-line-strong">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{d.name}</span>
                    {d.customized && <span className="shrink-0 rounded border border-accent/40 px-1.5 py-0.5 font-mono text-[10px] text-accent">editado</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-fg-dim">{d.description || 'Sin descripción.'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-dim">
                    <span className="rounded bg-ink-800 px-1.5 py-0.5">{d.division || 'sin división'}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5">{d.source}</span>
                    {d.skills.length > 0 && <span className="rounded bg-ink-800 px-1.5 py-0.5">{d.skills.length} skill(s)</span>}
                    {!d.enabled && <span className="rounded border border-st-error/40 px-1.5 py-0.5 text-st-error">deshabilitada</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={Boolean(inspectSkill)} onClose={() => setInspectSkill(null)} title={inspectSkill?.name ?? ''} wide>
        {inspectSkill && (
          <div className="space-y-3 text-sm">
            <p className="text-fg-muted">{inspectSkill.description}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-fg-dim">
              <span>categoría: {inspectSkill.category || '—'}</span>
              <span>versión: {inspectSkill.version}</span>
              <span>origen: {inspectSkill.source}</span>
              <span>nivel: {inspectSkill.security_level}</span>
              {inspectSkill.required_tools.length > 0 && <span>herramientas: {inspectSkill.required_tools.join(', ')}</span>}
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-ink-950 p-3 text-xs text-fg-muted">{inspectSkill.instructions}</pre>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(inspectAgent)} onClose={() => setInspectAgent(null)} title={inspectAgent?.name ?? ''} wide>
        {inspectAgent && (
          <div className="space-y-3 text-sm">
            <p className="text-fg-muted">{inspectAgent.description}</p>
            {inspectAgent.source === 'agency-agents' && (
              <p className="text-[11px] text-fg-dim">
                Importado de {inspectAgent.source_repo} · {inspectAgent.source_path} @ {inspectAgent.source_version}
                {inspectAgent.customized && ' · editado localmente (no se sobrescribe en un re-sync)'}
              </p>
            )}
            {inspectAgent.identity && <Section title="Identidad" text={inspectAgent.identity} />}
            {inspectAgent.mission && <Section title="Misión" text={inspectAgent.mission} />}
            {inspectAgent.workflows.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Workflow</h4>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-fg-dim">
                  {inspectAgent.workflows.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {inspectAgent.deliverables && <Section title="Entregables" text={inspectAgent.deliverables} />}
            {inspectAgent.skills.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Skills</h4>
                <div className="flex flex-wrap gap-1.5">
                  {inspectAgent.skills.map((s) => (
                    <span key={s} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px]">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <CreateSkillModal open={creatingSkill} onClose={() => setCreatingSkill(false)} onCreated={reload} />
      <CreateAgentDefinitionModal open={creatingAgent} onClose={() => setCreatingAgent(false)} onCreated={reload} />
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h4>
      <p className="whitespace-pre-wrap text-xs text-fg-dim">{text}</p>
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

function CreateSkillModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ slug: '', name: '', category: '', description: '', instructions: '' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/registry/skills', { body: form });
      setForm({ slug: '', name: '', category: '', description: '', instructions: '' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nueva skill" wide>
      <div className="space-y-3">
        <Field label="Slug (a-z0-9-)">
          <input className={inputCls} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="csrf-testing" />
        </Field>
        <Field label="Nombre">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Categoría">
          <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="security" />
        </Field>
        <Field label="Descripción">
          <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Instrucciones" hint="Se cargan bajo demanda, nunca en cada prompt.">
          <textarea className={cx(inputCls, 'min-h-32')} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.slug || !form.name} onClick={submit}>
            Crear
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateAgentDefinitionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ slug: '', name: '', division: '', description: '', identity: '', mission: '', instructions: '' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/registry/agents', { body: form });
      setForm({ slug: '', name: '', division: '', description: '', identity: '', mission: '', instructions: '' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nueva definición de agente" wide>
      <div className="space-y-3">
        <Field label="Slug (a-z0-9-)">
          <input className={inputCls} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="security-engineer" />
        </Field>
        <Field label="Nombre">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="División">
          <input className={inputCls} value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} placeholder="security" />
        </Field>
        <Field label="Descripción">
          <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Identidad">
          <textarea className={cx(inputCls, 'min-h-20')} value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} />
        </Field>
        <Field label="Misión">
          <textarea className={cx(inputCls, 'min-h-20')} value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.slug || !form.name} onClick={submit}>
            Crear
          </Button>
        </div>
      </div>
    </Modal>
  );
}
