import type { Db } from '../db';
import type { Actor, AgentRow, ApprovalRow, ProjectRow, TaskRow } from '../types';
import type { Mode, PermissionAction, TaskStatus } from '../../shared/domain';
import type { AgentAction } from '../../shared/protocol';
import { emit } from '../events/bus';
import { newAgentToken } from '../security/crypto';
import { BadRequest, Conflict, getAgent, getApproval, getTask, listAgentRows } from './repo';
import { addStep, cancelDeliveries, postMessage, reconcileHolds } from './router';
import { cancelTask, patchTask, pauseTask, setStatus } from './tasks';
import { executeAgentAction } from './actions';
import { validateAgentAction } from '../validation';

/* Everything the human moderator can do. The moderator always wins:
 * these operations bypass agent policy (but are logged as events). */

export async function stopAll(db: Db, project: ProjectRow, actor: Extract<Actor, { kind: 'user' }>, reason: string) {
  await db.query(`update projects set halted=true, halted_at=now(), halted_by=$2 where id=$1`, [project.id, actor.id]);
  // queued work is held, in-flight work is cancelled (bridges abort on next heartbeat)
  await reconcileHolds(db, project.id);
  const cancelled = await db.query<{ message_id: string }>(
    `update deliveries d set status='CANCELLED', error='STOP ALL'
       from messages m where d.message_id=m.id and m.project_id=$1 and d.status='DELIVERED' returning d.message_id`,
    [project.id],
  );
  await postMessage(db, {
    project: { ...project, halted: true },
    from: actor,
    to: { moderator: true },
    type: 'WARNING',
    content: `⏹ STOP ALL by ${actor.name}${reason ? `: ${reason}` : ''}. ${cancelled.rowCount} running job(s) cancelled; queued work is held.`,
  });
  await emit(db, { project_id: project.id, type: 'system.halted', actor, payload: { reason, cancelled: cancelled.rowCount } });
}

export async function resumeAll(db: Db, project: ProjectRow, actor: Extract<Actor, { kind: 'user' }>) {
  await db.query(`update projects set halted=false, halted_at=null, halted_by=null where id=$1`, [project.id]);
  await reconcileHolds(db, project.id);
  await postMessage(db, { project: { ...project, halted: false }, from: actor, to: { moderator: true }, type: 'STATUS', content: `▶ System resumed by ${actor.name}.` });
  await emit(db, { project_id: project.id, type: 'system.resumed', actor, payload: {} });
}

export async function setMode(db: Db, project: ProjectRow, actor: Actor, mode: Mode) {
  await db.query(`update projects set mode=$2 where id=$1`, [project.id, mode]);
  await emit(db, { project_id: project.id, type: 'project.updated', actor, payload: { mode } });
  await postMessage(db, { project, from: actor, to: { moderator: true }, type: 'STATUS', content: `Mode changed to ${mode}.` });
}

/* ───────────────────────────── agents */
export async function setAgentPaused(db: Db, agent: AgentRow, paused: boolean, actor: Actor) {
  await db.query(`update agents set paused=$2 where id=$1`, [agent.id, paused]);
  await reconcileHolds(db, agent.project_id);
  await emit(db, { project_id: agent.project_id, type: 'agent.updated', actor, agent_id: agent.id, payload: { paused } });
}

export async function cancelAgentRun(db: Db, agent: AgentRow, actor: Actor) {
  const n = await db.query(
    `update deliveries set status='CANCELLED', error='cancelled by moderator' where agent_id=$1 and status='DELIVERED'`,
    [agent.id],
  );
  await emit(db, { project_id: agent.project_id, type: 'agent.updated', actor, agent_id: agent.id, payload: { cancelled: n.rowCount } });
  return n.rowCount;
}

export async function issueToken(db: Db, agent: AgentRow, actor: Actor): Promise<string> {
  if (agent.transport !== 'local-bridge') throw new BadRequest('Only local-bridge agents use tokens.');
  const t = newAgentToken(agent.slug);
  await db.query(`update agents set token_hash=$2, token_prefix=$3, token_created_at=now() where id=$1`, [agent.id, t.hash, t.prefix]);
  await db.query(`update agent_sessions set ended_at=now() where agent_id=$1 and ended_at is null`, [agent.id]);
  await emit(db, { project_id: agent.project_id, type: 'agent.updated', actor, agent_id: agent.id, payload: { token: 'rotated' } });
  return t.token; // shown ONCE to the moderator, never stored in clear
}

