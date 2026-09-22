import type { Db } from '../db';
import type { AgentRow, SessionRow } from '../types';
import type { HelloRequest, HelloResponse, HeartbeatRequest, HeartbeatResponse, InboxResponse, WorkspaceState } from '../../shared/protocol';
import { HEARTBEAT_INTERVAL_S, HEARTBEAT_TIMEOUT_S } from '../../shared/domain';
import { getRuntime } from '../providers/registry';
import { emit, emitEphemeral, subscribe } from '../events/bus';
import { agentActor, executeAgentAction } from './actions';
import { effectivePermissions, getProjectById, getTask, BadRequest } from './repo';
import { addStep, claimDeliveries, postMessage } from './router';
import { patchTask } from './tasks';
import { toInboxItems } from './runs';

/* Server side of the Agent Bridge protocol (see src/shared/protocol.ts). */

export async function bridgeHello(db: Db, agent: AgentRow, req: HelloRequest): Promise<HelloResponse> {
  if (agent.transport !== 'local-bridge') throw new BadRequest('This agent does not use the local-bridge transport.');
  const project = await getProjectById(db, agent.project_id);
  // one live session per agent: close previous ones, but preserve the provider
  // conversation/session id so reconnects can resume the same AI thread.
  const previous = await db.query<{ provider_session_id: string | null }>(
    `select provider_session_id from agent_sessions where agent_id=$1 and provider_session_id is not null order by last_heartbeat_at desc limit 1`,
    [agent.id],
  );
  const providerSessionId = previous.rows[0]?.provider_session_id ?? null;
  await db.query(`update agent_sessions set ended_at=now() where agent_id=$1 and ended_at is null`, [agent.id]);
  const s = await db.query<SessionRow>(
    `insert into agent_sessions (agent_id, status, provider_session_id, workspace, tools, client_version) values ($1,'ONLINE',$2,$3,$4,$5) returning *`,
    [agent.id, providerSessionId, JSON.stringify(req.workspace ?? {}), JSON.stringify(req.tools ?? []), `${req.client_version} · ${req.runner}`.slice(0, 200)],
  );
  await emit(db, {
    project_id: project.id,
    type: 'agent.connected',
    actor: agentActor(agent),
    agent_id: agent.id,
    payload: { runner: req.runner, client: req.client_version, branch: req.workspace?.branch ?? null },
  });
  return {
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      role: agent.role,
      role_label: agent.role_label,
      runtime: agent.runtime,
      provider: getRuntime(agent.runtime)?.provider.id ?? 'unknown',
      model: agent.model,
      permissions: await effectivePermissions(db, agent.id),
    },
    session_id: s.rows[0].id,
    provider_session_id: s.rows[0].provider_session_id,
    heartbeat_interval_s: HEARTBEAT_INTERVAL_S,
    mode: project.mode,
    halted: project.halted,
    tool_servers: (project.settings.tool_servers ?? []).filter((t) => t.enabled),
    project: {
      key: project.key,
      name: project.name,
      repo: project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : null,
      default_branch: project.default_branch,
    },
  };
}

export async function bridgeHeartbeat(db: Db, agent: AgentRow, req: HeartbeatRequest): Promise<HeartbeatResponse> {
  const project = await getProjectById(db, agent.project_id);
  const prev = await db.query<SessionRow>('select * from agent_sessions where id=$1 and agent_id=$2', [req.session_id, agent.id]);
  if (!prev.rows[0]) throw Object.assign(new Error('unknown session; call hello again'), { status: 409 });
  const before = prev.rows[0];
  await db.query(
    `update agent_sessions set last_heartbeat_at=now(), ended_at=null, status=$3, activity=$4, current_task_id=$5,
        workspace = coalesce($6::jsonb, workspace)
      where id=$1 and agent_id=$2`,
    [req.session_id, agent.id, req.status, (req.activity ?? '').slice(0, 200), req.current_task_id ?? null, req.workspace ? JSON.stringify(req.workspace) : null],
  );
  if (before.ended_at || before.status !== req.status || before.current_task_id !== (req.current_task_id ?? null)) {
    await emit(db, {
      project_id: project.id,
      type: 'agent.status',
      actor: agentActor(agent),
      agent_id: agent.id,
      task_id: req.current_task_id ?? null,
      payload: { status: req.status, activity: req.activity ?? '' },
    });
  } else {
    emitEphemeral({ project_id: project.id, type: 'agent.presence', actor_kind: 'agent', actor_id: agent.id, task_id: req.current_task_id ?? null, agent_id: agent.id, payload: { status: req.status, activity: req.activity ?? '' } });
  }
  if (req.workspace?.branch && req.workspace.branch !== before.workspace?.branch) {
    await emit(db, { project_id: project.id, type: 'git.updated', actor: agentActor(agent), agent_id: agent.id, payload: { branch: req.workspace.branch, commit: req.workspace.commit } });
  }
  const cancel = await db.query<{ id: string }>(
    `select id from deliveries where agent_id=$1 and status='CANCELLED' and delivered_at is not null and completed_at is null`,
    [agent.id],
  );
  return {
    halted: project.halted,
    paused: agent.paused,
    mode: project.mode,
    cancel_delivery_ids: cancel.rows.map((r) => r.id),
    permissions: await effectivePermissions(db, agent.id),
  };
}

