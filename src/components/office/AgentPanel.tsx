'use client';

import Link from 'next/link';
import { useLive } from '@/lib/client/live';
import type { AgentView } from '@/lib/client/types';
import { describeEvent } from '../Panels';
import { AgentAvatar, Button, StatusBadge, TaskStatusBadge, timeAgo } from '../ui';
import { api } from '@/lib/client/api';

/** Detail drawer for the agent selected in the office (or the moderator desk). */
export function AgentPanel({ agentId, onClose, onMessage }: { agentId: string; onClose: () => void; onMessage?: (id: string) => void }) {
  const { snap, activity, liveEvents } = useLive();
  if (!snap) return null;

  if (agentId === 'moderator') {
    return (
      <aside className="flex h-full flex-col gap-3 overflow-y-auto p-4" data-testid="agent-panel">
        <Header name={snap.me.display_name} color="#f2b544" subtitle="Moderador humano" onClose={onClose} />
        <Stat label="Modo" value={snap.project.mode} />
        <Stat label="Estado del sistema" value={snap.project.halted ? 'DETENIDO' : 'EN MARCHA'} />
        <Stat label="Aprobaciones pendientes" value={String(snap.approvals.length)} />
        <Stat label="Tareas activas" value={String(snap.tasks.filter((t) => !['COMPLETED', 'CANCELLED', 'APPROVED', 'REJECTED', 'FAILED'].includes(t.status)).length)} />
        <p className="text-xs text-fg-dim">Tu escritorio muestra en sus pantallas el estado de los agentes, las tareas y si hay aprobaciones esperando por ti.</p>
      </aside>
    );
  }

  const a = snap.agents.find((x) => x.id === agentId);
  if (!a) return null;
  const task = a.current_task_id ? snap.tasks.find((t) => t.id === a.current_task_id) : snap.tasks.find((t) => t.assigned_agent === a.id && !['COMPLETED', 'CANCELLED', 'APPROVED', 'REJECTED', 'FAILED'].includes(t.status));
  const agentMap = new Map(snap.agents.map((x) => [x.id, x]));
  const events = [...liveEvents, ...snap.events].filter((e) => e.agent_id === a.id || e.actor_id === a.id);
  const lastEvent = events.find((e) => e.id !== null);
  const lastMsgEvent = events.find((e) => e.type === 'message.created');
  const lines = activity[a.id] ?? [];

  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto p-4" data-testid="agent-panel">
      <Header name={a.name} color={a.color} subtitle={`${a.role_label}${a.simulated ? ' · SIMULADO (DEMO)' : ''}`} onClose={onClose} status={a} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Estado" value={<StatusBadge status={a.status} />} />
        <Stat label="Modelo" value={a.model || (a.transport === 'local-bridge' ? 'por defecto del CLI' : '—')} />
        <Stat label="Proveedor" value={a.provider.name} />
        <Stat label="Runtime" value={a.runtime_label} />
        <Stat label="Transporte" value={<span className="font-mono">{a.transport}</span>} />
        <Stat label="Último latido" value={timeAgo(a.last_heartbeat_at)} />
        <Stat label="Branch" value={<span className="font-mono">{a.workspace.branch ?? '—'}</span>} />
        <Stat label="Commit" value={<span className="font-mono">{a.workspace.commit?.slice(0, 10) ?? '—'}</span>} />
      </div>
      {a.status_reason && <p className="rounded-md border border-line bg-ink-850 px-2.5 py-1.5 text-[11px] text-fg-muted">{a.status_reason}</p>}

      <Section title="Tarea">
        {task ? (
          <Link href={`/tasks/${task.key}`} className="block rounded-md border border-line bg-ink-850 p-2 hover:border-line-strong">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-fg-muted">{task.key}</span>
              <TaskStatusBadge status={task.status} />
            </div>
            <div className="mt-1 text-[13px]">{task.title}</div>
          </Link>
        ) : (
          <p className="text-xs text-fg-dim">Sin tarea en curso.</p>
        )}
      </Section>

      <Section title="Actividad lógica">
        <div className="space-y-1 font-mono text-[11px]">
          {a.activity && <div className="text-fg-muted">▸ {a.activity}</div>}
          {lines.slice(0, 8).map((l, i) => (
            <div key={i} className="truncate text-fg-dim" title={l.text}>
              <span className="text-fg-muted">{l.kind}</span> {l.text}
            </div>
          ))}
          {!a.activity && !lines.length && <div className="text-fg-dim">sin actividad reciente</div>}
        </div>
      </Section>

      <Section title="Último evento / mensaje">
        <div className="space-y-1 text-[11px] text-fg-muted">
          <div>{lastEvent ? `${describeEvent(lastEvent, agentMap) ?? lastEvent.type} · ${timeAgo(lastEvent.created_at)}` : '—'}</div>
          <div className="text-fg-dim">{lastMsgEvent ? String(lastMsgEvent.payload.preview ?? '').slice(0, 160) : '—'}</div>
        </div>
      </Section>

      {a.workspace.dirty_files && a.workspace.dirty_files.length > 0 && (
        <Section title={`Archivos actuales · ${a.workspace.dirty_files.length}`}>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-fg-muted">
            {a.workspace.dirty_files.slice(0, 30).map((f) => (
              <li key={f} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Herramientas activas">
        <div className="flex flex-wrap gap-1">
          {(a.tools.length ? a.tools : a.transport !== 'local-bridge' ? [a.transport] : []).map((t) => (
            <span key={t} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              {t}
            </span>
          ))}
          {!a.tools.length && a.transport === 'local-bridge' && <span className="text-[11px] text-fg-dim">bridge no conectado</span>}
        </div>
      </Section>

      <Section title="Capacidades (lo que puede hacer)">
        <div className="flex flex-wrap gap-1">
          {a.capabilities.map((c) => (
            <span key={c} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              {c}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Permisos (lo que se le permite)">
        <div className="flex flex-wrap gap-1">
          {Object.entries(a.permissions).map(([k, v]) => (
            <span key={k} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${v ? 'bg-st-online/10 text-st-online' : 'bg-ink-800 text-fg-dim line-through'}`}>
              {k}
            </span>
          ))}
        </div>
      </Section>

      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        {onMessage && (
          <Button size="sm" variant="primary" onClick={() => onMessage(a.id)}>
            Enviar mensaje
          </Button>
        )}
        <Button size="sm" onClick={() => api(`/api/agents/${a.id}/control`, { body: { op: a.paused ? 'resume' : 'pause' } }).catch((e) => alert(e.message))}>
          {a.paused ? 'Reanudar' : 'Pausar'}
        </Button>
        <Link href="/agents" className="inline-flex h-7 items-center rounded-md px-2.5 text-xs text-fg-dim hover:text-fg">
          Configurar ↗
        </Link>
      </div>
    </aside>
  );
}

function Header({ name, color, subtitle, onClose, status }: { name: string; color: string; subtitle: string; onClose: () => void; status?: AgentView }) {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar name={name} color={color} size={36} status={status?.status} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold" style={{ color }}>
          {name}
        </h2>
        <p className="truncate text-xs text-fg-dim">{subtitle}</p>
      </div>
      <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-ink-800 hover:text-fg" aria-label="Cerrar panel">
        ✕
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-ink-850 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className="mt-0.5 truncate text-xs">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">{title}</h3>
      {children}
    </section>
  );
}