export async function revokeToken(db: Db, agent: AgentRow, actor: Actor) {
  await db.query(`update agents set token_hash=null, token_prefix=null, token_created_at=null where id=$1`, [agent.id]);
  await db.query(`update agent_sessions set ended_at=now() where agent_id=$1 and ended_at is null`, [agent.id]);
  await emit(db, { project_id: agent.project_id, type: 'agent.updated', actor, agent_id: agent.id, payload: { token: 'revoked' } });
}

export async function setPermission(
  db: Db,
  agent: AgentRow,
  actor: Extract<Actor, { kind: 'user' }>,
  p: { action: PermissionAction; allowed: boolean; temporaryMinutes?: number; reason: string },
) {
  if (p.temporaryMinutes) {
    await db.query(
      `insert into permissions (agent_id, action, allowed, scope, expires_at, granted_by, reason)
       values ($1,$2,$3,'temporary', now() + ($4 || ' minutes')::interval, $5, $6)`,
      [agent.id, p.action, p.allowed, String(p.temporaryMinutes), actor.id, p.reason],
    );
  } else {
    await db.query(`update permissions set revoked_at=now() where agent_id=$1 and action=$2 and scope='base' and revoked_at is null`, [agent.id, p.action]);
    await db.query(`insert into permissions (agent_id, action, allowed, scope, granted_by, reason) values ($1,$2,$3,'base',$4,$5)`, [
      agent.id,
      p.action,
      p.allowed,
      actor.id,
      p.reason,
    ]);
  }
  await emit(db, {
    project_id: agent.project_id,
    type: 'permission.changed',
    actor,
    agent_id: agent.id,
    payload: { action: p.action, allowed: p.allowed, temporary_minutes: p.temporaryMinutes ?? null },
  });
}

export async function revokeTemporary(db: Db, agent: AgentRow, actor: Actor, action: PermissionAction) {
  await db.query(`update permissions set revoked_at=now() where agent_id=$1 and action=$2 and scope='temporary' and revoked_at is null`, [agent.id, action]);
  await emit(db, { project_id: agent.project_id, type: 'permission.changed', actor, agent_id: agent.id, payload: { action, revoked: true } });
}

/* ───────────────────────────── tasks */
export async function assignTask(db: Db, project: ProjectRow, task: TaskRow, agent: AgentRow, actor: Actor, note?: string) {
  const prev = task.assigned_agent;
  await patchTask(db, task, { assigned_agent: agent.id, next_agent: null }, actor);
  const t = await setStatus(db, await getTask(db, task.id), 'PLANNING', actor, `${prev ? 're' : ''}assigned to ${agent.name}`);
  await postMessage(db, {
    project,
    task: t,
    from: actor,
    to: { agentId: agent.id },
    type: prev ? 'HANDOFF' : 'TASK',
    content: note?.trim() || `${task.key}: ${task.title}${task.description ? `\n\n${task.description}` : ''}`,
    requiresAction: true,
    priority: task.priority,
  });
  await addStep(db, task.id, actor, 'assignment', `${prev ? 'Reassigned' : 'Assigned'} to ${agent.name}`, { agent: agent.slug });
}

export async function moderatorSetStatus(db: Db, task: TaskRow, status: TaskStatus, actor: Actor, note?: string) {
  if (['CANCELLED'].includes(status)) return cancelTask(db, task, actor, false);
  const t = await setStatus(db, task, status, actor, note);
  if (['COMPLETED', 'APPROVED', 'REJECTED', 'FAILED'].includes(status)) {
    await cancelDeliveries(db, { projectId: task.project_id, taskId: task.id });
  }
  if (['OPEN', 'IN_PROGRESS', 'PLANNING'].includes(status)) await reconcileHolds(db, task.project_id);
  return t;
}

export async function approveTask(db: Db, project: ProjectRow, task: TaskRow, actor: Actor, approve: boolean, note = '') {
  await setStatus(db, task, approve ? 'APPROVED' : 'REJECTED', actor, note);
  await postMessage(db, {
    project,
    task,
    from: actor,
    to: task.assigned_agent ? { agentId: task.assigned_agent } : { moderator: true },
    type: approve ? 'STATUS' : 'WARNING',
    content: `Moderator ${approve ? 'APPROVED' : 'REJECTED'} ${task.key}${note ? `: ${note}` : '.'}`,
    deliver: !approve && Boolean(task.assigned_agent) ? true : false,
  });
}

export { pauseTask, cancelTask };

