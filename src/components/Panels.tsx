'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLive, useAgentMap } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { AgentView, EventView, GithubStatus, TaskSummary } from '@/lib/client/types';
import { PRIORITIES, TERMINAL_TASK_STATUSES } from '@/shared/domain';
import { AgentAvatar, Button, cx, Empty, Field, inputCls, Modal, Panel, StatusBadge, TaskStatusBadge, timeAgo } from './ui';

/* ───────────────────────────── Agents */
export function AgentRoster({ onMessage, selectedTask }: { onMessage?: (agentId: string) => void; selectedTask?: string | null }) {
  const { snap, activity } = useLive();
  const agents = snap?.agents ?? [];
  const tasks = new Map((snap?.tasks ?? []).map((t) => [t.id, t]));
  return (
    <Panel
      title="Agentes"
      actions={
        <Link href="/agents" className="text-[11px] text-fg-dim hover:text-fg">
          gestionar
        </Link>
      }
      bodyClass="overflow-y-auto"
    >
      {!agents.length && <Empty>Sin agentes.</Empty>}
      <ul className="divide-y divide-line" data-testid="agent-roster">
        {agents.map((a) => {
          const t = a.current_task_id ? tasks.get(a.current_task_id) : null;
          const line = activity[a.id]?.[0];
          return (
            <li key={a.id} className={cx('px-3 py-2.5', t && selectedTask === t.id && 'bg-ink-850')} data-agent={a.slug} data-status={a.status}>
              <div className="flex items-center gap-2.5">
                <AgentAvatar name={a.name} color={a.color} size={28} status={a.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold" style={{ color: a.color }}>
                      {a.name}
                    </span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="truncate text-[11px] text-fg-dim" title={`${a.provider.name} · ${a.runtime_label} · ${a.transport}`}>
                    {a.role_label} · {a.runtime_label}
                    {a.model ? ` · ${a.model}` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 pl-[38px] text-[11px]">
                {a.status === 'OFFLINE' || a.status === 'BLOCKED' ? (
                  <span className="text-fg-dim">{a.status_reason}</span>
                ) : (
                  <span className="block truncate font-mono text-fg-muted">
                    {t ? <span className="text-fg">{t.key} · </span> : null}
                    {line?.text ?? a.activity ?? ''}
                    {!t && !line && !a.activity && <span className="text-fg-dim">disponible</span>}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex gap-1 pl-[38px]">
                {onMessage && (
                  <Button size="sm" variant="ghost" onClick={() => onMessage(a.id)}>
                    mensaje
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => api(`/api/agents/${a.id}/control`, { body: { op: a.paused ? 'resume' : 'pause' } }).catch((e) => alert(e.message))}
                >
                  {a.paused ? 'reanudar' : 'pausar'}
                </Button>
                {['WORKING', 'THINKING', 'REVIEWING'].includes(a.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-st-error"
                    onClick={() => confirm(`¿Cancelar la ejecución actual de ${a.name}?`) && api(`/api/agents/${a.id}/control`, { body: { op: 'cancel_run' } })}
                  >
                    cancelar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ───────────────────────────── Tasks */
export function TaskList({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { snap } = useLive();
  const agents = useAgentMap();
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const all = snap?.tasks ?? [];
  const visible = showDone ? all : all.filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status) && t.status !== 'APPROVED');
  return (
    <Panel
      title={`Tareas · ${visible.length}`}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'activas' : 'todas'}
          </Button>
          <Button size="sm" variant="accent" onClick={() => setOpen(true)} data-testid="new-task">
            + Tarea
          </Button>
        </>
      }
      bodyClass="overflow-y-auto"
    >
      <button
        onClick={() => onSelect(null)}
        className={cx('flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-xs', selected === null ? 'bg-ink-800 text-fg' : 'text-fg-muted hover:bg-ink-850')}
      >
        <span className="font-mono text-[10px] text-fg-dim">#</span> Sala general · todos los mensajes
      </button>
      {!visible.length && <Empty>No hay tareas activas.</Empty>}
      <ul data-testid="task-list">
        {visible.map((t) => (
          <TaskRow key={t.id} t={t} agent={t.assigned_agent ? agents.get(t.assigned_agent) : undefined} selected={selected === t.id} onSelect={() => onSelect(t.id)} />
        ))}
      </ul>
      <NewTaskModal open={open} onClose={() => setOpen(false)} onCreated={(id) => onSelect(id)} />
    </Panel>
  );
}

function TaskRow({ t, agent, selected, onSelect }: { t: TaskSummary; agent?: AgentView; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        className={cx('cursor-pointer border-b border-line px-3 py-2.5 transition-colors', selected ? 'bg-ink-800' : 'hover:bg-ink-850')}
        data-task={t.key}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-fg-muted">{t.key}</span>
          <TaskStatusBadge status={t.status} />
          {t.paused && <span className="font-mono text-[10px] text-st-blocked">PAUSA</span>}
          {t.priority !== 'NORMAL' && <span className={cx('font-mono text-[10px]', t.priority === 'URGENT' || t.priority === 'HIGH' ? 'text-st-error' : 'text-fg-dim')}>{t.priority}</span>}
          <Link href={`/tasks/${t.key}`} onClick={(e) => e.stopPropagation()} className="ml-auto text-[11px] text-fg-dim hover:text-fg" aria-label={`Abrir ${t.key}`}>
            ↗
          </Link>
        </div>
        <div className="mt-1 truncate text-[13px]">{t.title}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-dim">
          {agent ? (
            <span className="flex items-center gap-1">
              <AgentAvatar name={agent.name} color={agent.color} size={14} /> {agent.name}
            </span>
          ) : (
            <span>sin asignar</span>
          )}
          <span>· {t.message_count} msg</span>
          <span className="ml-auto">{timeAgo(t.updated_at)}</span>
        </div>
      </div>
    </li>
  );
}

export function NewTaskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { snap } = useLive();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [assignee, setAssignee] = useState<string>('');
  const [approval, setApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && !assignee && snap?.agents.length) {
      const builder = snap.agents.find((a) => a.role === 'PRIMARY_BUILDER') ?? snap.agents[0];
      setAssignee(builder.id);
    }
  }, [open, snap, assignee]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ task: { id: string } }>('/api/tasks', {
        body: { title, description, priority, assigned_agent: assignee || null, requires_human_approval: approval },
      });
      setTitle('');
      setDescription('');
      onCreated?.(r.task.id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nueva tarea">
      <form onSubmit={submit} className="space-y-3" data-testid="new-task-form">
        <Field label="Título">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} placeholder="Quiero solucionar este problema…" autoFocus />
        </Field>
        <Field label="Descripción" hint="Contexto, criterios de aceptación, archivos relevantes. El orquestador enviará solo lo necesario a cada IA.">
          <textarea className={cx(inputCls, 'min-h-28')} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={50000} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Asignar a">
            <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">— sin asignar —</option>
              {snap?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.status})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Requiere mi aprobación para completarse
        </label>
        {err && <p className="text-xs text-st-error">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
            Crear{assignee ? ' y asignar' : ''}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────────────────────── Approvals */
export function ApprovalsPanel() {
  const { snap } = useLive();
  const agents = useAgentMap();
  const tasks = new Map((snap?.tasks ?? []).map((t) => [t.id, t]));
  const approvals = snap?.approvals ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: 'approve' | 'reject') {
    const note = decision === 'reject' ? (prompt('Motivo (opcional):') ?? '') : '';
    setBusy(id);
    try {
      await api(`/api/approvals/${id}`, { body: { decision, note } });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={`Aprobaciones · ${approvals.length}`} className={approvals.length ? 'border-accent/40' : ''} bodyClass="overflow-y-auto">
      {!approvals.length && <Empty>Nada pendiente.</Empty>}
      <ul className="divide-y divide-line" data-testid="approvals">
        {approvals.map((a) => {
          const agent = a.requested_by_agent ? agents.get(a.requested_by_agent) : null;
          const t = a.task_id ? tasks.get(a.task_id) : null;
          return (
            <li key={a.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono font-semibold uppercase text-accent">{a.action.replace('_', ' ')}</span>
                {t && <span className="font-mono text-fg-muted">{t.key}</span>}
                <span className="ml-auto text-fg-dim">{timeAgo(a.created_at)}</span>
              </div>
              <div className="text-[13px] font-medium">{a.title}</div>
              <div className="text-[11px] text-fg-dim">
                {agent ? <span style={{ color: agent.color }}>{agent.name}</span> : 'sistema'} · {a.detail.split('\n')[0].slice(0, 160)}
              </div>
              <div className="flex gap-2 pt-0.5">
                <Button size="sm" variant="accent" disabled={busy === a.id} onClick={() => decide(a.id, 'approve')} data-testid="approve">
                  ✓ Aprobar
                </Button>
                <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => decide(a.id, 'reject')}>
                  ✕ Rechazar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ───────────────────────────── Activity */
export function describeEvent(e: EventView, agents: Map<string, AgentView>): string | null {
  const who = e.actor_kind === 'agent' ? (agents.get(e.actor_id ?? '')?.name ?? 'agente') : e.actor_kind === 'user' ? 'Moderador' : 'Sistema';
  const p = e.payload;
  switch (e.type) {
    case 'message.created':
      return `${who} → ${(p.to as string[])?.length ? (p.to as string[]).join(', ') : 'sala'} · ${p.message_type}`;
    case 'task.created':
      return `${who} creó ${p.key}`;
    case 'task.updated':
      return p.status ? `${p.key}: ${p.from} → ${p.status}` : p.paused !== undefined ? `${p.key} ${p.paused ? 'en pausa' : 'reanudada'}` : null;
    case 'approval.created':
      return `Aprobación pedida: ${p.title}`;
    case 'approval.decided':
      return `${who} ${p.decision === 'APPROVED' ? 'aprobó' : 'rechazó'} ${p.action}`;
    case 'agent.connected':
      return `${who} se conectó (${p.runner})`;
    case 'agent.status':
      return `${who}: ${String(p.status).toLowerCase()}${p.activity ? ` · ${p.activity}` : ''}`;
    case 'agent.error':
      return `${who}: error · ${p.error}`;
    case 'run.started':
      return `${who} empezó ${p.message_type}`;
    case 'run.finished':
      return `${who} terminó (${String(p.status).toLowerCase()})`;
    case 'system.halted':
      return `⏹ ${who} detuvo todo`;
    case 'system.resumed':
      return `▶ ${who} reanudó el sistema`;
    case 'project.updated':
      return p.mode ? `Modo → ${p.mode}` : 'Proyecto actualizado';
    case 'permission.changed':
      return `Permiso ${p.action} de ${agents.get(e.agent_id ?? '')?.name ?? 'agente'} → ${p.revoked ? 'revocado' : p.allowed ? 'concedido' : 'denegado'}${p.temporary_minutes ? ` (${p.temporary_minutes} min)` : ''}`;
    case 'policy.decision':
      return `Política: ${p.action} de ${who} → ${p.decision === 'deny' ? 'DENEGADO' : 'requiere aprobación'} · ${p.reason}`;
    case 'agent.offline':
      return `${agents.get(e.agent_id ?? '')?.name ?? 'agente'} OFFLINE (sin latido)`;
    case 'review.created':
      return `${who} registró revisión: ${p.verdict}`;
    case 'git.updated':
      return p.command ? `${who}: ${p.command} ${p.ok ? 'ok' : 'falló'}` : `${who} en ⎇ ${p.branch}`;
    default:
      return e.type.startsWith('github.') ? `GitHub: ${e.type.slice(7)} ${p.action ?? ''}` : null;
  }
}

export function ActivityFeed({ limit = 30 }: { limit?: number }) {
  const { snap, liveEvents } = useLive();
  const agents = useAgentMap();
  const seen = new Set<number>();
  const merged = [...liveEvents, ...(snap?.events ?? [])].filter((e) => {
    if (e.id === null || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const lines = merged
    .map((e) => ({ e, text: describeEvent(e, agents) }))
    .filter((x) => x.text)
    .slice(0, limit);
  return (
    <Panel title="Actividad" bodyClass="overflow-y-auto">
      {!lines.length && <Empty>Sin actividad todavía.</Empty>}
      <ol className="space-y-px py-1" data-testid="activity">
        {lines.map(({ e, text }) => {
          const a = e.actor_kind === 'agent' ? agents.get(e.actor_id ?? '') : null;
          return (
            <li key={e.id} className="flex gap-2 px-3 py-1 text-[11px]">
              <time className="w-9 shrink-0 font-mono text-fg-dim">{timeAgo(e.created_at)}</time>
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a?.color ?? (e.actor_kind === 'user' ? '#f2b544' : '#5c6779') }} />
              <span className="min-w-0 text-fg-muted">{text}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ───────────────────────────── GitHub */
export function GithubPanel({ gh }: { gh: GithubStatus | null }) {
  return (
    <Panel title="GitHub" bodyClass="overflow-y-auto">
      {!gh && <Empty>Consultando…</Empty>}
      {gh && !gh.configured && <Empty>Sin repositorio. Configúralo en Ajustes.</Empty>}
      {gh?.configured && (
        <div className="space-y-2 px-3 py-2.5 text-[12px]" data-testid="github">
          <div className="flex items-center gap-2 font-mono">
            <span className="truncate">{gh.repo}</span>
            {gh.default_branch && <span className="text-fg-dim">⎇ {gh.default_branch}</span>}
          </div>
          {gh.error && <div className="text-[11px] text-st-blocked">{gh.error}</div>}
          {gh.head_commit && (
            <div className="text-[11px] text-fg-muted">
              <span className="font-mono text-fg">{gh.head_commit.sha.slice(0, 7)}</span> {gh.head_commit.message}
              <div className="text-fg-dim">
                {gh.head_commit.author} · {timeAgo(gh.head_commit.date)}
              </div>
            </div>
          )}
          {gh.open_prs && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-dim">PRs abiertos · {gh.open_prs.length}</div>
              {gh.open_prs.slice(0, 5).map((p) => (
                <a key={p.number} href={p.url} target="_blank" rel="noreferrer" className="block truncate py-0.5 text-[11px] text-fg-muted hover:text-fg">
                  #{p.number} {p.title} <span className="font-mono text-fg-dim">({p.head})</span>
                </a>
              ))}
            </div>
          )}
          {gh.open_issues !== undefined && <div className="text-[11px] text-fg-dim">Issues abiertos: {gh.open_issues}</div>}
        </div>
      )}
    </Panel>
  );
}
