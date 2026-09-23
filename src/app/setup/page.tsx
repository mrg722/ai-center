'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, inputCls } from '@/components/ui';

export default function SetupPage() {
  const [state, setState] = useState<{ needs_setup: boolean; setup_token_configured: boolean } | null>(null);
  const [f, setF] = useState({
    setup_token: '',
    email: '',
    display_name: '',
    password: '',
    project_name: 'AI Command Center',
    project_key: 'ACC',
    repo: '',
    default_branch: 'main',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needs_setup: boolean; setup_token_configured: boolean }>('/api/setup').then((s) => {
      if (!s.needs_setup) window.location.href = '/login';
      setState(s);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/setup', { body: f });
      window.location.href = '/';
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'project_key' ? e.target.value.toUpperCase() : e.target.value });

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-xl border border-line bg-ink-900 p-6" data-testid="setup-form">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-accent">AI COMMAND CENTER · PRIMER ARRANQUE</div>
          <h1 className="mt-1 text-lg font-semibold">Crea el moderador y el proyecto</h1>
          <p className="mt-1 text-xs text-fg-dim">
            Se crearán los agentes Claude (builder), GPT/Codex (auditor) y Gemini (researcher) con sus permisos por defecto.
          </p>
        </div>
        {state && !state.setup_token_configured && (
          <p className="rounded-md border border-st-blocked/40 bg-st-blocked/10 p-2 text-xs text-st-blocked">
            El servidor no tiene SETUP_TOKEN configurado. En producción el registro inicial permanece bloqueado hasta que el administrador configure un token real; cualquier texto solo puede usarse en desarrollo local.
          </p>
        )}
        <Field label="Setup token">
          <input className={inputCls} type="password" value={f.setup_token} onChange={set('setup_token')} required autoComplete="off" placeholder={state && !state.setup_token_configured ? 'Token de prueba' : undefined} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tu nombre">
            <input className={inputCls} value={f.display_name} onChange={set('display_name')} required />
          </Field>
          <Field label="Email">
            <input className={inputCls} type="email" value={f.email} onChange={set('email')} required autoComplete="username" />
          </Field>
        </div>
        <Field label="Contraseña" hint="Mínimo 12 caracteres.">
          <input className={inputCls} type="password" value={f.password} onChange={set('password')} required minLength={12} autoComplete="new-password" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Proyecto">
            <input className={inputCls} value={f.project_name} onChange={set('project_name')} required />
          </Field>
          <Field label="Clave" hint="Prefijo de tareas">
            <input className={inputCls} value={f.project_key} onChange={set('project_key')} pattern="[A-Z][A-Z0-9]{1,9}" required />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Repositorio GitHub (opcional)">
            <input className={inputCls} value={f.repo} onChange={set('repo')} placeholder="owner/name" />
          </Field>
          <Field label="Rama por defecto">
            <input className={inputCls} value={f.default_branch} onChange={set('default_branch')} />
          </Field>
        </div>
        {err && <p className="text-xs text-st-error">{err}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          Crear y entrar
        </Button>
      </form>
    </main>
  );
}
