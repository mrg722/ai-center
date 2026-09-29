'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { FindingView } from '@/lib/client/types';
import { cx, Empty, inputCls, timeAgo } from '@/components/ui';

const SEVERITY_STYLES: Record<FindingView['severity'], string> = {
  critical: 'border-st-error/50 text-st-error bg-st-error/10',
  high: 'border-st-error/40 text-st-error',
  medium: 'border-st-waiting/40 text-st-waiting',
  low: 'border-line-strong text-fg-muted',
  info: 'border-line-strong text-fg-dim',
};

const STATUS_OPTIONS: FindingView['status'][] = ['open', 'confirmed', 'false_positive', 'fixed'];

/** All findings across every Security Run in the current project. */
export default function FindingsPage() {
  const [findings, setFindings] = useState<FindingView[]>([]);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severity) params.set('severity', severity);
      if (status) params.set('status', status);
      const r = await api<{ findings: FindingView[] }>(`/api/security/findings?${params.toString()}`);
      setFindings(r.findings);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, status]);

  async function setFindingStatus(id: string, next: FindingView['status']) {
    try {
      await api(`/api/security/findings/${id}`, { method: 'PATCH', body: { status: next } });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-5">
      <div>
        <h1 className="text-lg font-semibold">Findings</h1>
        <p className="text-xs text-fg-dim">Hallazgos de todos los Security Runs del proyecto actual.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className={cx(inputCls, 'w-auto')} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Toda severidad</option>
          <option value="critical">critical</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
          <option value="info">info</option>
        </select>
        <select className={cx(inputCls, 'w-auto')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todo estado</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Empty>Cargando…</Empty>
      ) : findings.length === 0 ? (
        <Empty>Sin findings.</Empty>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <div key={f.id} className="rounded-lg border border-line bg-ink-900 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('rounded border px-1.5 py-0.5 text-[10px] uppercase', SEVERITY_STYLES[f.severity])}>{f.severity}</span>
                <span className="text-sm font-semibold">{f.title}</span>
                <span className="text-[11px] text-fg-dim">· {timeAgo(f.created_at)}</span>
                <select
                  className={cx(inputCls, 'ml-auto w-auto py-1 text-xs')}
                  value={f.status}
                  onChange={(e) => setFindingStatus(f.id, e.target.value as FindingView['status'])}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              {f.location && <div className="mt-1 font-mono text-[11px] text-fg-dim">{f.location}</div>}
              {f.description && <p className="mt-1 text-xs text-fg-muted">{f.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
