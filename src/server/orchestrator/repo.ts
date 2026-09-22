import type { Db } from '../db';
import type { AgentRow, AgentView, ApprovalRow, MessageRow, ProjectRow, SessionRow, TaskRow } from '../types';
import { HEARTBEAT_TIMEOUT_S, PERMISSION_ACTIONS, type AgentStatus, type PermissionSet } from '../../shared/domain';
import { getRuntime, httpReadiness } from '../providers/registry';

export class NotFound extends Error {
  status = 404;
}
export class Forbidden extends Error {
  status = 403;
}
export class BadRequest extends Error {
  status = 400;
}
export class Conflict extends Error {
  status = 409;
}

/* ───────────────────────────── projects */
export async function getCurrentProject(db: Db): Promise<ProjectRow | null> {
  const r = await db.query<ProjectRow>('select * from projects order by created_at asc limit 1');
  return r.rows[0] ?? null;
}

export async function requireProject(db: Db): Promise<ProjectRow> {
  const p = await getCurrentProject(db);
  if (!p) throw new NotFound('No project configured yet. Complete /setup first.');
  return p;
}

export async function getProjectById(db: Db, id: string): Promise<ProjectRow> {
  const r = await db.query<ProjectRow>('select * from projects where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('project not found');
  return r.rows[0];
}

/* ───────────────────────────── agents */
export async function listAgentRows(db: Db, projectId: string): Promise<AgentRow[]> {
  return (await db.query<AgentRow>('select * from agents where project_id=$1 order by sort_order, created_at', [projectId])).rows;
}

export async function getAgent(db: Db, id: string): Promise<AgentRow> {
  const r = await db.query<AgentRow>('select * from agents where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('agent not found');
  return r.rows[0];
}

export async function getAgentBySlug(db: Db, projectId: string, slug: string): Promise<AgentRow | null> {
  const r = await db.query<AgentRow>('select * from agents where project_id=$1 and slug=$2', [projectId, slug.toLowerCase()]);
  return r.rows[0] ?? null;
}

export async function getAgentByTokenHash(db: Db, hash: string): Promise<AgentRow | null> {
  const r = await db.query<AgentRow>('select * from agents where token_hash=$1', [hash]);
  return r.rows[0] ?? null;
}

export async function effectivePermissions(db: Db, agentId: string): Promise<PermissionSet> {
  const r = await db.query<{ action: string; allowed: boolean }>(
    `select distinct on (action) action, allowed from permissions
      where agent_id=$1 and revoked_at is null and (expires_at is null or expires_at > now())
      order by action, (scope='temporary') desc, created_at desc`,
    [agentId],
  );
  const set = Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, false])) as PermissionSet;
  for (const row of r.rows) if (row.action in set) set[row.action as keyof PermissionSet] = row.allowed;
  return set;
}

export async function temporaryGrants(db: Db, agentId: string) {
  return (
    await db.query<{ id: string; action: string; allowed: boolean; expires_at: string | null; reason: string }>(
      `select id, action, allowed, expires_at, reason from permissions
        where agent_id=$1 and scope='temporary' and revoked_at is null and (expires_at is null or expires_at > now())
        order by created_at desc`,
      [agentId],
    )
  ).rows;
}

export async function openSession(db: Db, agentId: string): Promise<SessionRow | null> {
  const r = await db.query<SessionRow>(
    `select * from agent_sessions where agent_id=$1 and ended_at is null order by last_heartbeat_at desc limit 1`,
    [agentId],
  );
  return r.rows[0] ?? null;
}

/**
 * THE single source of truth for AgentState. Derived here — and only here —
 * from real signals: bridge heartbeats, runtime readiness, moderator flags and
 * task state. Every view (roster, office, status bar) renders this value; none
 * of them computes its own.
 */
export function deriveStatus(
  a: AgentRow,
  s: SessionRow | null,
  waitingOnTask: boolean,
  project: Pick<ProjectRow, 'halted' | 'mode'>,
): { status: AgentStatus; reason: string } {
  if (!a.enabled) return { status: 'OFFLINE', reason: 'disabled' };
  const demo = project.mode === 'DEMO';
  const runtime = getRuntime(a.runtime);
  // runs driven by the orchestrator update the session at start/end only; the window covers the run timeout
  const windowS = demo || a.transport !== 'local-bridge' ? 200 : HEARTBEAT_TIMEOUT_S;
  const fresh = Boolean(s && !s.ended_at && Date.now() - new Date(s.last_heartbeat_at).getTime() < windowS * 1000);

  if (!demo) {
    if (!runtime) return { status: 'OFFLINE', reason: `unknown runtime ${a.runtime}` };
    if (a.transport === 'http-api') {
      const ready = httpReadiness(runtime, a.config, a.model);
      if (!ready.ready) return { status: 'OFFLINE', reason: ready.reason ?? 'not configured' };
    } else if (a.transport === 'local-bridge' && !fresh) {
      return { status: 'OFFLINE', reason: a.token_hash ? 'bridge not connected' : 'no bridge token issued' };
    }
  }

  if (project.halted) return { status: 'BLOCKED', reason: 'STOP ALL active' };
  if (a.paused) return { status: 'BLOCKED', reason: 'paused by moderator' };
  const live = fresh ? s!.status : 'ONLINE';
  if (live === 'ONLINE' && waitingOnTask) return { status: 'WAITING', reason: 'waiting on another agent / moderator' };
  return { status: live, reason: demo ? 'SIMULATED (DEMO mode)' : fresh ? s!.activity : '' };
}

