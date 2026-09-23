'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLive } from '@/lib/client/live';
import { ConversationRoom } from '@/components/ConversationRoom';
import { ActivityFeed, AgentRoster, ApprovalsPanel, GithubPanel, TaskList } from '@/components/Panels';
import { TaskControls } from '@/components/TaskControls';
import { useGithub } from '@/components/AppShell';
import { OfficeCanvas } from '@/components/office/OfficeCanvas';
import { cx } from '@/components/ui';
import { VercelGatewayPanel } from '@/components/VercelGatewayPanel';
import { NvidiaNimPanel } from '@/components/NvidiaNimPanel';
import Link from 'next/link';

type Tab = 'room' | 'agents' | 'tasks' | 'approvals';

export default function CommandCenter() {
  const { snap } = useLive();
  const gh = useGithub();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('room');

  // default composer target: the builder (Claude) once agents are known
  useEffect(() => {
    if (target === 'all' && snap?.agents.length) {
      const b = snap.agents.find((a) => a.role === 'PRIMARY_BUILDER');
      if (b) setTarget(b.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.agents.length]);

  const task = snap?.tasks.find((t) => t.id === taskId) ?? null;

  const selectTask = (id: string | null) => {
    setTaskId(id);
    const t = snap?.tasks.find((x) => x.id === id);
    if (t?.assigned_agent) setTarget(t.assigned_agent);
    setTab('room');
  };

  // Stable references so the memoized NVIDIA/Gateway panels below don't
  // re-render just because this page re-rendered for something unrelated.
  const selectAgentAndOpenRoom = useCallback((id: string) => {
    setTarget(id);
    setTab('room');
  }, []);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'room', label: 'Sala' },
    { id: 'agents', label: 'Agentes' },
    { id: 'tasks', label: 'Tareas' },
    { id: 'approvals', label: 'Aprobaciones', badge: snap?.approvals.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* mobile / tablet tabs */}
      <div className="flex border-b border-line lg:hidden" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx('flex-1 py-2.5 text-xs font-medium', tab === t.id ? 'border-b-2 border-accent text-fg' : 'text-fg-dim')}
          >
            {t.label}
            {t.badge ? <span className="ml-1 rounded bg-accent px-1 font-mono text-[10px] text-ink-950">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="shrink-0 space-y-2 p-2 sm:p-3 pb-0">
        <NvidiaNimPanel onSelectAgent={selectAgentAndOpenRoom} />
        <VercelGatewayPanel onSelectAgent={selectAgentAndOpenRoom} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-2 sm:p-3 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
        {/* left: agents + tasks */}
        <div className={cx('min-h-0 flex-col gap-3', tab === 'agents' || tab === 'tasks' ? 'flex' : 'hidden', 'lg:flex')}>
          <div className={cx('min-h-0', tab === 'tasks' ? 'hidden lg:flex lg:flex-col' : 'flex flex-col', 'lg:max-h-[48%]')}>
            <AgentRoster onMessage={selectAgentAndOpenRoom} selectedTask={taskId} />
          </div>
          <div className={cx('min-h-0 flex-1 flex-col', tab === 'agents' ? 'hidden lg:flex' : 'flex')}>
            <TaskList selected={taskId} onSelect={selectTask} />
          </div>
        </div>

        {/* center: conversation */}
        <section className={cx('min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-ink-900', tab === 'room' ? 'flex' : 'hidden', 'lg:flex')}>
          {task ? (
            <TaskControls task={task} />
          ) : (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <span className="font-mono text-[11px] text-fg-dim">#</span>
              <span className="text-sm font-medium">Sala general</span>
              <span className="text-[11px] text-fg-dim">— toda la conversación entre IAs y tú, en tiempo real</span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ConversationRoom taskId={taskId} taskKey={task?.key} target={target} onTargetChange={setTarget} />
          </div>
        </section>

        {/* right: approvals, office preview, github, activity */}
        <div className={cx('min-h-0 flex-col gap-3 overflow-y-auto', tab === 'approvals' ? 'flex' : 'hidden', 'xl:flex')}>
          <div className="shrink-0">
            <ApprovalsPanel />
          </div>
          <Link href="/office" className="group hidden shrink-0 overflow-hidden rounded-lg border border-line bg-ink-900 xl:block" aria-label="Abrir AI Office">
            <div className="flex h-8 items-center justify-between border-b border-line px-3 text-[11px] uppercase tracking-[0.12em] text-fg-muted">
              AI Office <span className="normal-case tracking-normal text-fg-dim group-hover:text-fg">abrir ↗</span>
            </div>
            <div className="h-44">
              <OfficeCanvas compact />
            </div>
          </Link>
          <div className="shrink-0">
            <GithubPanel gh={gh} />
          </div>
          <div className="min-h-64 flex-1">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </div>
  );
}
