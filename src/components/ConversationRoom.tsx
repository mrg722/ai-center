'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLive, useAgentMap } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { MessageView } from '@/lib/client/types';
import { USER_MESSAGE_TYPES, type MessageType } from '@/shared/domain';
import { Markdown } from './Markdown';
import { AgentAvatar, Button, cx, Empty, inputCls } from './ui';

const TYPE_TONE: Partial<Record<MessageType, string>> = {
  TASK: 'text-accent',
  HANDOFF: 'text-st-waiting',
  REVIEW: 'text-st-reviewing',
  RESULT: 'text-st-online',
  ERROR: 'text-st-error',
  WARNING: 'text-st-blocked',
  APPROVAL_REQUEST: 'text-accent',
  PROPOSAL: 'text-st-thinking',
  QUESTION: 'text-st-waiting',
  COMMAND: 'text-fg-dim',
  NOTE: 'text-fg-dim',
};

export interface ComposerTarget {
  to: string; // agent id | 'all' | 'room'
}

export function ConversationRoom({
  taskId,
  taskKey,
  target,
  onTargetChange,
  compact,
}: {
  taskId: string | null;
  taskKey?: string | null;
  target: string;
  onTargetChange: (to: string) => void;
  compact?: boolean;
}) {
  const { snap, messageTick, activity, statusTick } = useLive();
  const agents = useAgentMap();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const q = taskId ? `task=${taskId}` : '';
  const load = useCallback(async () => {
    const r = await api<{ messages: MessageView[] }>(`/api/messages?${q}&limit=80`);
    setMessages(r.messages);
    setHasMore(r.messages.length >= 80);
    setLoading(false);
  }, [q]);

  useEffect(() => {
    setLoading(true);
    stick.current = true;
    void load();
  }, [load]);

  // incremental: fetch only newer messages on each message event
  useEffect(() => {
    if (!messageTick) return;
    const last = messages[messages.length - 1]?.seq;
    if (!last) {
      void load();
      return;
    }
    api<{ messages: MessageView[] }>(`/api/messages?${q}&after=${last}&limit=100`)
      .then((r) => r.messages.length && setMessages((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageTick]);

  // message delivery status (HELD → DELIVERED → PROCESSED) changes on run/system events — reload then, no polling
  useEffect(() => {
    if (statusTick) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTick]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const first = messages[0]?.seq;
    if (!first) return;
    const r = await api<{ messages: MessageView[] }>(`/api/messages?${q}&before=${first}&limit=80`);
    setHasMore(r.messages.length >= 80);
    stick.current = false;
    setMessages((m) => [...r.messages, ...m]);
  }

  const pendingApprovalIds = useMemo(() => new Set((snap?.approvals ?? []).map((a) => a.id)), [snap?.approvals]);
  const working = (snap?.agents ?? []).filter((a) => ['WORKING', 'THINKING', 'REVIEWING'].includes(a.status) && (!taskId || a.current_task_id === taskId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3 sm:px-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        data-testid="conversation"
        aria-live="polite"
      >
        {hasMore && (
          <div className="pb-2 text-center">
            <Button size="sm" variant="ghost" onClick={loadOlder}>
              cargar anteriores
            </Button>
          </div>
        )}
        {loading && <Empty>Cargando conversación…</Empty>}
        {!loading && !messages.length && (
          <Empty>
            {taskId ? 'Aún no hay mensajes en esta tarea.' : 'La sala está vacía. Crea una tarea o escribe a un agente para empezar.'}
          </Empty>
        )}
        {messages.map((m, i) => (
          <MessageRow key={m.id} m={m} prev={messages[i - 1]} agents={agents} pendingApproval={Boolean(m.meta.approval_id && pendingApprovalIds.has(String(m.meta.approval_id)))} showTask={!taskId} />
        ))}
        {working.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-dim">
            <AgentAvatar name={a.name} color={a.color} size={18} />
            <span style={{ color: a.color }}>{a.name}</span>
            <span className="animate-pulse-soft">{a.status === 'THINKING' ? 'pensando' : a.status === 'REVIEWING' ? 'revisando' : 'trabajando'}…</span>
            <span className="truncate font-mono text-[11px]">{activity[a.id]?.[0]?.text ?? a.activity}</span>
          </div>
        ))}
      </div>
      <Composer taskId={taskId} taskKey={taskKey} target={target} onTargetChange={onTargetChange} compact={compact} />
    </div>
  );
}

// Memoized: without it, every SSE tick re-renders (and re-diffs, including
// Markdown parsing) the entire message list even though only a handful of
// rows ever actually change — the main cause of typing/click feeling
// delayed once there's real event traffic on the page.
const MessageRow = memo(function MessageRow({
  m,
  prev,
  agents,
  pendingApproval,
  showTask,
}: {
  m: MessageView;
  prev?: MessageView;
  agents: ReturnType<typeof useAgentMap>;
  pendingApproval: boolean;
  showTask: boolean;
}) {
  const from = m.from_kind === 'agent' ? agents.get(m.from_agent ?? '') : null;
  const to = m.to_agent ? agents.get(m.to_agent) : null;
  const name = from?.name ?? (m.from_kind === 'user' ? (m.from_user_name ?? 'Moderador') : 'Sistema');
  const color = from?.color ?? (m.from_kind === 'user' ? '#f2b544' : '#5c6779');
  const grouped = prev && prev.from_agent === m.from_agent && prev.from_kind === m.from_kind && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 90_000 && prev.message_type === m.message_type;
  const isCommand = m.message_type === 'COMMAND';
  const [decision, setDecision] = useState<'idle' | 'busy' | 'done'>('idle');

  async function decide(d: 'approve' | 'reject') {
    const note = d === 'reject' ? (prompt('Motivo del rechazo (opcional):') ?? '') : '';
    setDecision('busy');
    try {
      await api(`/api/approvals/${m.meta.approval_id}`, { body: { decision: d, note } });
      setDecision('done');
    } catch (e) {
      alert((e as Error).message);
      setDecision('idle');
    }
  }

  return (
    <article
      className={cx(
        'group rounded-md px-2 transition-colors hover:bg-ink-850',
        grouped ? 'py-0.5' : 'pt-2.5 pb-1',
        m.message_type === 'APPROVAL_REQUEST' && pendingApproval && 'border-l-2 border-accent bg-accent-soft/40',
        m.message_type === 'ERROR' && 'border-l-2 border-st-error/60',
        isCommand && 'opacity-70',
      )}
      data-type={m.message_type}
    >
      {!grouped && (
        <header className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <AgentAvatar name={name} color={color} size={20} />
          <span className="text-[13px] font-semibold" style={{ color }}>
            {name}
          </span>
          <span className="text-[11px] text-fg-dim">→ {to ? <span style={{ color: to.color }}>{to.name}</span> : m.to_all ? 'todos' : 'sala'}</span>
          <span className={cx('font-mono text-[10px] font-semibold tracking-wider', TYPE_TONE[m.message_type] ?? 'text-fg-muted')}>{m.message_type}</span>
          {showTask && m.task_key && <span className="rounded bg-ink-800 px-1 font-mono text-[10px] text-fg-muted">{m.task_key}</span>}
          {m.status === 'HELD' && <span className="font-mono text-[10px] text-st-blocked" title="Retenido: sistema detenido, agente o tarea en pausa">RETENIDO</span>}
          {m.status === 'FAILED' && <span className="font-mono text-[10px] text-st-error">FALLÓ</span>}
          {m.status === 'CANCELLED' && <span className="font-mono text-[10px] text-fg-dim">CANCELADO</span>}
          {m.status === 'SENT' && to?.status === 'OFFLINE' && (
            <span className="font-mono text-[10px] text-st-blocked" title={`${to.name} no tiene bridge conectado (${to.status_reason || 'sin conexión'}). El mensaje espera en cola; no habrá respuesta hasta que se conecte un bridge real con Agentes → Emitir token.`}>
              EN COLA · {to.name} sin bridge
            </span>
          )}
          <time className="ml-auto text-[10px] text-fg-dim" dateTime={m.created_at}>
            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </header>
      )}
      <div className={cx('pl-7', isCommand && 'font-mono text-xs')}>
        <Markdown text={m.content.length > 6000 ? m.content.slice(0, 6000) + '\n…' : m.content} />
        {(m.files.length > 0 || m.git_commit || m.git_branch) && (
          <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px] text-fg-dim">
            {m.git_branch && <span>⎇ {m.git_branch}</span>}
            {m.git_commit && <span>@ {m.git_commit.slice(0, 7)}</span>}
            {m.files.slice(0, 8).map((f) => (
              <span key={f} className="rounded bg-ink-800 px-1">
                {f}
              </span>
            ))}
            {m.files.length > 8 && <span>+{m.files.length - 8}</span>}
          </div>
        )}
        {m.message_type === 'APPROVAL_REQUEST' && pendingApproval && decision !== 'done' && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="accent" onClick={() => decide('approve')} disabled={decision === 'busy'} data-testid="approve-inline">
              ✓ Aprobar
            </Button>
            <Button size="sm" variant="danger" onClick={() => decide('reject')} disabled={decision === 'busy'}>
              ✕ Rechazar
            </Button>
          </div>
        )}
      </div>
    </article>
  );
});

