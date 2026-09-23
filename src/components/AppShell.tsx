'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { GithubStatus } from '@/lib/client/types';
import type { Mode, SystemState } from '@/shared/domain';
import { Button, cx, StatusDot } from './ui';

const NAV = [
  { href: '/', label: 'Command Center' },
  { href: '/office', label: 'AI Office' },
  { href: '/agents', label: 'Agentes' },
  { href: '/settings', label: 'Ajustes' },
];

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'DEMO', label: 'Demo', hint: 'Agentes SIMULADOS para probar la interfaz y los flujos. Nada toca git, workspaces ni APIs de pago.' },
  { id: 'MODERATED', label: 'Moderado', hint: 'Las IAs conversan; operaciones sensibles y handoffs requieren tu aprobación.' },
  { id: 'SUPERVISED', label: 'Supervisado', hint: 'Las IAs se pasan tareas solas; commit permitido; push/PR requieren aprobación.' },
  { id: 'AUTONOMOUS', label: 'Autónomo', hint: 'Cadena completa según permisos. Merge y operaciones peligrosas siguen requiriendo aprobación.' },
];

const SYSTEM_LABEL: Record<SystemState, (n: number) => { label: string; color: string }> = {
  HALTED: () => ({ label: 'DETENIDO', color: 'var(--color-st-error)' }),
  NEEDS_YOU: (n) => ({ label: `TE NECESITA · ${n}`, color: 'var(--color-accent)' }),
  DEMO: () => ({ label: 'DEMO · SIMULADO', color: 'var(--color-st-thinking)' }),
  ACTIVE: () => ({ label: 'ACTIVO', color: 'var(--color-st-working)' }),
  IDLE: () => ({ label: 'EN ESPERA', color: 'var(--color-st-online)' }),
  NO_AGENTS: () => ({ label: 'SIN AGENTES', color: 'var(--color-st-offline)' }),
};

