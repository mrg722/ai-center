'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { GithubStatus } from '@/lib/client/types';
import type { Mode, SystemState } from '@/shared/domain';
import { Button, cx, StatusDot } from './ui';

const NAV: { href: string | null; label: string; icon: string }[] = [
  { href: '/', label: 'Chat', icon: 'M4 5h16v11H8l-4 4V5Z' },
  { href: '/agents', label: 'Agents', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87' },
  { href: '/#skills', label: 'Skills', icon: 'm12 3-1.4 4.1L7 8.5l3.6 1.4L12 14l1.4-4.1L17 8.5l-3.6-1.4L12 3Z' },
  { href: '/#memory', label: 'Memory', icon: 'M9.5 3a3 3 0 0 0-3 3v.3A3.5 3.5 0 0 0 4 12a3.5 3.5 0 0 0 2.5 5.7V18a3 3 0 0 0 3 3h1v-7H9a2 2 0 0 1 0-4h1V3h-.5Z' },
  { href: '/#memory', label: 'Knowledge', icon: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5ZM4 18h16' },
  { href: null, label: 'Security Lab', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z' },
  { href: null, label: 'Projects', icon: 'm3 7 3-3h5l2 2h8v14H3V7Z' },
  { href: null, label: 'Reports', icon: 'M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-7M20 16v-4' },
  { href: '/settings', label: 'Settings', icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
];

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'DEMO', label: 'Demo', hint: 'Agentes simulados.' },
  { id: 'MODERATED', label: 'Moderado', hint: 'Operaciones sensibles requieren aprobación.' },
  { id: 'SUPERVISED', label: 'Supervisado', hint: 'Push/PR requieren aprobación.' },
  { id: 'AUTONOMOUS', label: 'Autónomo', hint: 'Cadenas según permisos.' },
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
    api<GithubStatus>('/api/github').then((g) => !cancelled && setGh(g)).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, repo, gitTick]);
  return gh;
}

