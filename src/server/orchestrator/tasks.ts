import type { Db } from '../db';
import type { Actor, ProjectRow, TaskRow } from '../types';
import type { Priority, TaskStatus } from '../../shared/domain';
import { emit } from '../events/bus';
import { addStep, cancelDeliveries, postMessage, reconcileHolds } from './router';
import { getAgent, getTask, uniq } from './repo';

export interface CreateTaskInput {
  project: ProjectRow;
  actor: Actor;
  title: string;
  description?: string;
  priority?: Priority;
  assignedAgentId?: string | null;
  parentTaskId?: string | null;
  requiresHumanApproval?: boolean;
  /** send a TASK message to the assignee right away */
  start?: boolean;
}

export async function createTask(db: Db, i: CreateTaskInput): Promise<TaskRow> {
  const task = await db.tx(async (tx) => {
    const seq = (
      await tx.query<{ task_seq: number }>('update projects set task_seq = task_seq + 1 where id=$1 returning task_seq', [
        i.project.id,
      ])
    ).rows[0].task_seq;
    const key = `${i.project.key}-${String(seq).padStart(3, '0')}`;
    const conv = await tx.query<{ id: string }>(
      `insert into conversations (project_id, kind, title) values ($1,'task',$2) returning id`,
      [i.project.id, `${key} ${i.title}`.slice(0, 200)],
    );
    const t = await tx.query<TaskRow>(
      `insert into tasks (project_id, key, seq, title, description, priority, status, created_by_user, created_by_agent,
          assigned_agent, conversation_id, parent_task_id, requires_human_approval, current_branch)
       values ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9,$10,$11,$12,$13) returning *`,
      [
        i.project.id,
        key,
        seq,
        i.title.slice(0, 300),
        (i.description ?? '').slice(0, 50_000),
        i.priority ?? 'NORMAL',
        i.actor.kind === 'user' ? i.actor.id : null,
        i.actor.kind === 'agent' ? i.actor.id : null,
        i.assignedAgentId ?? null,
        conv.rows[0].id,
        i.parentTaskId ?? null,
        i.requiresHumanApproval ?? true,
        null,
      ],
    );
    await tx.query('update conversations set task_id=$1 where id=$2', [t.rows[0].id, conv.rows[0].id]);
    await addStep(tx, t.rows[0].id, i.actor, 'created', `Task ${key} created`);
    await emit(tx, { project_id: i.project.id, type: 'task.created', actor: i.actor, task_id: t.rows[0].id, payload: { key } });
    return t.rows[0];
  });

  if (i.assignedAgentId && i.start !== false) {
    const agent = await getAgent(db, i.assignedAgentId);
    await setStatus(db, task, 'PLANNING', i.actor, `assigned to ${agent.name}`);
    await postMessage(db, {
      project: i.project,
      task: { ...task, status: 'PLANNING' },
      from: i.actor,
      to: { agentId: agent.id },
      type: 'TASK',
      content: `${task.key}: ${task.title}${task.description ? `\n\n${task.description}` : ''}`,
      priority: task.priority,
      requiresAction: true,
    });
    await addStep(db, task.id, i.actor, 'assignment', `Assigned to ${agent.name}`, { agent: agent.slug });
  }
  return getTask(db, task.id);
}

export async function setStatus(db: Db, task: TaskRow, status: TaskStatus, actor: Actor, note = ''): Promise<TaskRow> {
  if (task.status === status) return task;
  const terminal = ['COMPLETED', 'CANCELLED', 'FAILED', 'REJECTED', 'APPROVED'].includes(status);
  const r = await db.query<TaskRow>(
    `update tasks set status=$2, completed_at = case when $3 then now() else null end where id=$1 returning *`,
    [task.id, status, terminal],
  );
  await addStep(db, task.id, actor, 'status', `${task.status} → ${status}${note ? ` · ${note}` : ''}`, { from: task.status, to: status });
  await emit(db, {
    project_id: task.project_id,
    type: 'task.updated',
    actor,
    task_id: task.id,
    payload: { key: task.key, status, from: task.status },
  });
  return r.rows[0];
}

export interface TaskPatch {
  title?: string;
  description?: string;
  priority?: Priority;
  context_summary?: string;
  current_branch?: string | null;
  current_commit?: string | null;
  created_files?: string[];
  modified_files?: string[];
  related_commits?: string[];
  requires_human_approval?: boolean;
  next_agent?: string | null;
  assigned_agent?: string | null;
}

export async function patchTask(db: Db, task: TaskRow, patch: TaskPatch, actor: Actor): Promise<TaskRow> {
  const r = await db.query<TaskRow>(
    `update tasks set
        title = coalesce($2, title),
        description = coalesce($3, description),
        priority = coalesce($4, priority),
        context_summary = coalesce($5, context_summary),
        current_branch = coalesce($6, current_branch),
        current_commit = coalesce($7, current_commit),
        created_files = $8,
        modified_files = $9,
        related_commits = $10,
        requires_human_approval = coalesce($11, requires_human_approval),
        next_agent = case when $12 then $13::uuid else next_agent end,
        assigned_agent = case when $14 then $15::uuid else assigned_agent end
      where id=$1 returning *`,
    [
      task.id,
      patch.title?.slice(0, 300) ?? null,
      patch.description?.slice(0, 50_000) ?? null,
      patch.priority ?? null,
      patch.context_summary?.slice(0, 8000) ?? null,
      patch.current_branch ?? null,
      patch.current_commit ?? null,
      uniq(task.created_files, patch.created_files),
      uniq(task.modified_files, patch.modified_files),
      uniq(task.related_commits, patch.related_commits),
      patch.requires_human_approval ?? null,
      patch.next_agent !== undefined,
      patch.next_agent ?? null,
      patch.assigned_agent !== undefined,
      patch.assigned_agent ?? null,
    ],
  );
  await emit(db, { project_id: task.project_id, type: 'task.updated', actor, task_id: task.id, payload: { key: task.key } });
  return r.rows[0];
}

export async function pauseTask(db: Db, task: TaskRow, paused: boolean, actor: Actor): Promise<TaskRow> {
  const r = await db.query<TaskRow>('update tasks set paused=$2 where id=$1 returning *', [task.id, paused]);
  await reconcileHolds(db, task.project_id);
  await addStep(db, task.id, actor, 'control', paused ? 'Task paused' : 'Task resumed');
  await emit(db, { project_id: task.project_id, type: 'task.updated', actor, task_id: task.id, payload: { key: task.key, paused } });
  return r.rows[0];
}

/** Cancel a task and (optionally) its whole sub-task chain; aborts in-flight runs. */
export async function cancelTask(db: Db, task: TaskRow, actor: Actor, chain = true): Promise<number> {
  const ids = [task.id];
  if (chain) {
    const r = await db.query<{ id: string }>(
      `with recursive tree as (select id from tasks where id=$1 union all select t.id from tasks t join tree on t.parent_task_id=tree.id)
       select id from tree`,
      [task.id],
    );
    ids.splice(0, ids.length, ...r.rows.map((x) => x.id));
  }
  let n = 0;
  for (const id of ids) {
    const t = await getTask(db, id);
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) continue;
    n += await cancelDeliveries(db, { projectId: t.project_id, taskId: t.id });
    await db.query(`update approvals set status='CANCELLED', decided_at=now() where task_id=$1 and status='PENDING'`, [t.id]);
    await setStatus(db, t, 'CANCELLED', actor, id === task.id ? 'cancelled' : `parent ${task.key} cancelled`);
  }
  return n;
}
