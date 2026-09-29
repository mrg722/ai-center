'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type {
  AgentDefinitionView,
  AgentView,
  KnowledgeStats,
  RoutingEntry,
  RuntimeInfo,
  SkillDefinitionView,
  TaskSummary,
} from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Panel, StatusBadge } from '@/components/ui';

/**
 * Agent Workspace — the "AI Operating System" view of one Agent Definition:
 * identity, the executable agent behind it (runtime/model), its selected
 * skills, live memory/knowledge counts, which capability it's routed for,
 * and a way to actually run it. Everything here is real data from the
 * Context Engine's own inputs (see docs/ARCHITECTURE_AI_PLATFORM.md § 1) —
 * nothing on this page is mocked.
 */
export default function AgentWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { snap } = useLive();

  const [definition, setDefinition] = useState<AgentDefinitionView | null>(null);
  const [allSkills, setAllSkills] = useState<SkillDefinitionView[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [routing, setRouting] = useState<RoutingEntry[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runForm, setRunForm] = useState({ title: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [newAgent, setNewAgent] = useState({ slug: '', runtime: '', model: '' });
  const [editingSkills, setEditingSkills] = useState(false);

  const linkedAgent: AgentView | undefined = useMemo(() => snap?.agents.find((a) => a.agent_definition_id === id), [snap, id]);

  async function reload() {
    setLoading(true);
    try {
      const [defs, skills, prov] = await Promise.all([
        api<{ definitions: AgentDefinitionView[] }>('/api/registry/agents'),
        api<{ skills: SkillDefinitionView[] }>('/api/registry/skills'),
        api<{ runtimes: RuntimeInfo[]; model_routing: RoutingEntry[] }>('/api/providers'),
      ]);
      setDefinition(defs.definitions.find((d) => d.id === id) ?? null);
      setAllSkills(skills.skills);
      setRuntimes(prov.runtimes);
      setRouting(prov.model_routing);
      const k = await api<{ stats: KnowledgeStats }>('/api/knowledge');
      setKnowledgeStats(k.stats);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!linkedAgent) {
      setMemoryCount(null);
      return;
    }
    api<{ total: number }>(`/api/memory?agent_id=${linkedAgent.id}&archived=false`)
      .then((r) => setMemoryCount(r.total))
      .catch(() => setMemoryCount(null));
  }, [linkedAgent]);

  const definitionSkills = useMemo(() => allSkills.filter((s) => definition?.skills.includes(s.slug)), [allSkills, definition]);
  const handledCapabilities = useMemo(() => routing.filter((r) => r.resolved_agent === linkedAgent?.slug), [routing, linkedAgent]);
  const agentTasks = useMemo<TaskSummary[]>(() => (linkedAgent ? (snap?.tasks.filter((t) => t.assigned_agent === linkedAgent.id) ?? []) : []), [snap, linkedAgent]);

  async function createExecutableAgent() {
    if (!definition) return;
    const rt = runtimes.find((r) => r.id === newAgent.runtime);
    if (!rt) return alert('Elige un runtime.');
    setCreating(true);
    try {
      await api('/api/agents', {
        body: {
          slug: newAgent.slug || definition.slug,
          name: definition.name,
          runtime: rt.id,
          model: newAgent.model || rt.defaultModel,
          role: 'GENERIC',
          role_label: definition.division || definition.name,
          description: definition.description,
          agent_definition_id: definition.id,
        },
      });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleSkill(slug: string) {
    if (!definition) return;
    const next = definition.skills.includes(slug) ? definition.skills.filter((s) => s !== slug) : [...definition.skills, slug];
    // optimistic
    setDefinition({ ...definition, skills: next });
    try {
      await api(`/api/registry/agents/${definition.id}`, { method: 'PATCH', body: { skills: next } });
    } catch (e) {
      alert((e as Error).message);
      reload();
    }
  }

  async function updateRuntime(runtime: string, model: string) {
    if (!linkedAgent) return;
    try {
      await api(`/api/agents/${linkedAgent.id}`, { method: 'PATCH', body: { runtime, model } });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function runAgent() {
    if (!linkedAgent || !runForm.title.trim()) return;
    setRunning(true);
    try {
      const r = await api<{ task: { key: string } }>('/api/tasks', {
        body: { title: runForm.title, description: runForm.description, assigned_agent: linkedAgent.id, requires_human_approval: true },
      });
      router.push(`/tasks/${r.task.key}`);
    } catch (e) {
      alert((e as Error).message);
      setRunning(false);
    }
  }

  if (loading || !snap) return <Empty>Cargando…</Empty>;
  if (!definition) return <Empty>Definición no encontrada. <Link href="/skills" className="underline">Volver ↗</Link></Empty>;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-5">
      <div>
        <Link href="/skills" className="text-xs text-fg-dim hover:text-fg">
          ← Skills &amp; Catálogo
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold uppercase tracking-wide">{definition.name}</h1>
          {linkedAgent && <StatusBadge status={linkedAgent.status} />}
        </div>
        <p className="text-sm text-fg-dim">
          {definition.division || 'sin división'} {definition.description && `· ${definition.description}`}
        </p>
      </div>

      <Panel title="Runtime & Modelo">
        {linkedAgent ? (
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Runtime">
                <select className={inputCls} value={linkedAgent.runtime} onChange={(e) => updateRuntime(e.target.value, linkedAgent.model)}>
                  {runtimes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Modelo">
                <input
                  className={inputCls}
                  defaultValue={linkedAgent.model}
                  onBlur={(e) => e.target.value !== linkedAgent.model && updateRuntime(linkedAgent.runtime, e.target.value)}
                />
              </Field>
            </div>
            <p className="text-[11px] text-fg-dim">
              Agente ejecutable: <span className="font-mono text-fg-muted">{linkedAgent.slug}</span> ·{' '}
              <Link href="/agents" className="underline hover:text-fg">gestionar permisos/token ↗</Link>
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <Empty>Esta definición todavía no tiene un agente ejecutable (runtime + modelo) asociado.</Empty>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Slug">
                <input className={inputCls} placeholder={definition.slug} value={newAgent.slug} onChange={(e) => setNewAgent({ ...newAgent, slug: e.target.value })} />
              </Field>
              <Field label="Runtime">
                <select className={inputCls} value={newAgent.runtime} onChange={(e) => setNewAgent({ ...newAgent, runtime: e.target.value })}>
                  <option value="">Elegir…</option>
                  {runtimes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Modelo (opcional)">
                <input className={inputCls} placeholder="por defecto del runtime" value={newAgent.model} onChange={(e) => setNewAgent({ ...newAgent, model: e.target.value })} />
              </Field>
            </div>
            <Button variant="accent" disabled={creating || !newAgent.runtime} onClick={createExecutableAgent}>
              Crear agente ejecutable
            </Button>
          </div>
        )}
      </Panel>

      <Panel
        title={`Skills (${definitionSkills.length})`}
        actions={
          <Button size="sm" variant={editingSkills ? 'default' : 'ghost'} onClick={() => setEditingSkills((v) => !v)}>
            {editingSkills ? 'Listo' : 'Editar'}
          </Button>
        }
      >
        {editingSkills ? (
          <div className="max-h-72 space-y-1 overflow-y-auto p-3">
            {allSkills.map((s) => {
              const checked = definition?.skills.includes(s.slug) ?? false;
              return (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-ink-800">
                  <input type="checkbox" checked={checked} onChange={() => toggleSkill(s.slug)} />
                  <span>{s.name}</span>
                  <span className="text-[11px] text-fg-dim">({s.category || 'sin categoría'})</span>
                </label>
              );
            })}
          </div>
        ) : definitionSkills.length === 0 ? (
          <Empty>Sin skills asignadas todavía.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2 p-3">
            {definitionSkills.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-st-online/40 bg-st-online/10 px-2.5 py-1 text-xs text-st-online">
                ✓ {s.name}
              </span>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Memory">
          <div className="p-3">
            {linkedAgent ? (
              <>
                <div className="text-2xl font-bold">{memoryCount ?? '…'}</div>
                <Link href={`/memory?agent_id=${linkedAgent.id}`} className="text-[11px] text-fg-dim underline hover:text-fg">
                  Ver memorias de este agente ↗
                </Link>
              </>
            ) : (
              <p className="text-xs text-fg-dim">Se activa cuando el agente tenga un ejecutable asociado.</p>
            )}
          </div>
        </Panel>
        <Panel title="Knowledge (proyecto)">
          <div className="p-3">
            <div className="text-2xl font-bold">
              {knowledgeStats?.documents ?? '…'} <span className="text-sm font-normal text-fg-dim">documentos</span>
            </div>
            <div className="text-sm text-fg-muted">{knowledgeStats?.chunks ?? '…'} chunks</div>
            <Link href="/knowledge" className="text-[11px] text-fg-dim underline hover:text-fg">
              Ver biblioteca ↗
            </Link>
          </div>
        </Panel>
      </div>

      <Panel title="Capability (Model Router)">
        <div className="p-3">
          {handledCapabilities.length === 0 ? (
            <p className="text-xs text-fg-dim">Este agente no está resuelto para ninguna capability ahora mismo.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {handledCapabilities.map((c) => (
                <span key={c.capability} className="rounded bg-ink-800 px-2 py-1 text-xs">
                  {c.capability}
                </span>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Run Agent"
        actions={
          <Button size="sm" variant="primary" disabled={!linkedAgent || running || !runForm.title.trim()} onClick={runAgent}>
            {running ? 'Creando…' : '▶ Run Agent'}
          </Button>
        }
      >
        <div className="space-y-3 p-3">
          {!linkedAgent && <p className="text-xs text-st-thinking">Crea primero un agente ejecutable arriba.</p>}
          <Field label="Título de la tarea">
            <input className={inputCls} value={runForm.title} onChange={(e) => setRunForm({ ...runForm, title: e.target.value })} disabled={!linkedAgent} />
          </Field>
          <Field label="Descripción">
            <textarea className={cx(inputCls, 'min-h-24')} value={runForm.description} onChange={(e) => setRunForm({ ...runForm, description: e.target.value })} disabled={!linkedAgent} />
          </Field>
          {agentTasks.length > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] uppercase tracking-wide text-fg-dim">Tareas recientes de este agente</h4>
              <div className="space-y-1">
                {agentTasks.slice(0, 5).map((t) => (
                  <Link key={t.id} href={`/tasks/${t.key}`} className="block truncate text-xs text-fg-muted hover:text-fg">
                    {t.key} · {t.title} <span className="text-fg-dim">({t.status})</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
