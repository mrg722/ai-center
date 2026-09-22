'use client';

import { useState } from 'react';
import { useLive } from '@/lib/client/live';
import { OfficeCanvas } from '@/components/office/OfficeCanvas';
import { AgentPanel } from '@/components/office/AgentPanel';
import { ConversationRoom } from '@/components/ConversationRoom';
import { Modal, StatusDot, cx } from '@/components/ui';

export default function OfficePage() {
  const { snap, connected, liveEvents } = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const [msgTo, setMsgTo] = useState<string | null>(null);
  const select = (id: string | null) => setSelected(id);
  const active = snap?.agents.filter((a) => ['WORKING', 'THINKING', 'REVIEWING'].includes(a.status)).length ?? 0;
  const online = snap?.agents.filter((a) => a.status !== 'OFFLINE').length ?? 0;
  const tasks = snap?.tasks.filter((t) => !['COMPLETED', 'CANCELLED', 'APPROVED', 'REJECTED', 'FAILED'].includes(t.status)).length ?? 0;
  const lastEvent = liveEvents[liveEvents.length - 1];
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#05070a]" style={{ height: 'calc(100dvh - 5.75rem)' }}>
      <div className="absolute inset-0"><OfficeCanvas selectedId={selected} onSelect={select} focusRequest={focusReq} /></div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto max-w-[calc(100%-8rem)]">
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line-strong/80 bg-ink-950/85 p-1.5 shadow-2xl backdrop-blur-md">
            {snap?.agents.map((a) => (
              <button key={a.id} onClick={() => { select(a.id); setFocusReq({ id: a.id, n: Date.now() }); }} className={cx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-all', selected === a.id ? 'border-accent/70 bg-accent/10 text-fg shadow-[0_0_18px_rgba(242,181,68,.12)]' : 'border-transparent text-fg-muted hover:border-line-strong hover:bg-ink-800/80 hover:text-fg')} title={`${a.name}: ${a.status}${a.status_reason ? ` — ${a.status_reason}` : ''}`}>
                <StatusDot status={a.status} size={6} /><span style={{ color: a.color }}>{a.name}</span>
              </button>
            ))}
            <button onClick={() => { select('moderator'); setFocusReq({ id: 'moderator', n: Date.now() }); }} className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11px] text-accent hover:bg-accent/10">Tu escritorio</button>
          </div>
        </div>
        <div className="pointer-events-auto hidden items-center gap-1.5 rounded-xl border border-line-strong/80 bg-ink-950/85 p-1.5 shadow-2xl backdrop-blur-md sm:flex">
          <Metric label="LIVE" value={connected ? 'ONLINE' : 'RECONNECTING'} live={connected} />
          <Metric label="AGENTES" value={`${online}/${snap?.agents.length ?? 0}`} />
          <Metric label="ACTIVOS" value={String(active)} />
          <Metric label="TAREAS" value={String(tasks)} />
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden max-w-[min(520px,calc(100%-1.5rem))] sm:block">
        <div className="rounded-xl border border-line bg-ink-950/80 px-3 py-2 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim"><span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(242,181,68,.7)]" />AI OFFICE · TELEMETRÍA REAL</div>
          <div className="mt-1 truncate text-[11px] text-fg-muted">{lastEvent ? `${lastEvent.type} · ${new Date(lastEvent.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Esperando eventos del orquestador…'}</div>
        </div>
      </div>
      {selected && <aside className="absolute inset-y-0 right-0 z-20 w-[380px] max-w-[92vw] border-l border-line bg-ink-900/96 shadow-2xl backdrop-blur-md"><AgentPanel agentId={selected} onClose={() => select(null)} onMessage={(id) => setMsgTo(id)} /></aside>}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-xl border border-line bg-ink-950/75 px-2.5 py-1.5 font-mono text-[10px] text-fg-dim shadow-xl backdrop-blur-md">arrastrar · rueda/pellizco · doble clic enfoca · 0 = ver todo</div>
      <Modal open={Boolean(msgTo)} onClose={() => setMsgTo(null)} title="Mensaje" wide><div className="h-[60dvh]">{msgTo && <ConversationRoom taskId={null} target={msgTo} onTargetChange={setMsgTo} compact />}</div></Modal>
    </div>
  );
}

function Metric({ label, value, live = false }: { label: string; value: string; live?: boolean }) {
  return <div className="min-w-[68px] rounded-lg border border-line bg-ink-900/80 px-2 py-1.5 text-center"><div className="text-[9px] uppercase tracking-wider text-fg-dim">{label}</div><div className={cx('mt-0.5 font-mono text-[10px]', live ? 'text-st-online' : 'text-fg-muted')}>{value}</div></div>;
}