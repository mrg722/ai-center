import type { Db } from '../db';
import type { AgentRow, DeliveryRow, MessageRow, ProjectRow, TaskRow } from '../types';
import type { InboxItem } from '../../shared/protocol';
import { emit } from '../events/bus';
import { addStep, postMessage, refreshMessageStatus } from './router';
import { agentViews, getMessage, getProjectById, getTask } from './repo';
import { setStatus } from './tasks';
import { agentActor, authorize } from './actions';
import { buildContext, toWireMessage, toWireTask } from './context';

/** Turns claimed deliveries into inbox items with a budgeted context package. */
export async function toInboxItems(db: Db, project: ProjectRow, agent: AgentRow, deliveries: DeliveryRow[]): Promise<InboxItem[]> {
  const names = new Map((await agentViews(db, project)).map((v) => [v.id, v.slug]));
  const items: InboxItem[] = [];
  for (const d of deliveries) {
    const message = await getMessage(db, d.message_id);
    let task = message.task_id ? await getTask(db, message.task_id) : null;
    // Policy gate before anything runs on a user's machine (COMMANDs were already authorised)
    if (agent.transport === 'local-bridge' && project.mode !== 'DEMO' && message.message_type !== 'COMMAND') {
      const gate = await authorize(db, project, agent, 'local_run', task);
      if (gate.kind !== 'allow') {
        await completeDelivery(db, agent, d.id, { status: 'FAILED', error: `Policy: ${gate.kind === 'deny' ? gate.reason : 'requires approval'}` });
        continue;
      }
    }
    if (task && ['TASK', 'HANDOFF', 'REQUEST'].includes(message.message_type) && ['OPEN', 'PLANNING', 'WAITING_AGENT', 'WAITING_USER'].includes(task.status)) {
      task = await setStatus(db, task, 'IN_PROGRESS', agentActor(agent), `${agent.name} started`);
    }
    await db.query(
      `insert into agent_runs (agent_id, task_id, delivery_id, status) values ($1,$2,$3,'RUNNING')`,
      [agent.id, task?.id ?? null, d.id],
    );
    await emit(db, {
      project_id: project.id,
      type: 'run.started',
      actor: agentActor(agent),
      task_id: task?.id ?? null,
      agent_id: agent.id,
      payload: { message_id: message.id, message_type: message.message_type },
    });
    const context =
      message.message_type === 'COMMAND'
        ? { prompt: '', chars: 0, sections: [] }
        : await buildContext(db, { project, agent, task, incoming: message });
    items.push({ delivery_id: d.id, message: toWireMessage(message, names), task: task ? toWireTask(task, names) : null, context });
  }
  return items;
}

export interface CompleteInput {
  status: 'DONE' | 'FAILED';
  resultText?: string;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  outputChars?: number;
  summary?: string;
  providerSessionId?: string;
}

/** Shared completion path for bridge acks and hosted runs. */
export async function completeDelivery(db: Db, agent: AgentRow, deliveryId: string, c: CompleteInput): Promise<void> {
  const dr = await db.query<DeliveryRow>('select * from deliveries where id=$1 and agent_id=$2', [deliveryId, agent.id]);
  const d = dr.rows[0];
  if (!d) throw Object.assign(new Error('delivery not found for this agent'), { status: 404 });
  if (d.completed_at) return; // idempotent
  const message: MessageRow = await getMessage(db, d.message_id);
  const project = await getProjectById(db, message.project_id);
  let task: TaskRow | null = message.task_id ? await getTask(db, message.task_id) : null;
  const actor = agentActor(agent);
  const cancelled = d.status === 'CANCELLED';

  await db.query(`update deliveries set status=$2, completed_at=now(), error=$3 where id=$1`, [
    d.id,
    cancelled ? 'CANCELLED' : c.status,
    c.error?.slice(0, 4000) ?? null,
  ]);
  await db.query(
    `update agent_runs set status=$2, finished_at=now(), duration_ms = (extract(epoch from (now()-started_at))*1000)::int,
        output_chars=$3, tokens_in=$4, tokens_out=$5, error=$6, summary=$7
      where delivery_id=$1 and status='RUNNING'`,
    [
      d.id,
      cancelled ? 'CANCELLED' : c.status === 'DONE' ? 'SUCCEEDED' : 'FAILED',
      c.outputChars ?? c.resultText?.length ?? null,
      c.tokensIn ?? null,
      c.tokensOut ?? null,
      c.error?.slice(0, 2000) ?? null,
      (c.summary ?? '').slice(0, 300),
    ],
  );
  if (c.providerSessionId) {
    await db.query(`update agent_sessions set provider_session_id=$2 where agent_id=$1 and ended_at is null`, [agent.id, c.providerSessionId.slice(0, 500)]);
  }
  await refreshMessageStatus(db, message.id);

  if (message.message_type !== 'COMMAND') {
    if (cancelled) {
      await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'STATUS', content: 'Run cancelled.', replyTo: message.id });
    } else if (c.status === 'DONE' && c.resultText?.trim()) {
      // Results go to the room (moderator), never auto-delivered to another agent → no ping-pong loops.
      await postMessage(db, {
        project,
        task,
        from: actor,
        to: { moderator: true },
        type: 'RESULT',
        content: c.resultText,
        replyTo: message.id,
      });
    } else if (c.status === 'FAILED') {
      await postMessage(db, {
        project,
        task,
        from: actor,
        to: { moderator: true },
        type: 'ERROR',
        content: `Run failed: ${c.error ?? 'unknown error'}`,
        replyTo: message.id,
      });
    }
  }

  if (task && !cancelled && message.message_type !== 'COMMAND') {
    task = await getTask(db, task.id);
    const stillOpen = await db.query<{ n: number }>(
      `select count(*)::int as n from deliveries d join messages m on m.id=d.message_id
        where m.task_id=$1 and d.status in ('PENDING','DELIVERED','HELD')`,
      [task.id],
    );
    if (c.status === 'FAILED' && !['COMPLETED', 'CANCELLED'].includes(task.status)) {
      await setStatus(db, task, 'WAITING_USER', actor, 'agent run failed');
    } else if (stillOpen.rows[0].n === 0 && ['IN_PROGRESS', 'PLANNING', 'WAITING_AGENT'].includes(task.status)) {
      await setStatus(db, task, 'WAITING_USER', actor, `${agent.name} finished its turn`);
    }
    await addStep(db, task.id, actor, 'run', `${agent.name} run ${cancelled ? 'cancelled' : c.status === 'DONE' ? 'finished' : 'failed'}`, {
      tokens_in: c.tokensIn,
      tokens_out: c.tokensOut,
    });
  }

  await emit(db, {
    project_id: project.id,
    type: 'run.finished',
    actor,
    task_id: task?.id ?? null,
    agent_id: agent.id,
    payload: { status: cancelled ? 'CANCELLED' : c.status, message_type: message.message_type },
  });
}
