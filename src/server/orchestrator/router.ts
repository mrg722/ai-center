import type { Db } from '../db';
import type { Actor, AgentRow, DeliveryRow, MessageRow, ProjectRow, TaskRow } from '../types';
import type { MessageType, Priority } from '../../shared/domain';
import { emit } from '../events/bus';
import { BadRequest, generalConversation, getAgent, listAgentRows } from './repo';
import { kickHosted } from './kick';

export type Recipient = { agentId: string } | { all: true } | { moderator: true };

export interface PostMessageInput {
  project: ProjectRow;
  task?: TaskRow | null;
  from: Actor;
  to: Recipient;
  type: MessageType;
  content: string;
  priority?: Priority;
  replyTo?: string | null;
  requiresAction?: boolean;
  requiresApproval?: boolean;
  files?: string[];
  gitBranch?: string | null;
  gitCommit?: string | null;
  meta?: Record<string, unknown>;
  /** false → recorded in the room but not delivered to agent inboxes */
  deliver?: boolean;
}

/**
 * THE router. Every message — human or agent — goes through here:
 * persists it, computes recipients, creates delivery rows (PENDING or HELD),
 * maintains the agent→agent hop counter, and emits realtime events.
 * Agents never call one another: they write messages; the orchestrator
 * decides the delivery.
 */