/* ───────────────────────────── approvals */
export async function decideApproval(
  db: Db,
  project: ProjectRow,
  approval: ApprovalRow,
  actor: Extract<Actor, { kind: 'user' }>,
  approve: boolean,
  note: string,
): Promise<{ result?: unknown }> {
  const upd = await db.query<ApprovalRow>(
    `update approvals set status=$2, decided_by=$3, decided_at=now(), decision_note=$4 where id=$1 and status='PENDING' returning *`,
    [approval.id, approve ? 'APPROVED' : 'REJECTED', actor.id, note.slice(0, 2000)],
  );
  if (!upd.rows[0]) throw new Conflict('approval already decided');
  const task = approval.task_id ? await getTask(db, approval.task_id) : null;
  const agentId = (approval.payload.agent_id as string | undefined) ?? approval.requested_by_agent;
  const agent = agentId ? await getAgent(db, agentId) : null;
  let result: unknown;

  await emit(db, {
    project_id: project.id,
    type: 'approval.decided',
    actor,
    task_id: task?.id ?? null,
    agent_id: agent?.id ?? null,
    payload: { approval_id: approval.id, decision: approve ? 'APPROVED' : 'REJECTED', action: approval.action },
  });
  if (task) await addStep(db, task.id, actor, 'approval', `${approve ? 'Approved' : 'Rejected'}: ${approval.title}`, { note });

  if (approve && approval.action === 'continue_chain' && task) {
    await db.query('update tasks set auto_hops=0 where id=$1', [task.id]);
  }

  const stored = approval.payload.agent_action;
  if (approve && stored && agent) {
    const v = validateAgentAction(stored);
    if (!v.ok) throw new BadRequest(`stored action invalid: ${v.error}`);
    if (task && ['WAITING_USER'].includes(task.status)) await setStatus(db, task, 'IN_PROGRESS', actor, 'approval granted');
    result = await executeAgentAction(db, agent, v.action as AgentAction, { approvedBy: { approvalId: approval.id, userId: actor.id } });
  } else if (agent && !approval.payload.informational) {
    // tell the requesting agent what happened (it may be waiting)
    await postMessage(db, {
      project,
      task,
      from: actor,
      to: { agentId: agent.id },
      type: approve ? 'ANSWER' : 'WARNING',
      content: `Moderator ${approve ? 'approved' : 'REJECTED'}: ${approval.title}${note ? `\nNote: ${note}` : ''}`,
      deliver: !approve,
    });
  } else if (agent) {
    await postMessage(db, {
      project,
      task,
      from: actor,
      to: { agentId: agent.id },
      type: 'ANSWER',
      content: `Moderator ${approve ? 'approved' : 'rejected'}: ${approval.title}${note ? `\nNote: ${note}` : ''}`,
    });
  }
  if (!approve && task && task.status === 'WAITING_USER') {
    // leave the task waiting for the moderator's next instruction
  }
  return { result };
}

export async function getApprovalForProject(db: Db, project: ProjectRow, id: string) {
  const a = await getApproval(db, id);
  if (a.project_id !== project.id) throw new BadRequest('approval belongs to another project');
  return a;
}

/* ───────────────────────────── agent CRUD */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, Record<PermissionAction, boolean>> = {
  PRIMARY_BUILDER: { read: true, write: true, commit: true, push: false, merge: false, dangerous_operations: false, handoff: true, create_task: true, pr_create: false, deploy: false, paid_api: true },
  AUDITOR_INTEGRATOR: { read: true, write: true, commit: true, push: true, merge: false, dangerous_operations: false, handoff: true, create_task: true, pr_create: true, deploy: false, paid_api: true },
  RESEARCHER: { read: true, write: false, commit: false, push: false, merge: false, dangerous_operations: false, handoff: true, create_task: false, pr_create: false, deploy: false, paid_api: true },
  GENERIC: { read: true, write: false, commit: false, push: false, merge: false, dangerous_operations: false, handoff: true, create_task: false, pr_create: false, deploy: false, paid_api: true },
};

export async function seedPermissions(db: Db, agentId: string, role: string, userId: string | null) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.GENERIC;
  for (const [action, allowed] of Object.entries(defaults)) {
    await db.query(`insert into permissions (agent_id, action, allowed, scope, granted_by, reason) values ($1,$2,$3,'base',$4,'role default')`, [
      agentId,
      action,
      allowed,
      userId,
    ]);
  }
}

export async function nextSortOrder(db: Db, projectId: string) {
  const agents = await listAgentRows(db, projectId);
  return agents.length ? Math.max(...agents.map((a) => a.sort_order)) + 1 : 0;
}
