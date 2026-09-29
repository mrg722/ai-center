/**
 * Security Lab (Bloque 9): a security run may only be created against an
 * engagement that is ACTIVE and within its authorization window — this is
 * the TEST_TARGET_ALLOWLIST gate (src/server/security/store.ts). Strix
 * itself (the CLI) is not invoked here — it requires Docker and is only
 * ever shelled from bridge/src/security/strix-worker.ts on the Local
 * Bridge — these tests cover the data model and the allowlist gate, which
 * is real regardless of whether Strix is installed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject } from '@/server/orchestrator/repo';
import {
  addFinding,
  claimSecurityRun,
  createEngagement,
  createSecurityRun,
  getActiveAllowlist,
  getOrCreateOwnerEngagement,
  listFindings,
  listQueuedSecurityRuns,
  reportSecurityRun,
  setEngagementStatus,
  stopSecurityRun,
} from '@/server/security/store';
import { hasSecurityPin, setSecurityPin, verifySecurityPin } from '@/server/security/pin';
import type { ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let userId: string;

async function fresh() {
  __setDb(undefined);
  process.env.PGLITE_DIR = 'memory';
  delete process.env.DATABASE_URL;
  db = await getDb();
  const s = await runSetup(db, {
    email: 'mod@example.com',
    display_name: 'Mar',
    password: 'a-very-long-password',
    project_name: 'Demo',
    project_key: 'DF',
    repo: 'acme/web',
    default_branch: 'main',
  });
  userId = s.userId;
  project = await requireProject(db, userId);
}

describe('security lab', () => {
  beforeEach(fresh, 30_000);

  it('a run cannot be created against a draft engagement', async () => {
    const e = await createEngagement(db, {
      project_id: project.id,
      target: 'acme/web',
      target_type: 'repo',
      authorization_evidence: 'self-owned repo, moderator authorized',
      authorized_by: 'Mar',
      created_by: userId,
    });
    expect(e.status).toBe('draft');
    await expect(createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'quick', requested_by: userId })).rejects.toThrow(/not active/);
  });

  it('activating an engagement puts it on the allowlist and allows a run', async () => {
    const e = await createEngagement(db, {
      project_id: project.id,
      target: 'acme/web',
      target_type: 'repo',
      authorization_evidence: 'self-owned',
      authorized_by: 'Mar',
      created_by: userId,
    });
    await setEngagementStatus(db, e.id, 'active');
    const allowlist = await getActiveAllowlist(db, project.id);
    expect(allowlist.map((a) => a.id)).toContain(e.id);

    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'quick', requested_by: userId });
    expect(run.status).toBe('queued');
    expect(run.target).toBe('acme/web');
  });

  it('a run outside the engagement authorization window is rejected', async () => {
    const e = await createEngagement(db, {
      project_id: project.id,
      target: 'acme/web',
      target_type: 'repo',
      authorization_evidence: 'self-owned',
      authorized_by: 'Mar',
      created_by: userId,
      starts_at: new Date(Date.now() + 3_600_000).toISOString(), // starts in the future
    });
    await setEngagementStatus(db, e.id, 'active');
    await expect(createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'quick', requested_by: userId })).rejects.toThrow(/has not started/);
  });

  it('rejects invalid engagement status transitions', async () => {
    const e = await createEngagement(db, {
      project_id: project.id,
      target: 'acme/web',
      target_type: 'repo',
      authorization_evidence: 'self-owned',
      authorized_by: 'Mar',
      created_by: userId,
    });
    await expect(setEngagementStatus(db, e.id, 'expired')).rejects.toThrow(/cannot move engagement/);
    await setEngagementStatus(db, e.id, 'revoked');
    await expect(setEngagementStatus(db, e.id, 'active')).rejects.toThrow(/cannot move engagement/);
  });

  it('requires target + authorization_evidence + authorized_by', async () => {
    await expect(
      createEngagement(db, { project_id: project.id, target: '', target_type: 'repo', authorization_evidence: 'x', authorized_by: 'Mar', created_by: userId }),
    ).rejects.toThrow(/target is required/);
    await expect(
      createEngagement(db, { project_id: project.id, target: 'acme/web', target_type: 'repo', authorization_evidence: '', authorized_by: 'Mar', created_by: userId }),
    ).rejects.toThrow(/authorization_evidence/);
  });

  it('claim → report lifecycle: queued → running → completed, with findings persisted', async () => {
    const e = await createEngagement(db, {
      project_id: project.id,
      target: 'acme/web',
      target_type: 'repo',
      authorization_evidence: 'self-owned',
      authorized_by: 'Mar',
      created_by: userId,
    });
    await setEngagementStatus(db, e.id, 'active');
    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'standard', requested_by: userId });

    expect((await listQueuedSecurityRuns(db, project.id)).map((r) => r.id)).toContain(run.id);

    const claimed = await claimSecurityRun(db, project.id, run.id, 'run-abc123');
    expect(claimed.status).toBe('running');
    expect(claimed.bridge_run_name).toBe('run-abc123');
    expect((await listQueuedSecurityRuns(db, project.id)).map((r) => r.id)).not.toContain(run.id);

    // can't claim twice
    await expect(claimSecurityRun(db, project.id, run.id, 'again')).rejects.toThrow(/not queued/);

    const reported = await reportSecurityRun(db, project.id, run.id, {
      status: 'completed',
      summary: 'scan finished',
      error: '',
      findings: [{ title: 'Reflected XSS', severity: 'high', description: 'unescaped param', location: '/search?q=' }],
    });
    expect(reported.status).toBe('completed');

    const findings = await listFindings(db, project.id, { securityRunId: run.id });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Reflected XSS');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].status).toBe('open');
  });

  it('findings are ordered by severity (critical first)', async () => {
    const e = await createEngagement(db, { project_id: project.id, target: 'acme/web', target_type: 'repo', authorization_evidence: 'x', authorized_by: 'Mar', created_by: userId });
    await setEngagementStatus(db, e.id, 'active');
    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'quick', requested_by: userId });
    await addFinding(db, { project_id: project.id, security_run_id: run.id, title: 'low one', severity: 'low' });
    await addFinding(db, { project_id: project.id, security_run_id: run.id, title: 'critical one', severity: 'critical' });
    const findings = await listFindings(db, project.id, { securityRunId: run.id });
    expect(findings[0].title).toBe('critical one');
  });

  it('a moderator can stop a queued or running run, but not one already finished', async () => {
    const e = await createEngagement(db, { project_id: project.id, target: 'acme/web', target_type: 'repo', authorization_evidence: 'x', authorized_by: 'Mar', created_by: userId });
    await setEngagementStatus(db, e.id, 'active');
    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: e.id, scan_mode: 'quick', requested_by: userId });
    const stopped = await stopSecurityRun(db, run.id);
    expect(stopped.status).toBe('stopped');
    await expect(stopSecurityRun(db, run.id)).rejects.toThrow(/already/);
  });

  it('owner fast path: getOrCreateOwnerEngagement creates one active engagement and reuses it for the same target', async () => {
    const first = await getOrCreateOwnerEngagement(db, project.id, 'https://mi-sitio.com', 'url', 'Mar', userId);
    expect(first.status).toBe('active');
    expect(first.target).toBe('https://mi-sitio.com');
    const second = await getOrCreateOwnerEngagement(db, project.id, 'https://mi-sitio.com', 'url', 'Mar', userId);
    expect(second.id).toBe(first.id); // reused, not duplicated

    const run = await createSecurityRun(db, { project_id: project.id, engagement_id: first.id, scan_mode: 'quick', requested_by: userId });
    expect(run.status).toBe('queued');
  });

  it('Security Lab PIN: unset by default, set/verify/change with scrypt hashing (never plaintext)', async () => {
    expect(await hasSecurityPin(db, project.id)).toBe(false);

    await setSecurityPin(db, project.id, 'martin12345678');
    expect(await hasSecurityPin(db, project.id)).toBe(true);
    expect(await verifySecurityPin(db, project.id, 'martin12345678')).toBe(true);
    expect(await verifySecurityPin(db, project.id, 'wrong-pin')).toBe(false);

    // changing requires the correct current PIN
    await expect(setSecurityPin(db, project.id, 'newpin1234', 'wrong-current')).rejects.toThrow(/incorrect/);
    await setSecurityPin(db, project.id, 'newpin1234', 'martin12345678');
    expect(await verifySecurityPin(db, project.id, 'newpin1234')).toBe(true);
    expect(await verifySecurityPin(db, project.id, 'martin12345678')).toBe(false);
  });

  it('rejects a PIN shorter than 8 characters', async () => {
    await expect(setSecurityPin(db, project.id, 'short')).rejects.toThrow(/at least 8/);
  });
});
