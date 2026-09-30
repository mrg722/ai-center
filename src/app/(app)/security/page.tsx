'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import type { EngagementView, SecurityRunView } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal, timeAgo } from '@/components/ui';

/**
 * Security Lab (Bloque 9). Owner-only, PIN-gated — Strix performs REAL
 * active exploitation, not a passive scan (see src/server/security/pin.ts).
 * The owner's own targets skip the Engagement draft→active workflow
 * entirely (getOrCreateOwnerEngagement) — Engagements stay available for
 * third-party targets that need a formal, dated authorization record.
 */
export default function SecurityLabPage() {
  const [pinStatus, setPinStatus] = useState<{ pin_set: boolean; unlocked: boolean } | null>(null);

  async function reloadPinStatus() {
    try {
      setPinStatus(await api<{ pin_set: boolean; unlocked: boolean }>('/api/security/pin'));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  useEffect(() => {
    reloadPinStatus();
  }, []);

  if (!pinStatus) return <Empty>Cargando…</Empty>;
  if (!pinStatus.pin_set) return <SetPinScreen onDone={reloadPinStatus} />;
  if (!pinStatus.unlocked) return <UnlockScreen onUnlocked={reloadPinStatus} />;
  return <SecurityLabContent onLocked={reloadPinStatus} />;
}

function SetPinScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (pin !== confirm) return alert('El PIN no coincide.');
    setBusy(true);
    try {
      await api('/api/security/pin', { body: { pin } });
      onDone();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-3 sm:p-5">
      <h1 className="text-lg font-semibold">Configura el PIN de Security Lab</h1>
      <p className="text-xs text-fg-dim">
        Strix ataca de verdad al target (SQLi, XSS, RCE, bypass de auth…), no es un scanner pasivo. Esta sección queda bloqueada detrás de un PIN además de tu sesión de owner —
        defínelo ahora, solo tú lo vas a usar.
      </p>
      <Field label="PIN (mínimo 8 caracteres)">
        <input type="password" className={inputCls} value={pin} onChange={(e) => setPin(e.target.value)} />
      </Field>
      <Field label="Confirmar PIN">
        <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={busy || pin.length < 8 || pin !== confirm} onClick={submit}>
        Guardar PIN
      </Button>
    </div>
  );
}

function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/security/unlock', { body: { pin } });
      onUnlocked();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-3 sm:p-5">
      <h1 className="text-lg font-semibold">Security Lab bloqueado</h1>
      <p className="text-xs text-fg-dim">Ingresa el PIN para desbloquear esta sección (dura 2 horas).</p>
      <Field label="PIN">
        <input
          type="password"
          autoFocus
          className={inputCls}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
      <Button variant="primary" disabled={busy || !pin} onClick={submit}>
        Desbloquear
      </Button>
    </div>
  );
}

