'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AgentStatus, TaskStatus } from '@/shared/domain';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'accent';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'default', size = 'md', className, ...p }, ref) {
    return (
      <button
        ref={ref}
        {...p}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap',
          size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
          variant === 'default' && 'border-line-strong bg-ink-800 text-fg hover:bg-ink-700',
          variant === 'primary' && 'border-transparent bg-fg text-ink-950 hover:bg-white',
          variant === 'accent' && 'border-accent/40 bg-accent-soft text-accent hover:bg-accent/25',
          variant === 'danger' && 'border-st-error/40 bg-st-error/10 text-st-error hover:bg-st-error/20',
          variant === 'ghost' && 'border-transparent bg-transparent text-fg-muted hover:bg-ink-800 hover:text-fg',
          className,
        )}
      />
    );
  },
);

export function Panel({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('flex min-h-0 flex-col rounded-lg border border-line bg-ink-900', className)}>
      {(title || actions) && (
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">{title}</h2>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClass)}>{children}</div>
    </section>
  );
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  ONLINE: 'var(--color-st-online)',
  WORKING: 'var(--color-st-working)',
  THINKING: 'var(--color-st-thinking)',
  WAITING: 'var(--color-st-waiting)',
  REVIEWING: 'var(--color-st-reviewing)',
  ERROR: 'var(--color-st-error)',
  OFFLINE: 'var(--color-st-offline)',
  BLOCKED: 'var(--color-st-blocked)',
};

const ACTIVE: AgentStatus[] = ['WORKING', 'THINKING', 'REVIEWING'];

export function StatusDot({ status, size = 8 }: { status: AgentStatus; size?: number }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block shrink-0 rounded-full', ACTIVE.includes(status) && 'animate-pulse-soft')}
      style={{ width: size, height: size, background: STATUS_COLOR[status], boxShadow: status === 'OFFLINE' ? 'none' : `0 0 8px ${STATUS_COLOR[status]}66` }}
    />
  );
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider"
      style={{ color: STATUS_COLOR[status], borderColor: `color-mix(in srgb, ${STATUS_COLOR[status]} 35%, transparent)` }}
    >
      <StatusDot status={status} size={6} />
      {status}
    </span>
  );
}

const TASK_TONE: Record<TaskStatus, string> = {
  OPEN: 'text-fg-muted border-line-strong',
  PLANNING: 'text-st-thinking border-st-thinking/40',
  IN_PROGRESS: 'text-st-working border-st-working/40',
  WAITING_AGENT: 'text-st-waiting border-st-waiting/40',
  WAITING_REVIEW: 'text-st-reviewing border-st-reviewing/40',
  WAITING_USER: 'text-accent border-accent/50 bg-accent-soft',
  APPROVED: 'text-st-online border-st-online/40',
  REJECTED: 'text-st-error border-st-error/40',
  BLOCKED: 'text-st-blocked border-st-blocked/40',
  FAILED: 'text-st-error border-st-error/40',
  COMPLETED: 'text-st-online border-st-online/40',
  CANCELLED: 'text-fg-dim border-line',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={cx('inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide', TASK_TONE[status])}>{status}</span>;
}

export function AgentAvatar({ name, color, size = 24, status }: { name: string; color: string; size?: number; status?: AgentStatus }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="inline-flex h-full w-full items-center justify-center rounded-md font-mono text-[11px] font-bold"
        style={{ background: `color-mix(in srgb, ${color} 18%, #0b0f15)`, color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)` }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      {status && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-ink-900">
          <StatusDot status={status} size={7} />
        </span>
      )}
    </span>
  );
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'ahora';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-fg-dim">{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-fg-dim">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-line-strong bg-ink-950 px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent/60 focus:outline-none';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={cx('max-h-[92dvh] w-full overflow-auto rounded-t-xl border border-line-strong bg-ink-900 shadow-2xl sm:rounded-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-ink-900 px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-ink-800 hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