// Memoized: the text input lives here, so re-renders here directly show up
// as "typing feels laggy". Its own props are stable across the unrelated
// SSE ticks that force the parent (ConversationRoom) to re-render.
const Composer = memo(function Composer({
  taskId,
  taskKey,
  target,
  onTargetChange,
  compact,
}: {
  taskId: string | null;
  taskKey?: string | null;
  target: string;
  onTargetChange: (to: string) => void;
  compact?: boolean;
}) {
  const { snap } = useLive();
  const [text, setText] = useState('');
  const [type, setType] = useState<MessageType>('REQUEST');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nvidiaModels, setNvidiaModels] = useState<{ id: string; owned_by?: string }[]>([]);
  const [nvidiaQuery, setNvidiaQuery] = useState('');
  const [nvidiaModel, setNvidiaModel] = useState('');
  const agents = snap?.agents ?? [];

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/messages', { body: { task_id: taskId, to: target, type: target === 'room' ? 'NOTE' : type, content: text, ...(targetAgent?.slug === 'nvidia' && nvidiaModel ? { model: nvidiaModel } : {}) } });
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const targetAgent = agents.find((a) => a.id === target);

  useEffect(() => {
    if (targetAgent?.slug !== 'nvidia') {
      setNvidiaModels([]);
      setNvidiaQuery('');
      setNvidiaModel('');
      return;
    }
    let cancelled = false;
    api<{ nvidia: { models: { id: string; owned_by?: string }[]; agent: { id: string; model: string } | null } }>('/api/providers')
      .then((r) => {
        if (cancelled) return;
        setNvidiaModels(r.nvidia.models);
        setNvidiaModel(targetAgent.model || r.nvidia.agent?.model || r.nvidia.models[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) setNvidiaModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [targetAgent?.slug, targetAgent?.model]);

  const filteredNvidiaModels = useMemo(() => {
    const needle = nvidiaQuery.trim().toLowerCase();
    if (!needle) return nvidiaModels;
    return nvidiaModels.filter((m) => `${m.id} ${m.owned_by ?? ''}`.toLowerCase().includes(needle));
  }, [nvidiaModels, nvidiaQuery]);

  return (
    <div className="shrink-0 border-t border-line bg-ink-900 p-2 sm:p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-fg-dim">Para</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Destinatario">
          {agents.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={target === a.id}
              onClick={() => onTargetChange(a.id)}
              className={cx('rounded border px-2 py-0.5 transition-colors', target === a.id ? 'border-transparent text-ink-950' : 'border-line-strong text-fg-muted hover:text-fg')}
              style={target === a.id ? { background: a.color } : undefined}
            >
              {a.name}
            </button>
          ))}
          <button role="radio" aria-checked={target === 'all'} onClick={() => onTargetChange('all')} className={cx('rounded border px-2 py-0.5', target === 'all' ? 'border-accent bg-accent text-ink-950' : 'border-line-strong text-fg-muted hover:text-fg')}>
            Todas
          </button>
          <button role="radio" aria-checked={target === 'room'} onClick={() => onTargetChange('room')} className={cx('rounded border px-2 py-0.5', target === 'room' ? 'border-fg-muted bg-fg-muted text-ink-950' : 'border-line-strong text-fg-muted hover:text-fg')} title="Nota en la sala, no se entrega a ninguna IA">
            Nota
          </button>
        </div>
        {target !== 'room' && (
          <select value={type} onChange={(e) => setType(e.target.value as MessageType)} className="ml-auto rounded border border-line-strong bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted" aria-label="Tipo de mensaje">
            {USER_MESSAGE_TYPES.filter((t) => t !== 'NOTE').map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      {targetAgent?.slug === 'nvidia' && (
        <div className="mb-2 grid gap-1.5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <input
            value={nvidiaQuery}
            onChange={(e) => setNvidiaQuery(e.target.value)}
            placeholder="Buscar modelo NVIDIA…"
            className="h-8 rounded border border-line bg-ink-950 px-2 text-[11px]"
            aria-label="Buscar modelo NVIDIA"
          />
          <select
            value={nvidiaModel}
            onChange={(e) => setNvidiaModel(e.target.value)}
            className="h-8 min-w-0 rounded border border-[#76b900]/40 bg-ink-950 px-2 font-mono text-[10px] text-fg-muted"
            aria-label="Modelo NVIDIA"
          >
            {!filteredNvidiaModels.length && <option value="">Catálogo NVIDIA no disponible</option>}
            {filteredNvidiaModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}{m.owned_by ? ` · ${m.owned_by}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={compact ? 2 : 3}
          placeholder={
            target === 'room'
              ? 'Nota para la sala (no se entrega a ninguna IA)…'
              : `Mensaje${taskKey ? ` en ${taskKey}` : ''} para ${targetAgent?.name ?? 'todas las IAs'} — Enter envía, Shift+Enter nueva línea`
          }
          className={cx(inputCls, 'resize-none')}
          data-testid="composer"
          aria-label="Mensaje"
        />
        <Button variant="primary" onClick={send} disabled={busy || !text.trim()} data-testid="send">
          Enviar
        </Button>
      </div>
      {targetAgent && targetAgent.status === 'OFFLINE' && (
        <p className="mt-1.5 text-[11px] text-st-blocked">
          {targetAgent.name} está OFFLINE ({targetAgent.status_reason}). El mensaje quedará en cola hasta que se conecte.
        </p>
      )}
      {err && <p className="mt-1.5 text-[11px] text-st-error">{err}</p>}
    </div>
  );
});
