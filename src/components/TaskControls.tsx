'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLive, useAgentMap } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { TaskSummary } from '@/lib/client/types';
import { TERMINAL_TASK_STATUSES } from '@/shared/domain';
import { AgentAvatar, Button, TaskStatusBadge } from './ui';

/** Moderator controls for one task: continue, reassign, review, pause, cancel, approve. */
export function TaskControls({ task, showLink = true }: { task: TaskSummary; showLink?: boolean }) {
  const { snap } = useLive();
  const agents = useAgentMap();
  const [busy, setBusy] = useState(false);
  const assigned = task.assigned_agent ? agents.get(task.assigned_agent) : null;
  const terminal = TERMINAL_TASK_STATUSES.includes(task.status) || task.status === 'APPROVED';

  async function op(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}`, { body });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-ink-900 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-xs font-semibold text-fg-muted">{task.key}</span>
        <TaskStatusBadge status={task.status} />
        {task.paused && <span className="font-mono text-[10px] text-st-blocked">PAUSA</span>}
        <span className="truncate text-sm font-medium" title={task.title}>
          {task.title}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-fg-dim">
        {assigned ? (
          <>
            <AgentAvatar name={assigned.name} color={assigned.color} size={16} status={assigned.status} /> {assigned.name}
          </>
        ) : (
          'sin asignar'
        )}
        {task.current_branch && <span className="font-mono">⎇ {task.current_branch}</span>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {!terminal && (
          <>
            <select
              aria-label="Asignar a"
              className="h-7 rounded-md border border-line-strong bg-ink-800 px-1.5 text-xs text-fg-muted"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && op({ op: 'assign', agent_id: e.target.value })}
            >
              <option value="">{assigned ? 'Reasignar…' : 'Asignar…'}</option>
              {snap?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Pedir revisión"
              className="h-7 rounded-md border border-line-strong bg-ink-800 px-1.5 text-xs text-fg-muted"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && op({ op: 'request_review', agent_id: e.target.value })}
            >
              <option value="">Nueva revisión…</option>
              {snap?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {['WAITING_USER', 'BLOCKED', 'OPEN'].includes(task.status) && assigned && (
              <Button size="sm" disabled={busy} onClick={() => op({ op: 'continue' })}>
                ▶ Continuar
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: task.paused ? 'resume' : 'pause' })}>
              {task.paused ? 'Reanudar' : 'Pausar'}
            </Button>
            {task.status === 'WAITING_USER' && (
              <>
                <Button size="sm" variant="accent" disabled={busy} onClick={() => op({ op: 'approve' })}>
                  ✓ Aprobar
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => op({ op: 'reject', note: prompt('Motivo (opcional)') ?? '' })}>
                  ✕ Rechazar
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="text-st-error" disabled={busy} onClick={() => op({ op: 'cancel', chain: true }, `¿Cancelar ${task.key} y toda su cadena de subtareas?`)}>
              Cancelar cadena
            </Button>
          </>
        )}
        {terminal && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: 'status', status: 'OPEN' })}>
            Reabrir
          </Button>
        )}
        {showLink && (
          <Link href={`/tasks/${task.key}`} className="px-2 text-[11px] text-fg-dim hover:text-fg">
            detalle ↗
          </Link>
        )}
      </div>
    </div>
  );
}
