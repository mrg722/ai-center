'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import type { EngagementView, SecurityRunView } from '@/lib/client/types';
import { Button, cx, Empty, Field, inputCls, Modal, timeAgo } from '@/components/ui';

/**
 * Security Lab (Bloque 9). Strix runs only ever execute via the Local
 * Bridge (never from Vercel/hosted infra) and only against a target covered
 * by an ACTIVE, in-window Engagement — the authorization record below. See
 * src/server/security/store.ts (assertEngagementAuthorizesRun) for the gate
 * this UI reflects but does not itself enforce.
 */
export default function SecurityLabPage() {
  const [engagements, setEngagements] = useState<EngagementView[]>([]);
  const [runs, setRuns] = useState<SecurityRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingEngagement, setCreatingEngagement] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);

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

  const activeEngagements = engagements.filter((e) => e.status === 'active');

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Security Lab</h1>
          <p className="text-xs text-fg-dim">
            Pentesting con Strix, siempre vía Local Bridge — nunca desde infra hosteada. Un run solo puede lanzarse contra un target con un Engagement{' '}
            <span className="text-fg-muted">activo</span> y vigente.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="accent" onClick={() => setCreatingEngagement(true)}>
            + Nuevo Engagement
          </Button>
          <Button variant="primary" disabled={!activeEngagements.length} onClick={() => setCreatingRun(true)} title={!activeEngagements.length ? 'Necesitas un Engagement activo primero' : undefined}>
            + Nuevo Security Run
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Engagements (autorización)</h2>
        {loading ? (
          <Empty>Cargando…</Empty>
        ) : engagements.length === 0 ? (
          <Empty>Sin engagements todavía. Crea uno antes de poder lanzar un run.</Empty>
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
                  <Button size="sm" variant="danger" onClick={() => setStatus(e.id, 'revoked')}>
                    Revocar
                  </Button>
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

      <CreateEngagementModal open={creatingEngagement} onClose={() => setCreatingEngagement(false)} onCreated={reload} />
      <CreateRunModal open={creatingRun} onClose={() => setCreatingRun(false)} onCreated={reload} engagements={activeEngagements} />
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

function CreateEngagementModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ target: '', target_type: 'repo' as 'repo' | 'url' | 'host', scope_notes: '', authorization_evidence: '', authorized_by: '' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/security/engagements', { body: form });
      setForm({ target: '', target_type: 'repo', scope_notes: '', authorization_evidence: '', authorized_by: '' });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo Engagement" wide>
      <div className="space-y-3">
        <Field label="Target" hint="Repo (owner/nombre), URL, o host.">
          <input className={inputCls} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="acme/web" />
        </Field>
        <Field label="Tipo">
          <select className={inputCls} value={form.target_type} onChange={(e) => setForm({ ...form, target_type: e.target.value as typeof form.target_type })}>
            <option value="repo">repo</option>
            <option value="url">url</option>
            <option value="host">host</option>
          </select>
        </Field>
        <Field label="Alcance (opcional)" hint="Qué está dentro/fuera de alcance.">
          <textarea className={cx(inputCls, 'min-h-20')} value={form.scope_notes} onChange={(e) => setForm({ ...form, scope_notes: e.target.value })} />
        </Field>
        <Field label="Evidencia de autorización" hint="Link o descripción de la autorización por escrito. Para targets propios, indícalo explícitamente.">
          <textarea className={cx(inputCls, 'min-h-20')} value={form.authorization_evidence} onChange={(e) => setForm({ ...form, authorization_evidence: e.target.value })} />
        </Field>
        <Field label="Autorizado por">
          <input className={inputCls} value={form.authorized_by} onChange={(e) => setForm({ ...form, authorized_by: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !form.target.trim() || !form.authorization_evidence.trim() || !form.authorized_by.trim()} onClick={submit}>
            Crear (queda en borrador)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateRunModal({ open, onClose, onCreated, engagements }: { open: boolean; onClose: () => void; onCreated: () => void; engagements: EngagementView[] }) {
  const [engagementId, setEngagementId] = useState('');
  const [scanMode, setScanMode] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && engagements.length && !engagementId) setEngagementId(engagements[0].id);
  }, [open, engagements, engagementId]);
  async function submit() {
    setBusy(true);
    try {
      await api('/api/security/runs', { body: { engagement_id: engagementId, scan_mode: scanMode } });
      onClose();
      onCreated();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo Security Run">
      <div className="space-y-3">
        <Field label="Engagement" hint="Solo se listan engagements activos y vigentes.">
          <select className={inputCls} value={engagementId} onChange={(e) => setEngagementId(e.target.value)}>
            {engagements.map((e) => (
              <option key={e.id} value={e.id}>
                {e.target}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Modo de escaneo">
          <select className={inputCls} value={scanMode} onChange={(e) => setScanMode(e.target.value as typeof scanMode)}>
            <option value="quick">quick</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !engagementId} onClick={submit}>
            Lanzar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
