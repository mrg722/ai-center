'use client';

import { useState } from 'react';
import { useLive } from '@/lib/client/live';
import { OfficeCanvas } from '@/components/office/OfficeCanvas';
import { AgentPanel } from '@/components/office/AgentPanel';
import { ConversationRoom } from '@/components/ConversationRoom';
import { Modal, StatusDot, cx } from '@/components/ui';

export default function OfficePage() {
  const { snap } = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const [msgTo, setMsgTo] = useState<string | null>(null);

  const select = (id: string | null) => setSelected(id);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row" style={{ height: 'calc(100dvh - 5.75rem)' }}>
      <div className="relative min-h-[55dvh] flex-1 lg:min-h-0">
        <OfficeCanvas selectedId={selected} onSelect={select} focusRequest={focusReq} />
        {/* agent chips: jump to a desk */}
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1">
          {snap?.agents.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                select(a.id);
                setFocusReq({ id: a.id, n: Date.now() });
              }}
              className={cx(
                'flex items-center gap-1.5 rounded-md border bg-ink-900/85 px-2 py-1 text-[11px] backdrop-blur transition-colors',
                selected === a.id ? 'border-accent text-fg' : 'border-line-strong text-fg-muted hover:text-fg',
              )}
            >
              <StatusDot status={a.status} size={6} />
              <span style={{ color: a.color }}>{a.name}</span>
            </button>
          ))}
          <button
            onClick={() => {
              select('moderator');
              setFocusReq({ id: 'moderator', n: Date.now() });
            }}
            className="rounded-md border border-line-strong bg-ink-900/85 px-2 py-1 text-[11px] text-accent backdrop-blur"
          >
            Tu escritorio
          </button>
        </div>
      </div>
      <div
        className={cx(
          'border-line bg-ink-900 transition-all lg:w-[360px] lg:border-l',
          selected ? 'max-h-[60dvh] border-t lg:max-h-none lg:border-t-0' : 'hidden lg:block',
        )}
      >
        {selected ? (
          <AgentPanel agentId={selected} onClose={() => select(null)} onMessage={(id) => setMsgTo(id)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-fg-dim">
            <p>Haz clic en un escritorio para ver al agente.</p>
            <p className="text-xs">Lo que ves es el estado real: pantallas, animaciones y sobres reflejan eventos del orquestador.</p>
          </div>
        )}
      </div>
      <Modal open={Boolean(msgTo)} onClose={() => setMsgTo(null)} title="Mensaje" wide>
        <div className="h-[60dvh]">{msgTo && <ConversationRoom taskId={null} target={msgTo} onTargetChange={setMsgTo} compact />}</div>
      </Modal>
    </div>
  );
}