export function useGithub() {
  const { snap, gitTick } = useLive();
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const ready = Boolean(snap);
  const repo = snap?.project.repo;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api<GithubStatus>('/api/github')
      .then((g) => !cancelled && setGh(g))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only re-fetch once we have a snapshot, when the repo changes, or when
    // a git/github event actually arrives — `ready` and `repo` are
    // primitives, so (unlike depending on `snap` itself) this doesn't
    // re-run on every unrelated snapshot refresh (e.g. every presence tick).
  }, [ready, repo, gitTick]);
  return gh;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { snap, connected, error } = useLive();
  const path = usePathname();
  const gh = useGithub();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);

  // The global state is computed by the orchestrator (snap.system); here we only pick a label/colour.
  const global = useMemo(() => {
    if (!snap) return { label: 'CARGANDO', color: 'var(--color-fg-dim)' };
    return SYSTEM_LABEL[snap.system.state](snap.approvals.length);
  }, [snap]);

  const bridge = snap?.agents.find((a) => a.transport === 'local-bridge' && a.status !== 'OFFLINE' && a.workspace.branch);
  const branch = bridge?.workspace.branch ?? gh?.default_branch ?? snap?.project.default_branch ?? '—';
  const commit = bridge?.workspace.commit ?? gh?.head_commit?.sha ?? null;

  async function toggleStop() {
    if (!snap) return;
    if (!snap.project.halted && !confirm('¿DETENER TODO? Se cancelan las ejecuciones en curso y se retiene toda la cola.')) return;
    setBusy(true);
    try {
      await api('/api/system', { body: snap.project.halted ? { op: 'resume_all' } : { op: 'stop_all', reason: '' } });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: Mode) {
    if (!snap || mode === snap.project.mode) return;
    if (mode === 'AUTONOMOUS' && !confirm('Modo AUTÓNOMO: las IAs ejecutarán cadenas completas según sus permisos (incluido push si lo tienen). ¿Continuar?')) return;
    await api('/api/system', { body: { op: 'mode', mode } }).catch((e) => alert(e.message));
  }

  async function logout() {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-ink-950/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="AI Command Center">
            <Logo />
            <span className="hidden font-mono text-[11px] font-bold tracking-[0.2em] text-fg-muted lg:inline">ACC</span>
          </Link>

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 text-sm">
              <span className="truncate font-semibold">{snap?.project.name ?? '…'}</span>
              {snap && <span className="rounded bg-ink-800 px-1.5 font-mono text-[10px] text-fg-muted">{snap.project.key}</span>}
            </div>
            <div className="flex items-center gap-2 truncate font-mono text-[11px] text-fg-dim" data-testid="git-line">
              <span className="truncate">{snap?.project.repo ?? 'sin repo'}</span>
              <span>⎇ {branch}</span>
              {commit && <span className="hidden sm:inline">@ {commit.slice(0, 7)}</span>}
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex" title={MODES.find((m) => m.id === snap?.project.mode)?.hint}>
            <div className="flex rounded-md border border-line-strong bg-ink-900 p-0.5" role="radiogroup" aria-label="Modo de operación">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={snap?.project.mode === m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={cx(
                    'rounded px-2.5 py-1 text-xs transition-colors',
                    snap?.project.mode === m.id ? 'bg-ink-700 text-fg' : 'text-fg-dim hover:text-fg-muted',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-md border border-line px-2.5 py-1.5 sm:flex" data-testid="global-status">
            <span className="h-2 w-2 rounded-full" style={{ background: global.color, boxShadow: `0 0 10px ${global.color}` }} />
            <span className="font-mono text-[11px] font-semibold tracking-wider" style={{ color: global.color }}>
              {global.label}
            </span>
          </div>

          <span
            className={cx('hidden font-mono text-[10px] lg:inline', connected ? 'text-st-online' : 'text-st-blocked')}
            title={connected ? 'Tiempo real conectado' : 'Reconectando…'}
          >
            {connected ? '● LIVE' : '○ …'}
          </span>

          <Button
            variant={snap?.project.halted ? 'accent' : 'danger'}
            onClick={toggleStop}
            disabled={!snap || busy}
            data-testid="stop-all"
            className="font-mono tracking-wider"
          >
            {snap?.project.halted ? '▶ REANUDAR' : '■ DETENER TODO'}
          </Button>

          <button className="rounded p-2 text-fg-muted hover:bg-ink-800 md:hidden" onClick={() => setMenu((v) => !v)} aria-label="Menú">
            ☰
          </button>
        </div>

        <nav className={cx('flex gap-1 overflow-x-auto border-t border-line px-2 sm:px-3', menu ? 'flex' : 'hidden md:flex')}>
          {NAV.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenu(false)}
                className={cx(
                  'relative whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors',
                  active ? 'text-fg' : 'text-fg-dim hover:text-fg-muted',
                )}
              >
                {n.label}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
              </Link>
            );
          })}
          <div className="ml-auto flex items-center gap-2 py-1 md:hidden">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} className={cx('rounded px-2 py-1 text-[11px]', snap?.project.mode === m.id ? 'bg-ink-700 text-fg' : 'text-fg-dim')}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="ml-auto hidden items-center gap-3 py-1 md:flex">
            {snap && (
              <span className="text-[11px] text-fg-dim">
                {snap.me.display_name} · <span className="uppercase">{snap.me.role}</span>
              </span>
            )}
            <button onClick={logout} className="text-[11px] text-fg-dim hover:text-fg">
              Salir
            </button>
          </div>
        </nav>
        {snap?.project.halted && (
          <div className="border-t border-st-error/30 bg-st-error/10 px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-st-error" role="status">
            SISTEMA DETENIDO — ninguna IA recibe trabajo hasta que pulses REANUDAR.
          </div>
        )}
        {snap?.project.mode === 'DEMO' && !snap.project.halted && (
          <div className="border-t border-st-thinking/30 bg-st-thinking/10 px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-st-thinking" role="status" data-testid="demo-banner">
            MODO DEMO — los agentes están SIMULADOS. Nada toca git, workspaces ni APIs de pago.
          </div>
        )}
        {error && <div className="bg-st-error/10 px-4 py-1 text-center text-xs text-st-error">{error}</div>}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <StatusStrip />
    </div>
  );
}

function StatusStrip() {
  const { snap } = useLive();
  if (!snap) return null;
  return (
    <footer className="hidden h-7 items-center gap-4 overflow-hidden border-t border-line bg-ink-950 px-4 font-mono text-[10px] text-fg-dim md:flex">
      {snap.agents.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5">
          <StatusDot status={a.status} size={6} />
          <span style={{ color: a.color }}>{a.slug}</span>
          <span>{a.status.toLowerCase()}</span>
        </span>
      ))}
      <span className="ml-auto">
        tareas activas {snap.tasks.filter((t) => !['COMPLETED', 'CANCELLED', 'APPROVED', 'REJECTED', 'FAILED'].includes(t.status)).length} · aprobaciones{' '}
        {snap.approvals.length} · modo {snap.project.mode.toLowerCase()}
      </span>
    </footer>
  );
}

function Logo() {
  // 8x8 pixel mark drawn with rects (no external assets)
  const px = ['00111100', '01000010', '10100101', '10000001', '10111101', '10000001', '01000010', '00111100'];
  return (
    <svg width="26" height="26" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      <rect width="8" height="8" rx="1.2" fill="#151b25" />
      {px.flatMap((row, y) => row.split('').map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={y === 2 ? '#f2b544' : '#8b97a8'} /> : null)))}
    </svg>
  );
}