function SecurityLabContent({ onLocked }: { onLocked: () => void }) {
  const [engagements, setEngagements] = useState<EngagementView[]>([]);
  const [runs, setRuns] = useState<SecurityRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickScan, setQuickScan] = useState(false);
  const [changingPin, setChangingPin] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [e, r] = await Promise.all([
        api<{ engagements: EngagementView[] }>('/api/security/engagements'),
        api<{ runs: SecurityRunView[] }>('/api/security/runs'),
      ]);
      setEngagements(e.engagements);
      setRuns(r.runs);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function setStatus(id: string, status: EngagementView['status']) {
    try {
      await api(`/api/security/engagements/${id}`, { method: 'PATCH', body: { status } });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function launchFromEngagement(engagementId: string) {
    try {
      await api('/api/security/runs', { body: { engagement_id: engagementId, scan_mode: 'standard' } });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function lockNow() {
    try {
      await api('/api/security/lock', { body: {} });
      onLocked();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Security Lab</h1>
          <p className="text-xs text-fg-dim">Pentesting con Strix, siempre vía Local Bridge — nunca desde infra hosteada. Escaneo directo para tus propios targets, sin fricción.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setChangingPin(true)}>
            Cambiar PIN
          </Button>
          <Button size="sm" onClick={lockNow}>
            Bloquear ahora
          </Button>
          <Button variant="primary" onClick={() => setQuickScan(true)}>
            + Nuevo Scan
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Engagements</h2>
        <p className="text-[11px] text-fg-dim">Tus propios scans no requieren evidencia ni un aprobador manual: el Security Lab crea el registro de auditoría automáticamente detrás del PIN. La vía manual para terceros permanece disponible solo por API.</p>
        {loading ? (
          <Empty>Cargando…</Empty>
        ) : engagements.length === 0 ? (
          <Empty>Sin engagements todavía.</Empty>
        ) : (
          <div className="space-y-2">
            {engagements.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-900 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{e.target}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">{e.target_type}</span>
                    <EngagementStatusBadge status={e.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-dim">
                    <span>autorizado por {e.authorized_by || '—'}</span>
                    <span>· {timeAgo(e.created_at)}</span>
                    {(e.starts_at || e.ends_at) && (
                      <span>
                        · vigencia {e.starts_at ? new Date(e.starts_at).toLocaleDateString() : '—'} → {e.ends_at ? new Date(e.ends_at).toLocaleDateString() : '—'}
                      </span>
                    )}
                  </div>
                </div>
                {e.status === 'draft' && (
                  <Button size="sm" variant="primary" onClick={() => setStatus(e.id, 'active')}>
                    Activar
                  </Button>
                )}
                {e.status === 'active' && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => launchFromEngagement(e.id)}>
                      Lanzar run
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setStatus(e.id, 'revoked')}>
                      Revocar
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Security Runs</h2>
        {loading ? (
          <Empty>Cargando…</Empty>
        ) : runs.length === 0 ? (
          <Empty>Sin runs todavía.</Empty>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <Link key={r.id} href={`/security/runs/${r.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-ink-900 p-3 hover:border-line-strong">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{r.target}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">{r.scan_mode}</span>
                    <RunStatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 text-[11px] text-fg-dim">{timeAgo(r.created_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <QuickScanModal open={quickScan} onClose={() => setQuickScan(false)} onCreated={reload} />
      <ChangePinModal open={changingPin} onClose={() => setChangingPin(false)} />
    </div>
  );
}

function EngagementStatusBadge({ status }: { status: EngagementView['status'] }) {
  const styles: Record<EngagementView['status'], string> = {
    draft: 'border-line-strong text-fg-dim',
    active: 'border-st-online/40 text-st-online',
    expired: 'border-st-waiting/40 text-st-waiting',
    revoked: 'border-st-error/40 text-st-error',
  };
  return <span className={cx('rounded border px-1.5 py-0.5 text-[10px]', styles[status])}>{status}</span>;
}

function RunStatusBadge({ status }: { status: SecurityRunView['status'] }) {
  const styles: Record<SecurityRunView['status'], string> = {
    queued: 'border-line-strong text-fg-dim',
    running: 'border-accent/40 text-accent',
    completed: 'border-st-online/40 text-st-online',
    failed: 'border-st-error/40 text-st-error',
    stopped: 'border-st-waiting/40 text-st-waiting',
  };
  return <span className={cx('rounded border px-1.5 py-0.5 text-[10px]', styles[status])}>{status}</span>;
}

/** Owner fast path: no manual Engagement, no draft→active step (getOrCreateOwnerEngagement on the server). */
function QuickScanModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ target: '', target_type: 'url' as 'repo' | 'url' | 'host', scan_mode: 'standard' as 'quick' | 'standard' | 'deep' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/security/runs', { body: form });
      setForm({ target: '', target_type: 'url', scan_mode: 'standard' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo Scan">
      <div className="space-y-3">
        <Field label="Target" hint="Tu propio repo, URL o host. No hace falta crear un Engagement antes.">
          <input className={inputCls} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="https://mi-sitio.com" />
        </Field>
        <Field label="Tipo">
          <select className={inputCls} value={form.target_type} onChange={(e) => setForm({ ...form, target_type: e.target.value as typeof form.target_type })}>
            <option value="url">url</option>
            <option value="repo">repo</option>
            <option value="host">host</option>
          </select>
        </Field>
        <Field label="Modo de escaneo">
          <select className={inputCls} value={form.scan_mode} onChange={(e) => setForm({ ...form, scan_mode: e.target.value as typeof form.scan_mode })}>
            <option value="quick">quick</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.target.trim()} onClick={submit}>
            Lanzar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ChangePinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (newPin !== confirmPin) return alert('El PIN nuevo no coincide.');
    setBusy(true);
    try {
      await api('/api/security/pin', { body: { pin: newPin, current_pin: currentPin } });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      onClose();
      alert('PIN actualizado.');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Cambiar PIN de Security Lab">
      <div className="space-y-3">
        <Field label="PIN actual">
          <input type="password" className={inputCls} value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} />
        </Field>
        <Field label="PIN nuevo (mínimo 8 caracteres)">
          <input type="password" className={inputCls} value={newPin} onChange={(e) => setNewPin(e.target.value)} />
        </Field>
        <Field label="Confirmar PIN nuevo">
          <input type="password" className={inputCls} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !currentPin || newPin.length < 8 || newPin !== confirmPin} onClick={submit}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