export async function postMessage(db: Db, i: PostMessageInput): Promise<{ message: MessageRow; deliveries: DeliveryRow[] }> {
  if (!i.content.trim()) throw new BadRequest('message content is empty');
  const conversationId = i.task?.conversation_id ?? (await generalConversation(db, i.project.id));
  const fromAgent = i.from.kind === 'agent' ? i.from.id : null;
  const deliver = i.deliver !== false && i.type !== 'NOTE';

  let recipients: AgentRow[] = [];
  if (deliver) {
    if ('agentId' in i.to) {
      const a = await getAgent(db, i.to.agentId);
      if (a.project_id !== i.project.id) throw new BadRequest('recipient belongs to another project');
      if (a.id !== fromAgent) recipients = [a];
    } else if ('all' in i.to) {
      recipients = (await listAgentRows(db, i.project.id)).filter((a) => a.enabled && a.id !== fromAgent);
    }
  }

  const held = (a: AgentRow) => i.project.halted || a.paused || !a.enabled || Boolean(i.task?.paused);
  const status: MessageRow['status'] = recipients.length
    ? recipients.every(held)
      ? 'HELD'
      : 'SENT'
    : 'DELIVERED'; // to moderator / notes: visible in the room immediately

  const r = await db.query<MessageRow>(
    `insert into messages (project_id, task_id, conversation_id, from_kind, from_agent, from_user, to_agent, to_all,
       message_type, content, reply_to, priority, requires_action, requires_approval, git_branch, git_commit, files, meta, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
    [
      i.project.id,
      i.task?.id ?? null,
      conversationId,
      i.from.kind,
      fromAgent,
      i.from.kind === 'user' ? i.from.id : null,
      'agentId' in i.to ? i.to.agentId : null,
      'all' in i.to,
      i.type,
      i.content.slice(0, 100_000),
      i.replyTo ?? null,
      i.priority ?? 'NORMAL',
      Boolean(i.requiresAction),
      Boolean(i.requiresApproval),
      i.gitBranch ?? null,
      i.gitCommit ?? null,
      (i.files ?? []).slice(0, 200),
      JSON.stringify(i.meta ?? {}),
      status,
    ],
  );
  const message = r.rows[0];

  const deliveries: DeliveryRow[] = [];
  for (const a of recipients) {
    const d = await db.query<DeliveryRow>(
      `insert into deliveries (message_id, agent_id, status) values ($1,$2,$3) returning *`,
      [message.id, a.id, held(a) ? 'HELD' : 'PENDING'],
    );
    deliveries.push(d.rows[0]);
  }

  // hop counter: agent→agent traffic increments; any human message resets it
  if (i.task) {
    if (i.from.kind === 'user') {
      await db.query('update tasks set auto_hops=0 where id=$1', [i.task.id]);
    } else if (i.from.kind === 'agent' && recipients.length) {
      await db.query('update tasks set auto_hops=auto_hops+1 where id=$1', [i.task.id]);
    }
  }

  await emit(db, {
    project_id: i.project.id,
    type: 'message.created',
    actor: i.from,
    task_id: i.task?.id ?? null,
    agent_id: fromAgent,
    payload: {
      message_id: message.id,
      conversation_id: conversationId,
      to: recipients.map((a) => a.slug),
      to_moderator: 'moderator' in i.to,
      message_type: i.type,
      preview: i.content.slice(0, 160),
    },
  });

  // runtimes the orchestrator executes itself (http-api, in-process, or everything in DEMO)
  if (recipients.some((a) => (a.transport !== 'local-bridge' || i.project.mode === 'DEMO') && !held(a))) kickHosted();
  return { message, deliveries };
}

export async function addStep(
  db: Db,
  taskId: string,
  actor: Actor,
  kind: string,
  title: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(`insert into task_steps (task_id, agent_id, user_id, kind, title, detail) values ($1,$2,$3,$4,$5,$6)`, [
    taskId,
    actor.kind === 'agent' ? actor.id : null,
    actor.kind === 'user' ? actor.id : null,
    kind,
    title.slice(0, 300),
    JSON.stringify(detail),
  ]);
}

/**
 * Claims the next delivery for an agent (lease-based, safe across instances).
 * Expired leases (crashed bridge) are re-delivered up to 3 attempts.
 */
export async function claimDeliveries(db: Db, agentId: string, limit = 1): Promise<DeliveryRow[]> {
  await db.query(
    `update deliveries set status='FAILED', error='max delivery attempts reached', completed_at=now()
      where agent_id=$1 and status='DELIVERED' and lease_until < now() and attempts >= 3`,
    [agentId],
  );
  const r = await db.query<DeliveryRow>(
    `update deliveries set status='DELIVERED', delivered_at=now(), attempts=attempts+1,
            lease_until = now() + interval '45 minutes'
      where id in (
        select id from deliveries
         where agent_id=$1 and (status='PENDING' or (status='DELIVERED' and lease_until < now()))
         order by created_at
         limit $2
         for update skip locked)
      returning *`,
    [agentId, limit],
  );
  for (const d of r.rows) {
    await db.query(`update messages set status='DELIVERED' where id=$1 and status in ('SENT','HELD')`, [d.message_id]);
  }
  return r.rows;
}

/** Recomputes a message's status from its deliveries. */
export async function refreshMessageStatus(db: Db, messageId: string): Promise<void> {
  await db.query(
    `update messages m set status = case
        when not exists (select 1 from deliveries d where d.message_id=m.id) then m.status
        when exists (select 1 from deliveries d where d.message_id=m.id and d.status='FAILED') then 'FAILED'
        when not exists (select 1 from deliveries d where d.message_id=m.id and d.status not in ('DONE','CANCELLED','FAILED')) then
          case when exists (select 1 from deliveries d where d.message_id=m.id and d.status='DONE') then 'PROCESSED' else 'CANCELLED' end
        when not exists (select 1 from deliveries d where d.message_id=m.id and d.status <> 'HELD') then 'HELD'
        when exists (select 1 from deliveries d where d.message_id=m.id and d.status='DELIVERED') then 'DELIVERED'
        else 'SENT' end
      where m.id=$1`,
    [messageId],
  );
}

/** Moves queued deliveries between PENDING and HELD according to current flags. */
export async function reconcileHolds(db: Db, projectId: string): Promise<void> {
  // hold: project halted, agent paused/disabled, task paused
  await db.query(
    `update deliveries d set status='HELD'
       from messages m, agents a, projects p
      where d.message_id=m.id and d.agent_id=a.id and p.id=m.project_id and m.project_id=$1
        and d.status='PENDING'
        and (p.halted or a.paused or not a.enabled
             or exists (select 1 from tasks t where t.id=m.task_id and t.paused))`,
    [projectId],
  );
  // release
  await db.query(
    `update deliveries d set status='PENDING'
       from messages m, agents a, projects p
      where d.message_id=m.id and d.agent_id=a.id and p.id=m.project_id and m.project_id=$1
        and d.status='HELD'
        and not p.halted and not a.paused and a.enabled
        and not exists (select 1 from tasks t where t.id=m.task_id and (t.paused or t.status in ('CANCELLED','COMPLETED','REJECTED','FAILED')))`,
    [projectId],
  );
  await db.query(
    `update messages m set status = case when exists (select 1 from deliveries d where d.message_id=m.id and d.status='PENDING') then 'SENT' else m.status end
      where m.project_id=$1 and m.status='HELD'`,
    [projectId],
  );
  await db.query(
    `update messages m set status='HELD'
      where m.project_id=$1 and m.status='SENT'
        and exists (select 1 from deliveries d where d.message_id=m.id)
        and not exists (select 1 from deliveries d where d.message_id=m.id and d.status <> 'HELD')`,
    [projectId],
  );
  kickHosted();
}

/** Cancels queued AND in-flight deliveries (in-flight bridges abort on next heartbeat). */
export async function cancelDeliveries(db: Db, where: { projectId: string; taskId?: string; agentId?: string }): Promise<number> {
  const conds = ['m.project_id=$1', `d.status in ('PENDING','HELD','DELIVERED')`];
  const params: unknown[] = [where.projectId];
  if (where.taskId) {
    params.push(where.taskId);
    conds.push(`m.task_id=$${params.length}`);
  }
  if (where.agentId) {
    params.push(where.agentId);
    conds.push(`d.agent_id=$${params.length}`);
  }
  const r = await db.query<{ message_id: string }>(
    `update deliveries d set status='CANCELLED', error='cancelled by moderator'
       from messages m where d.message_id=m.id and ${conds.join(' and ')} returning d.message_id`,
    params,
  );
  for (const id of new Set(r.rows.map((x) => x.message_id))) await refreshMessageStatus(db, id);
  return r.rowCount;
}

export async function agentSlugMap(db: Db, projectId: string): Promise<Map<string, AgentRow>> {
  return new Map((await listAgentRows(db, projectId)).map((a) => [a.id, a]));
}
