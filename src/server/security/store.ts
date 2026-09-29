import 'server-only';
import type { Db } from '../db';
import { BadRequest, Conflict, NotFound } from '../orchestrator/repo';
import type {
  CreateEngagementInput,
  CreateSecurityRunInput,
  EngagementRow,
  EngagementStatus,
  FindingRow,
  FindingStatus,
  SecurityRunRow,
  SecurityRunStatus,
} from './types';

/**
 * Security Lab (Bloque 9) — Strix runs only ever execute against a target
 * covered by an ACTIVE, currently-in-window engagement (see
 * getActiveAllowlist / assertEngagementAuthorizesRun below). This is the
 * safety gate the StrixRuntime bridge adapter (bridge/src/runners/strix.ts)
 * and the /api/security/runs route both rely on — a target with no active
 * engagement can never be scanned, third-party or not.
 */

const ENGAGEMENT_TRANSITIONS: Record<EngagementStatus, EngagementStatus[]> = {
  draft: ['active', 'revoked'],
  active: ['revoked', 'expired'],
  expired: ['active'],
  revoked: [],
};

export async function createEngagement(db: Db, i: CreateEngagementInput): Promise<EngagementRow> {
  if (!i.target.trim()) throw new BadRequest('target is required');
  if (!i.authorization_evidence.trim()) throw new BadRequest('authorization_evidence is required — describe or link the written authorization for this target');
  if (!i.authorized_by.trim()) throw new BadRequest('authorized_by is required');
  const r = await db.query<EngagementRow>(
    `insert into engagements (project_id, target, target_type, scope_notes, authorization_evidence, authorized_by, starts_at, ends_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [i.project_id, i.target.trim(), i.target_type, i.scope_notes ?? '', i.authorization_evidence.trim(), i.authorized_by.trim(), i.starts_at ?? null, i.ends_at ?? null, i.created_by],
  );
  return r.rows[0];
}

export async function listEngagements(db: Db, projectId: string): Promise<EngagementRow[]> {
  return (await db.query<EngagementRow>('select * from engagements where project_id=$1 order by created_at desc', [projectId])).rows;
}

export async function getEngagement(db: Db, id: string): Promise<EngagementRow> {
  const r = await db.query<EngagementRow>('select * from engagements where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('engagement not found');
  return r.rows[0];
}

export async function setEngagementStatus(db: Db, id: string, status: EngagementStatus): Promise<EngagementRow> {
  const current = await getEngagement(db, id);
  if (!ENGAGEMENT_TRANSITIONS[current.status].includes(status)) {
    throw new BadRequest(`cannot move engagement from "${current.status}" to "${status}"`);
  }
  const r = await db.query<EngagementRow>('update engagements set status=$2 where id=$1 returning *', [id, status]);
  return r.rows[0];
}

/** Engagements currently authorizing a run: status=active and within [starts_at, ends_at]. */
export async function getActiveAllowlist(db: Db, projectId: string): Promise<EngagementRow[]> {
  const r = await db.query<EngagementRow>(
    `select * from engagements
      where project_id=$1 and status='active'
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at >= now())
      order by created_at desc`,
    [projectId],
  );
  return r.rows;
}

async function assertEngagementAuthorizesRun(db: Db, engagement: EngagementRow): Promise<void> {
  if (engagement.status !== 'active') throw new Conflict(`engagement is "${engagement.status}", not active — activate it before running a scan`);
  const now = Date.now();
  if (engagement.starts_at && new Date(engagement.starts_at).getTime() > now) throw new Conflict('engagement authorization window has not started yet');
  if (engagement.ends_at && new Date(engagement.ends_at).getTime() < now) throw new Conflict('engagement authorization window has expired');
}

/**
 * Owner-only fast path: no manual Engagement, no draft→active step. Reuses
 * an existing active engagement for the exact target if one exists,
 * otherwise creates one (pre-activated) with an authorization_evidence that
 * says plainly what happened, so the audit trail stays honest even though
 * no separate approval occurred.
 */
export async function getOrCreateOwnerEngagement(db: Db, projectId: string, target: string, targetType: EngagementRow['target_type'], ownerName: string, ownerId: string): Promise<EngagementRow> {
  const trimmed = target.trim();
  if (!trimmed) throw new BadRequest('target is required');
  const existing = await db.query<EngagementRow>(
    `select * from engagements where project_id=$1 and target=$2 and target_type=$3 and status='active' and (ends_at is null or ends_at >= now()) order by created_at desc limit 1`,
    [projectId, trimmed, targetType],
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await db.query<EngagementRow>(
    `insert into engagements (project_id, target, target_type, scope_notes, authorization_evidence, authorized_by, status, created_by)
     values ($1,$2,$3,'', 'Auto-authorized: owner-initiated scan of their own target via the Security Lab PIN gate (no manual Engagement).', $4, 'active', $5) returning *`,
    [projectId, trimmed, targetType, ownerName, ownerId],
  );
  return r.rows[0];
}

export async function createSecurityRun(db: Db, i: CreateSecurityRunInput): Promise<SecurityRunRow> {
  const engagement = await getEngagement(db, i.engagement_id);
  if (engagement.project_id !== i.project_id) throw new NotFound('engagement not found');
  await assertEngagementAuthorizesRun(db, engagement);
  const r = await db.query<SecurityRunRow>(
    `insert into security_runs (project_id, engagement_id, target, scan_mode, requested_by)
     values ($1,$2,$3,$4,$5) returning *`,
    [i.project_id, i.engagement_id, engagement.target, i.scan_mode, i.requested_by],
  );
  return r.rows[0];
}

export async function listSecurityRuns(db: Db, projectId: string): Promise<SecurityRunRow[]> {
  return (await db.query<SecurityRunRow>('select * from security_runs where project_id=$1 order by created_at desc', [projectId])).rows;
}

/** Bridge polling target: runs waiting to be picked up, oldest first. */
export async function listQueuedSecurityRuns(db: Db, projectId: string): Promise<SecurityRunRow[]> {
  return (await db.query<SecurityRunRow>(`select * from security_runs where project_id=$1 and status='queued' order by created_at asc`, [projectId])).rows;
}

export async function getSecurityRun(db: Db, id: string): Promise<SecurityRunRow> {
  const r = await db.query<SecurityRunRow>('select * from security_runs where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('security run not found');
  return r.rows[0];
}

export async function updateSecurityRun(
  db: Db,
  id: string,
  patch: { status?: SecurityRunStatus; bridge_run_name?: string; summary?: string; error?: string; started_at?: string; completed_at?: string },
): Promise<SecurityRunRow> {
  await getSecurityRun(db, id); // 404s
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k}=$${params.length}`);
  }
  if (!sets.length) return getSecurityRun(db, id);
  const r = await db.query<SecurityRunRow>(`update security_runs set ${sets.join(', ')} where id=$1 returning *`, params);
  return r.rows[0];
}

