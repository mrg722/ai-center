'use client';

import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, inputCls } from '@/components/ui';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/login', { body: { email, password } });
      window.location.href = '/';
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-ink-900 p-6" data-testid="login-form">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-accent">AI COMMAND CENTER</div>
          <h1 className="mt-1 text-lg font-semibold">Entrar como moderador</h1>
        </div>
        <Field label="Email">
          <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {err && <p className="text-xs text-st-error">{err}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          Entrar
        </Button>
      </form>
    </main>
  );
}
