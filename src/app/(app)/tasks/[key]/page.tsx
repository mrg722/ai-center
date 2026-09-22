'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useLive, useAgentMap } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import { ConversationRoom } from '@/components/ConversationRoom';
import { TaskControls } from '@/components/TaskControls';
import { AgentAvatar, Empty, Panel, TaskStatusBadge, timeAgo } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import type { TaskSummary } from '@/lib/client/types';
import type { TaskStatus } from '@/shared/domain';

interface Detail {
  task: TaskSummary & { description: string; context_summary: string; created_files: string[]; modified_files: string[]; related_commits: string[] };
  steps: { id: string; kind: string; title: string; agent_id: string | null; user_id: string | null; created_at: string }[];
  approvals: { id: string; action: string; title: string; status: string; created_at: string; decision_note: string }[];
  reviews: { id: string; reviewer_agent: string; verdict: string; summary: string; findings: { file?: string; note: string; severity?: string }[]; created_at: string }[];
  git_refs: { id: string; kind: string; ref: string; title: string; url: string | null; created_at: string }[];
  runs: { id: string; agent_id: string; status: string; started_at: string; duration_ms: number | null; tokens_in: number | null; tokens_out: number | null; error: string | null }[];
  subtasks: { id: string; key: string; title: string; status: TaskStatus; assigned_agent: string | null }[];
  repo: string | null;
}

export default function TaskPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { snap, liveEvents } = useLive();
  const agents = useAgentMap();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState('all');

  const load = useCallback(() => {
    api<Detail>(`/api/tasks/${encodeURIComponent(key)}`)
      .then((d) => {
        setDetail(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, [key]);

  const tick = liveEvents.filter((e) => e.task_id === detail?.task.id).length;
  useEffect(() => load(), [load, tick]);
  useEffect(() => {
    if (detail?.task.assigned_agent && target === 'all') setTarget(detail.task.assigned_agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.task.assigned_agent]);

  if (err) return <Empty>{err}</Empty>;
  if (!detail || !snap) return <Empty>Cargando…</Empty>;
  const t = snap.tasks.find((x) => x.id === detail.task.id) ?? detail.task;
  const d = detail.task;
  const files = [...new Set([...d.created_files, ...d.modified_files])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 text-xs text-fg-dim">
        <Link href="/" className="hover:text-fg">
          Command Center
        </Link>{' '}
        / {d.key}
      </div>
      <div className="m-3 mb-0 overflow-hidden rounded-lg border border-line">
        <TaskControls task={t} showLink={false} />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-[60dvh] flex-col overflow-hidden rounded-lg border border-line bg-ink-900 xl:min-h-0">
          <ConversationRoom taskId={d.id} taskKey={d.key} target={target} onTargetChange={setTarget} />
        </section>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Panel title="Descripción">
            <div className="space-y-2 p-3">
              {d.description ? <Markdown text={d.description} /> : <p className="text-xs text-fg-dim">Sin descripción.</p>}
              {d.context_summary && (
                <div className="rounded-md border border-line bg-ink-850 p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-dim">Resumen de contexto</div>
                  <Markdown text={d.context_summary} />
                </div>
              )}
            </div>
          </Panel>
          <Panel title={`Git · ${detail.repo ?? 'sin repo'}`}>
            <div className="space-y-2 p-3 text-[12px]">
              <div className="font-mono text-fg-muted">
                ⎇ {d.current_branch ?? '—'} {d.current_commit && <>@ {d.current_commit.slice(0, 10)}</>}
              </div>
              {detail.git_refs.map((r) => (
                <div key={r.id} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="rounded bg-ink-800 px-1 text-fg-dim">{r.kind}</span>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-st-waiting hover:underline">
                      {r.kind === 'pr' ? `#${r.ref}` : r.ref.slice(0, 10)}
                    </a>
                  ) : (
                    <span>{r.kind === 'commit' ? r.ref.slice(0, 10) : r.ref}</span>
                  )}
                  <span className="truncate text-fg-dim">{r.title}</span>
                </div>
              ))}
              {files.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-dim">Archivos ({files.length})</div>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-fg-muted">
                    {files.map((f) => (
                      <li key={f} className="truncate">
                        {d.created_files.includes(f) ? '+ ' : '~ '}
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
          {detail.reviews.length > 0 && (
            <Panel title="Revisiones">
              <ul className="divide-y divide-line">
                {detail.reviews.map((r) => {
                  const a = agents.get(r.reviewer_agent);
                  return (
                    <li key={r.id} className="space-y-1 p-3 text-[12px]">
                      <div className="flex items-center gap-2">
                        {a && <AgentAvatar name={a.name} color={a.color} size={16} />}
                        <span className={r.verdict === 'APPROVED' ? 'text-st-online' : r.verdict === 'CHANGES_REQUESTED' ? 'text-st-error' : 'text-fg-muted'}>{r.verdict}</span>
                        <span className="ml-auto text-[10px] text-fg-dim">{timeAgo(r.created_at)}</span>
                      </div>
                      <p className="text-fg-muted">{r.summary}</p>
                      {r.findings.map((f, i) => (
                        <p key={i} className="font-mono text-[11px] text-fg-dim">
                          {f.severity && `[${f.severity}] `}
                          {f.file && `${f.file}: `}
                          {f.note}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          {detail.subtasks.length > 0 && (
            <Panel title="Subtareas">
              <ul className="divide-y divide-line">
                {detail.subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                    <Link href={`/tasks/${s.key}`} className="font-mono text-fg-muted hover:text-fg">
                      {s.key}
                    </Link>
                    <TaskStatusBadge status={s.status} />
                    <span className="truncate">{s.title}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Historial">
            <ol className="space-y-px py-1">
              {detail.steps.map((s) => {
                const a = s.agent_id ? agents.get(s.agent_id) : null;
                return (
                  <li key={s.id} className="flex gap-2 px-3 py-1 text-[11px]">
                    <time className="w-10 shrink-0 font-mono text-fg-dim">{timeAgo(s.created_at)}</time>
                    <span className="w-16 shrink-0 font-mono text-fg-dim">{s.kind}</span>
                    <span className="text-fg-muted">
                      {a ? <span style={{ color: a.color }}>{a.name}: </span> : s.user_id ? <span className="text-accent">Tú: </span> : null}
                      {s.title}
                    </span>
                  </li>
                })}
            </ol>
          </Panel>
          <Panel title="Ejecuciones">
            {!detail.runs.length && <Empty>Sin ejecuciones.</Empty>}
            <ul className="divide-y divide-line">
              {detail.runs.map((r) => {
                const a = agents.get(r.agent_id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span style={{ color: a?.color }}>{a?.name ?? '?'}</span>
                    <span className={r.status === 'SUCCEEDED' ? 'text-st-online' : r.status === 'FAILED' ? 'text-st-error' : 'text-fg-muted'}>{r.status}</span>
                    {r.duration_ms !== null && <span className="text-fg-dim">{(r.duration_ms / 1000).toFixed(1)}s</span>}
                    {(r.tokens_in ?? 0) + (r.tokens_out ?? 0) > 0 && (
                      <span className="font-mono text-fg-dim">
                        {r.tokens_in}↓ {r.tokens_out}↑
                      </span>
                    )}
                    <span className="ml-auto text-fg-dim">{timeAgo(r.started_at)}</span>
                    {r.error && <span className="w-full truncate text-st-error">{r.error}</span>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
