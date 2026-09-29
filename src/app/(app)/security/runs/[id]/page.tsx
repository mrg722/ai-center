'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import type { FindingView, SecurityRunView } from '@/lib/client/types';
import { Button, cx, Empty, timeAgo } from '@/components/ui';

const SEVERITY_STYLES: Record<FindingView['severity'], string> = {
  critical: 'border-st-error/50 text-st-error bg-st-error/10',
  high: 'border-st-error/40 text-st-error',
  medium: 'border-st-waiting/40 text-st-waiting',
  low: 'border-line-strong text-fg-muted',
  info: 'border-line-strong text-fg-dim',
};

export default function SecurityRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<SecurityRunView | null>(null);
  const [findings, setFindings] = useState<FindingView[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try {
      const r = await api<{ run: SecurityRunView; findings: FindingView[] }>(`/api/security/runs/${id}`);
      setRun(r.run);
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
  }, [id]);

  async function stop() {
    if (!confirm('¿Detener este run?')) return;
    try {
      await api(`/api/security/runs/${id}`, { method: 'PATCH' });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (loading) return <Empty>Cargando…</Empty>;
  if (!run) return <Empty>Run no encontrado.</Empty>;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-3 sm:p-5">
      <Link href="/security" className="text-xs text-fg-dim hover:text-fg-muted">
        ← Security Lab
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-lg font-semibold">{run.target}</h1>
          <p className="text-xs text-fg-dim">
            {run.scan_mode} · {run.status} · lanzado {timeAgo(run.created_at)}
            {run.bridge_run_name && <> · run {run.bridge_run_name}</>}
          </p>
        </div>
        {(run.status === 'queued' || run.status === 'running') && (
          <Button variant="danger" className="ml-auto" onClick={stop}>
            Detener
          </Button>
        )}
      </div>

      {run.status === 'queued' && (
        <div className="rounded-lg border border-line bg-ink-900 p-3 text-xs text-fg-dim">
          En cola. El adaptador Strix (Local Bridge) todavía no ha tomado este run — requiere que un bridge con Docker esté conectado.
        </div>
      )}
      {run.summary && <div className="rounded-lg border border-line bg-ink-900 p-3 text-sm">{run.summary}</div>}
      {run.error && <div className="rounded-lg border border-st-error/40 bg-st-error/10 p-3 text-sm text-st-error">{run.error}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <Empty>Sin findings todavía.</Empty>
        ) : (
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="rounded-lg border border-line bg-ink-900 p-3">
                <div className="flex items-center gap-2">
                  <span className={cx('rounded border px-1.5 py-0.5 text-[10px] uppercase', SEVERITY_STYLES[f.severity])}>{f.severity}</span>
                  <span className="text-sm font-semibold">{f.title}</span>
                  <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-fg-dim">{f.status}</span>
                </div>
                {f.location && <div className="mt-1 font-mono text-[11px] text-fg-dim">{f.location}</div>}
                {f.description && <p className="mt-1 text-xs text-fg-muted">{f.description}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