/** Long-poll: waits up to `waitS` for a delivery; wakes early on bus events. */
export async function bridgeInbox(db: Db, agent: AgentRow, waitS: number, signal: AbortSignal): Promise<InboxResponse> {
  const deadline = Date.now() + Math.min(Math.max(waitS, 0), 25) * 1000;
  let wake: (() => void) | null = null;
  const unsub = subscribe((e) => {
    if (e.type === 'message.created' || e.type === 'project.updated' || e.type === 'agent.updated') wake?.();
  });
  try {
    for (;;) {
      const project = await getProjectById(db, agent.project_id);
      const fresh = await db.query<AgentRow>('select * from agents where id=$1', [agent.id]);
      const a = fresh.rows[0];
      // in DEMO mode the simulator answers for every agent; real bridges stay idle
      if (!project.halted && project.mode !== 'DEMO' && a?.enabled && !a.paused) {
        const claimed = await claimDeliveries(db, agent.id, 1);
        if (claimed.length) return { items: await toInboxItems(db, project, a, claimed), halted: false };
      }
      if (Date.now() >= deadline || signal.aborted) return { items: [], halted: project.halted };
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      wake = null;
    }
  } finally {
    unsub();
  }
}

export async function bridgeActivity(agent: AgentRow, kind: string, text: string, taskId: string | null) {
  // ephemeral: shown live in the UI, never persisted
  emitEphemeral({
    project_id: agent.project_id,
    type: 'agent.activity',
    actor_kind: 'agent',
    actor_id: agent.id,
    agent_id: agent.id,
    task_id: taskId,
    payload: { kind, text: text.slice(0, 500) },
  });
}

export async function bridgeCommandResult(
  db: Db,
  agent: AgentRow,
  r: { approval_id?: string; task_id: string; command: string; ok: boolean; output: string; commit?: string; branch?: string },
) {
  const task = await getTask(db, r.task_id);
  if (task.project_id !== agent.project_id) throw new BadRequest('task belongs to another project');
  const project = await getProjectById(db, agent.project_id);
  const actor = agentActor(agent);
  if (r.ok && r.command === 'git_commit' && r.commit) {
    await patchTask(db, task, { current_commit: r.commit, current_branch: r.branch ?? undefined, related_commits: [r.commit] }, actor);
    await db.query(
      `insert into git_refs (project_id, task_id, kind, ref, title, author_agent) values ($1,$2,'commit',$3,$4,$5) on conflict do nothing`,
      [project.id, task.id, r.commit, r.output.split('\n')[0].slice(0, 200), agent.id],
    );
  }
  if (r.ok && r.command === 'git_push' && r.branch) {
    await patchTask(db, task, { current_branch: r.branch }, actor);
    await db.query(
      `insert into git_refs (project_id, task_id, kind, ref, title, author_agent) values ($1,$2,'branch',$3,'pushed',$4) on conflict do nothing`,
      [project.id, task.id, r.branch, agent.id],
    );
  }
  if (r.approval_id) {
    await db.query(`update approvals set payload = payload || $2::jsonb where id=$1`, [
      r.approval_id,
      JSON.stringify({ result: { ok: r.ok, output: r.output.slice(0, 2000) } }),
    ]);
  }
  const label = r.command === 'git_commit' ? `Commit ${r.commit?.slice(0, 10) ?? ''}` : `Push ${r.branch ?? ''}`;
  await postMessage(db, {
    project,
    task,
    from: actor,
    to: { moderator: true },
    type: r.ok ? 'STATUS' : 'ERROR',
    content: `${label} ${r.ok ? 'succeeded' : 'FAILED'}\n\n${r.output.slice(0, 3000)}`,
    gitCommit: r.commit ?? null,
    gitBranch: r.branch ?? null,
  });
  await addStep(db, task.id, actor, 'git', `${label} ${r.ok ? 'ok' : 'failed'}`, { output: r.output.slice(0, 500) });
  await emit(db, { project_id: project.id, type: 'git.updated', actor, task_id: task.id, agent_id: agent.id, payload: { command: r.command, ok: r.ok } });
}

export async function updateWorkspace(db: Db, agent: AgentRow, ws: WorkspaceState | undefined) {
  if (!ws) return;
  await db.query(`update agent_sessions set workspace=$2 where agent_id=$1 and ended_at is null`, [agent.id, JSON.stringify(ws)]);
}

export { executeAgentAction };

/**
 * Presence sweeper. AgentState changes that come from the PASSAGE OF TIME
 * (a bridge stopped heartbeating, a hosted run crashed mid-way) are turned
 * into explicit events here, so the UI never has to poll or guess.
 * Called from the SSE loop, the cron tick and the in-process worker.
 */
export async function sweepPresence(db: Db, projectId?: string): Promise<number> {
  const scope = projectId ? 'and a.project_id = $1' : '';
  const params = projectId ? [projectId] : [];
  const lost = await db.query<{ agent_id: string; project_id: string }>(
    `update agent_sessions s set ended_at = now()
       from agents a
      where s.agent_id = a.id ${scope} and s.ended_at is null and a.transport = 'local-bridge'
        and s.last_heartbeat_at < now() - interval '${HEARTBEAT_TIMEOUT_S} seconds'
      returning s.agent_id, a.project_id`,
    params,
  );
  const stale = await db.query<{ agent_id: string; project_id: string }>(
    `update agent_sessions s set status = 'ONLINE', activity = ''
       from agents a
      where s.agent_id = a.id ${scope} and s.ended_at is null and a.transport <> 'local-bridge'
        and s.status <> 'ONLINE' and s.last_heartbeat_at < now() - interval '200 seconds'
      returning s.agent_id, a.project_id`,
    params,
  );
  for (const r of lost.rows) {
    await emit(db, { project_id: r.project_id, type: 'agent.offline', actor: { kind: 'system' }, agent_id: r.agent_id, payload: { reason: 'heartbeat timeout' } });
  }
  for (const r of stale.rows) {
    await emit(db, { project_id: r.project_id, type: 'agent.status', actor: { kind: 'system' }, agent_id: r.agent_id, payload: { status: 'ONLINE', reason: 'run timed out' } });
  }
  return lost.rowCount + stale.rowCount;
}