/** Moderator-initiated stop — never a silent transition, always explicit. */
export async function stopSecurityRun(db: Db, id: string): Promise<SecurityRunRow> {
  const run = await getSecurityRun(db, id);
  if (run.status !== 'queued' && run.status !== 'running') throw new Conflict(`run is already "${run.status}"`);
  return updateSecurityRun(db, id, { status: 'stopped', completed_at: new Date().toISOString() });
}

/** Bridge claims the next queued run for its project — never invoked from Vercel. */
export async function claimSecurityRun(db: Db, projectId: string, id: string, bridgeRunName?: string): Promise<SecurityRunRow> {
  const run = await getSecurityRun(db, id);
  if (run.project_id !== projectId) throw new NotFound('security run not found');
  if (run.status !== 'queued') throw new Conflict(`run is "${run.status}", not queued`);
  return updateSecurityRun(db, id, { status: 'running', started_at: new Date().toISOString(), bridge_run_name: bridgeRunName });
}

/** Bridge reports the final outcome + parsed findings (best-effort — Strix has no documented findings schema). */
export async function reportSecurityRun(
  db: Db,
  projectId: string,
  id: string,
  i: { status: 'completed' | 'failed'; summary: string; error: string; findings: { title: string; severity: FindingRow['severity']; description?: string; evidence?: string; location?: string; raw?: Record<string, unknown> }[] },
): Promise<SecurityRunRow> {
  const run = await getSecurityRun(db, id);
  if (run.project_id !== projectId) throw new NotFound('security run not found');
  if (run.status !== 'running') throw new Conflict(`run is "${run.status}", not running`);
  const updated = await updateSecurityRun(db, id, { status: i.status, summary: i.summary, error: i.error, completed_at: new Date().toISOString() });
  for (const f of i.findings) {
    await addFinding(db, { project_id: projectId, security_run_id: id, ...f });
  }
  return updated;
}

export async function addFinding(
  db: Db,
  i: { project_id: string; security_run_id: string; title: string; severity: FindingRow['severity']; description?: string; evidence?: string; location?: string; raw?: Record<string, unknown> },
): Promise<FindingRow> {
  const r = await db.query<FindingRow>(
    `insert into findings (project_id, security_run_id, title, severity, description, evidence, location, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [i.project_id, i.security_run_id, i.title.slice(0, 300), i.severity, i.description ?? '', i.evidence ?? '', i.location ?? '', JSON.stringify(i.raw ?? {})],
  );
  return r.rows[0];
}

export async function listFindings(db: Db, projectId: string, f: { securityRunId?: string; severity?: string; status?: string } = {}): Promise<FindingRow[]> {
  const conds = ['project_id=$1'];
  const params: unknown[] = [projectId];
  if (f.securityRunId) {
    params.push(f.securityRunId);
    conds.push(`security_run_id=$${params.length}`);
  }
  if (f.severity) {
    params.push(f.severity);
    conds.push(`severity=$${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    conds.push(`status=$${params.length}`);
  }
  const r = await db.query<FindingRow>(
    `select * from findings where ${conds.join(' and ')} order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end, created_at desc`,
    params,
  );
  return r.rows;
}

export async function getFinding(db: Db, id: string): Promise<FindingRow> {
  const r = await db.query<FindingRow>('select * from findings where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('finding not found');
  return r.rows[0];
}

export async function setFindingStatus(db: Db, id: string, status: FindingStatus): Promise<FindingRow> {
  const r = await db.query<FindingRow>('update findings set status=$2 where id=$1 returning *', [id, status]);
  if (!r.rows[0]) throw new NotFound('finding not found');
  return r.rows[0];
}