export async function agentViews(db: Db, project: ProjectRow): Promise<AgentView[]> {
  const agents = await listAgentRows(db, project.id);
  if (!agents.length) return [];
  const ids = agents.map((a) => a.id);
  const [sessions, waiting, perms, grants, capRows] = await Promise.all([
    db.query<SessionRow>(
      `select distinct on (agent_id) * from agent_sessions
        where agent_id = any($1::uuid[]) and ended_at is null order by agent_id, last_heartbeat_at desc`,
      [ids],
    ),
    db.query<{ agent: string }>(
      `select distinct assigned_agent as agent from tasks
        where project_id=$1 and status in ('WAITING_AGENT','WAITING_REVIEW','WAITING_USER') and assigned_agent is not null`,
      [project.id],
    ),
    Promise.all(ids.map((id) => effectivePermissions(db, id))),
    Promise.all(ids.map((id) => temporaryGrants(db, id))),
    db.query<{ agent_id: string; capability: string }>('select agent_id, capability from agent_capabilities where agent_id = any($1::uuid[])', [ids]),
  ]);
  const caps = new Map<string, string[]>();
  for (const r of capRows.rows) caps.set(r.agent_id, [...(caps.get(r.agent_id) ?? []), r.capability]);
  const sByAgent = new Map(sessions.rows.map((s) => [s.agent_id, s]));
  const waitingSet = new Set(waiting.rows.map((w) => w.agent));
  return agents.map((a, i) => {
    const s = sByAgent.get(a.id) ?? null;
    const d = deriveStatus(a, s, waitingSet.has(a.id), project);
    const rt = getRuntime(a.runtime);
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      provider: rt?.provider ?? { id: 'unknown', name: a.runtime },
      runtime: a.runtime,
      runtime_label: rt?.runtime ?? a.runtime,
      transport: a.transport,
      capabilities: caps.get(a.id) ?? rt?.capabilities ?? [],
      simulated: project.mode === 'DEMO',
      model: a.model,
      role: a.role,
      role_label: a.role_label,
      description: a.description,
      color: a.color,
      enabled: a.enabled,
      paused: a.paused,
      status: d.status,
      status_reason: d.reason,
      activity: d.status === 'OFFLINE' ? '' : (s?.activity ?? ''),
      last_heartbeat_at: s?.last_heartbeat_at ?? null,
      current_task_id: s?.current_task_id ?? null,
      workspace: s?.workspace ?? {},
      tools: s?.tools ?? [],
      client_version: s?.client_version ?? '',
      permissions: perms[i],
      temporary_grants: grants[i].map((g) => ({ action: g.action, allowed: g.allowed, expires_at: g.expires_at })),
      has_token: Boolean(a.token_hash),
      token_prefix: a.token_prefix,
      office_style: a.config.office_style ?? defaultOfficeStyle(a.role),
      config: publicConfig(a.config),
      sort_order: a.sort_order,
    } satisfies AgentView;
  });
}

export function defaultOfficeStyle(role: string): string {
  if (role === 'PRIMARY_BUILDER') return 'builder';
  if (role === 'AUDITOR_INTEGRATOR') return 'reviewer';
  if (role === 'RESEARCHER') return 'researcher';
  return 'generic';
}

/** Agent config is secret-free by design, but whitelist fields anyway. */
function publicConfig(c: AgentRow['config']) {
  return {
    base_url: c.base_url,
    api_key_env: c.api_key_env,
    temperature: c.temperature,
    max_tokens: c.max_tokens,
    office_style: c.office_style,
    system_prompt_extra: c.system_prompt_extra,
    mcp_tool: c.mcp_tool,
  };
}

/* ───────────────────────────── tasks & messages */
export async function getTask(db: Db, id: string): Promise<TaskRow> {
  const r = await db.query<TaskRow>('select * from tasks where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('task not found');
  return r.rows[0];
}

export async function findTask(db: Db, projectId: string, idOrKey: string): Promise<TaskRow> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const r = await db.query<TaskRow>(
    isUuid ? 'select * from tasks where project_id=$1 and id=$2' : 'select * from tasks where project_id=$1 and key=$2',
    [projectId, isUuid ? idOrKey : idOrKey.toUpperCase()],
  );
  if (!r.rows[0]) throw new NotFound('task not found');
  return r.rows[0];
}

export async function getMessage(db: Db, id: string): Promise<MessageRow> {
  const r = await db.query<MessageRow>('select * from messages where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('message not found');
  return r.rows[0];
}

export async function getApproval(db: Db, id: string): Promise<ApprovalRow> {
  const r = await db.query<ApprovalRow>('select * from approvals where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('approval not found');
  return r.rows[0];
}

export async function generalConversation(db: Db, projectId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select id from conversations where project_id=$1 and kind='general' order by created_at limit 1`,
    [projectId],
  );
  if (r.rows[0]) return r.rows[0].id;
  const c = await db.query<{ id: string }>(
    `insert into conversations (project_id, kind, title) values ($1,'general','Command Room') returning id`,
    [projectId],
  );
  return c.rows[0].id;
}

export function uniq(a: string[] = [], b: string[] = []): string[] {
  return [...new Set([...a, ...b].filter(Boolean))].slice(0, 500);
}
