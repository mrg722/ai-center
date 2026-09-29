import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OrchestratorClient } from '../client.js';
import { runProcess, which } from '../runners/proc.js';
import { log } from '../log.js';

/**
 * StrixRuntime adapter (Bloque 9) — the ONLY place Strix (github.com/usestrix/strix)
 * is ever invoked. It polls the orchestrator for security runs that are
 * QUEUED (which the server only creates once an ACTIVE, in-window Engagement
 * authorizes the target — see src/server/security/store.ts), claims one,
 * shells the real Strix CLI, and reports back. Never runs from Vercel or any
 * hosted process — only from this Local Bridge, on the operator's machine,
 * exactly like claude-code.ts/codex.ts.
 *
 * Strix has no documented findings JSON schema, so parsing below is
 * best-effort: if nothing parseable is found, the run still reports its raw
 * summary text and zero findings rather than fabricating results.
 */

export interface StrixWorkerOptions {
  client: OrchestratorClient;
  workspace: string;
  maxRunSeconds: number;
  pollSeconds?: number;
}

export async function checkStrix(): Promise<string | null> {
  return (await which('strix')) ? null : 'Strix CLI not found on PATH. Install with: curl -sSL https://strix.ai/install | bash (requires Docker).';
}

async function findFindingsFile(root: string, runName: string): Promise<unknown[] | null> {
  try {
    const dir = join(root, 'strix_runs', runName);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const candidate = entries.find((f) => /findings.*\.json$/i.test(f)) ?? entries.find((f) => f.endsWith('.json'));
    if (!candidate) return null;
    const raw = JSON.parse(await readFile(join(dir, candidate), 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray((raw as { findings?: unknown[] }).findings)) return (raw as { findings: unknown[] }).findings;
    return null;
  } catch {
    return null;
  }
}

function normalizeFinding(raw: unknown): { title: string; severity: string; description?: string; evidence?: string; location?: string; raw: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? r.name ?? r.summary ?? '').slice(0, 300);
  if (!title) return null;
  const severityRaw = String(r.severity ?? r.risk ?? 'info').toLowerCase();
  const severity = ['info', 'low', 'medium', 'high', 'critical'].includes(severityRaw) ? severityRaw : 'info';
  return {
    title,
    severity,
    description: typeof r.description === 'string' ? r.description : undefined,
    evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
    location: typeof (r.location ?? r.file ?? r.endpoint) === 'string' ? String(r.location ?? r.file ?? r.endpoint) : undefined,
    raw: r,
  };
}

async function runOneRun(opts: StrixWorkerOptions, run: { id: string; target: string; scan_mode: string }, signal: AbortSignal): Promise<void> {
  const bridgeRunName = `run-${run.id.slice(0, 8)}-${Date.now()}`;
  await opts.client.claimSecurityRun(run.id, bridgeRunName);
  log.info(`Security run claimed`, { run_id: run.id, target: run.target, scan_mode: run.scan_mode });

  const args = ['--target', run.target, '--non-interactive', '--scan-mode', run.scan_mode];
  const res = await runProcess({
    bin: 'strix',
    args,
    cwd: opts.workspace,
    signal,
    timeoutS: opts.maxRunSeconds,
    onLine: (l) => log.debug(`[strix] ${l.slice(0, 300)}`),
    onErrLine: (l) => log.debug(`[strix:err] ${l.slice(0, 300)}`),
  });

  const parsed = (await findFindingsFile(opts.workspace, bridgeRunName)) ?? [];
  const findings = parsed.map(normalizeFinding).filter((f): f is NonNullable<typeof f> => f !== null);

  // exit 0 = clean, 2 = vulnerabilities found — both are a completed run; 1/other = fatal.
  const status: 'completed' | 'failed' = res.aborted || res.timedOut || (res.code !== 0 && res.code !== 2) ? 'failed' : 'completed';
  await opts.client.reportSecurityRun(run.id, {
    status,
    summary: res.stdout.slice(-4000),
    error: status === 'failed' ? (res.timedOut ? `Exceeded ${opts.maxRunSeconds}s` : res.stderr.slice(-4000)) : '',
    findings,
  });
  log.info(`Security run ${status}`, { run_id: run.id, findings: findings.length });
}

export async function startStrixWorker(opts: StrixWorkerOptions): Promise<never> {
  const problem = await checkStrix();
  if (problem) throw new Error(problem);
  const pollMs = (opts.pollSeconds ?? 20) * 1000;
  log.info('Strix worker started', { workspace: opts.workspace });
  for (;;) {
    try {
      const { runs } = await opts.client.queuedSecurityRuns();
      if (runs.length) {
        const ctrl = new AbortController();
        await runOneRun(opts, runs[0], ctrl.signal);
        continue; // check for more queued work immediately
      }
    } catch (e) {
      log.warn('Strix worker poll failed', String((e as Error).message ?? e));
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