function NavIcon({ d }: { d: string }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

function Logo() {
  return <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden><path d="M16 2 27 8v16l-11 6L5 24V8l11-6Z" fill="#0f1722" stroke="#3b82f6" strokeWidth="2"/><path d="m10 12 6-4 6 4-6 4-6-4Zm0 7 6 4 6-4M16 12v11" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="12" r="2.2" fill="#2563eb"/></svg>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { snap, connected, error } = useLive();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const global = useMemo(() => snap ? SYSTEM_LABEL[snap.system.state](snap.approvals.length) : { label: 'CARGANDO', color: 'var(--color-fg-dim)' }, [snap]);

  async function toggleStop() {
    if (!snap) return;
    if (!snap.project.halted && !confirm('¿DETENER TODO? Se cancelan las ejecuciones en curso y se retiene toda la cola.')) return;
    setBusy(true);
    try { await api('/api/system', { body: snap.project.halted ? { op: 'resume_all' } : { op: 'stop_all', reason: '' } }); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  async function setMode(mode: Mode) {
    if (!snap || mode === snap.project.mode) return;
    if (mode === 'AUTONOMOUS' && !confirm('Modo AUTÓNOMO: las IAs ejecutarán cadenas completas según sus permisos. ¿Continuar?')) return;
    await api('/api/system', { body: { op: 'mode', mode } }).catch((e) => alert(e.message));
  }
  async function logout() {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    window.location.href = '/login';
  }

  return <div className="flex min-h-dvh flex-col bg-ink-950">
    <header className="sticky top-0 z-40 border-b border-[#202b38] bg-[#080d14]/95 backdrop-blur-xl">
      <div className="flex h-[60px] items-center gap-3 px-3 lg:px-5">
        <Link href="/" className="flex w-[230px] shrink-0 items-center gap-2.5" aria-label="AI CENTER">
          <Logo/><span><span className="block text-[17px] font-bold tracking-[.04em] text-[#e6edf5]">AI CENTER</span><span className="block text-[9px] tracking-wide text-[#657386]">Multi-AI Agent Platform</span></span>
        </Link>
        <nav className={cx('flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto', menu ? 'flex' : 'hidden md:flex')} aria-label="Navegación principal">
          {NAV.map((n, i) => { const active = i === 0 ? path === '/' : Boolean(n.href && n.href !== '/' && path.startsWith(n.href.split('#')[0])); return n.href ? <Link key={n.label} href={n.href} onClick={() => setMenu(false)} className={cx('flex min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-[10px] transition', active ? 'bg-[#12346b] text-[#dbeafe]' : 'text-[#7f8da0] hover:bg-[#121b27] hover:text-[#dce6f3]')}><NavIcon d={n.icon}/><span>{n.label}</span></Link> : <span key={n.label} title="Esta sección todavía no tiene una ruta propia implementada" className="flex min-w-[72px] cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-[10px] text-[#465466]"><NavIcon d={n.icon}/><span>{n.label}</span></span>; })}
        </nav>
        <div className="hidden items-center gap-2 lg:flex"><div className="flex h-8 w-40 items-center gap-2 rounded-md border border-[#202b38] bg-[#0c121a] px-2.5 text-[10px] text-[#647286]"><span>⌕</span>Buscar…</div><div className="relative rounded-md p-2 text-[#9aa7b7]" aria-label="Notificaciones"><span>♧</span><i className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#ef4444]"/></div></div>
        <div className="hidden items-center gap-2 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6d3fd1] text-[12px] font-semibold text-white">{snap?.me.display_name?.slice(0,1).toUpperCase() ?? 'M'}</div><div className="hidden xl:block"><div className="text-[10px] font-medium">{snap?.me.display_name ?? 'Usuario'}</div><div className="text-[8px] text-[#718096]">{snap?.me.role ?? 'Owner'}</div></div><button onClick={logout} className="text-[#718096] hover:text-white" aria-label="Cerrar sesión">⌄</button></div>
        <button className="rounded-md p-2 text-[#8b98a9] md:hidden" onClick={() => setMenu(v=>!v)} aria-label="Menú">☰</button>
      </div>
      <div className="flex items-center gap-2 border-t border-[#18212c] px-3 py-1.5 lg:px-5">
        <span className="text-[9px] text-[#657386]">PROJECT</span><span className="truncate text-[10px] font-semibold">{snap?.project.name ?? 'Cargando…'}</span><span className="text-[9px] text-[#657386]">{snap?.project.repo ?? 'sin repo'}</span><span className="ml-auto flex items-center gap-1.5 text-[9px]" style={{color:global.color}}><span className="h-1.5 w-1.5 rounded-full" style={{background:global.color}}/>{global.label}</span><span className={connected ? 'text-st-online' : 'text-st-error'}>{connected ? '● LIVE' : '○ …'}</span><div className="hidden md:flex rounded border border-[#202b38] bg-[#0c121a]">{MODES.map(m=><button key={m.id} title={m.hint} onClick={()=>setMode(m.id)} className={cx('px-2 py-1 text-[8px]',snap?.project.mode===m.id?'bg-[#1b2c44] text-white':'text-[#687588]')}>{m.label}</button>)}</div><Button variant={snap?.project.halted ? 'accent' : 'danger'} size="sm" onClick={toggleStop} disabled={!snap||busy} data-testid="stop-all">{snap?.project.halted?'▶ REANUDAR':'■ DETENER TODO'}</Button>
      </div>
      {snap?.project.halted&&<div className="border-t border-st-error/30 bg-st-error/10 px-4 py-1 text-center text-[10px] text-st-error">SISTEMA DETENIDO — ninguna IA recibe trabajo hasta que pulses REANUDAR.</div>}
      {snap?.project.mode==='DEMO'&&!snap.project.halted&&<div className="border-t border-st-thinking/30 bg-st-thinking/10 px-4 py-1 text-center text-[10px] text-st-thinking">MODO DEMO — los agentes están SIMULADOS.</div>}
      {error&&<div className="bg-st-error/10 px-4 py-1 text-center text-[10px] text-st-error">{error}</div>}
    </header>
    <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    <StatusStrip/>
  </div>;
}

function StatusStrip() {
  const { snap } = useLive();
  if (!snap) return null;
  return <footer className="hidden h-6 items-center gap-4 overflow-hidden border-t border-[#202b38] bg-[#080d14] px-4 font-mono text-[9px] text-[#657386] md:flex">{snap.agents.map(a=><span key={a.id} className="flex items-center gap-1.5"><StatusDot status={a.status} size={6}/><span style={{color:a.color}}>{a.slug}</span><span>{a.status.toLowerCase()}</span></span>)}<span data-testid="git-line">⎇ {snap.project.default_branch} · {snap.project.repo ?? 'sin repo'}</span><span className="ml-auto">tareas activas {snap.tasks.filter(t=>!['COMPLETED','CANCELLED','APPROVED','REJECTED','FAILED'].includes(t.status)).length} · aprobaciones {snap.approvals.length} · modo {snap.project.mode.toLowerCase()}</span></footer>;
}
