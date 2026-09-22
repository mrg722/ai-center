import type { Db } from '../db';
import type { ApprovalRow, MessageRow, ProjectRow, TaskRow } from '../types';
import { agentViews } from './repo';
import type { SystemState } from '../../shared/domain';
import type { AgentView } from '../types';

/* Read models for the UI. Everything the browser receives comes from here
 * (or from the event stream) — never raw rows with secrets. */

export interface TaskSummary {
  id: string;
  key: string;
  title: string;
  status: TaskRow['status'];
  priority: TaskRow['priority'];
  assigned_agent: string | null;
  next_agent: string | null;
  parent_task_id: string | null;
  paused: boolean;
  requires_human_approval: boolean;
  current_branch: string | null;
  current_commit: string | null;
  conversation_id: string;
  updated_at: string;
  created_at: string;
  message_count: number;
}

export async function snapshot(db: Db, project: ProjectRow) {
  const [agents, tasks, approvals, events, lastEvent, counts, generalConv] = await Promise.all([
    agentViews(db, project),
    db.query<TaskSummary>(
      `select t.id, t.key, t.title, t.status, t.priority, t.assigned_agent, t.next_agent, t.parent_task_id, t.paused,
              t.requires_human_approval, t.current_branch, t.current_commit, t.conversation_id, t.updated_at, t.created_at,
              (select count(*)::int from messages m where m.task_id=t.id) as message_count
         from tasks t where t.project_id=$1
        order by (t.status in ('COMPLETED','CANCELLED','APPROVED','REJECTED','FAILED')), t.updated_at desc
        limit 60`,
      [project.id],
    ),
    db.query<ApprovalRow>(`select * from approvals where project_id=$1 and status='PENDING' order by created_at desc limit 50`, [project.id]),
    db.query<{ id: number; type: string; actor_kind: string; actor_id: string | null; task_id: string | null; agent_id: string | null; payload: Record<string, unknown>; created_at: string }>(
      `select * from events where project_id=$1 order by id desc limit 40`,
      [project.id],
    ),
    db.query<{ id: number }>(`select coalesce(max(id),0)::bigint as id from events where project_id=$1`, [project.id]),
    db.query<{ status: string; n: number }>(`select status, count(*)::int as n from tasks where project_id=$1 group by status`, [project.id]),
    db.query<{ id: string }>(`select id from conversations where project_id=$1 and kind='general' order by created_at limit 1`, [project.id]),
  ]);
  const taskCounts = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  return {
    system: systemState(project, agents, approvals.rowCount),
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      repo: project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : null,
      default_branch: project.default_branch,
      mode: project.mode,
      halted: project.halted,
      halted_at: project.halted_at,
      max_auto_hops: project.max_auto_hops,
      default_reviewer: project.settings.default_reviewer ?? null,
      tool_servers: project.settings.tool_servers ?? [],
      daily_token_budget: project.settings.daily_token_budget ?? null,
      deploy_workflow: project.settings.deploy_workflow ?? null,
    },
    general_conversation_id: generalConv.rows[0]?.id ?? null,
    agents,
    tasks: tasks.rows,
    approvals: approvals.rows.map((a) => ({
      id: a.id,
      task_id: a.task_id,
      requested_by_agent: a.requested_by_agent,
      action: a.action,
      title: a.title,
      detail: a.detail,
      created_at: a.created_at,
    })),
    events: events.rows,
    last_event_id: Number(lastEvent.rows[0]?.id ?? 0),
    task_counts: taskCounts,
    server_time: new Date().toISOString(),
  };
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/**
 * Global system state — derived here, once, from AgentState + approvals +
 * halt flag. The UI renders it; it never recomputes it.
 */
export function systemState(project: ProjectRow, agents: AgentView[], pendingApprovals: number): { state: SystemState; detail: string } {
  if (project.halted) return { state: 'HALTED', detail: 'STOP ALL active' };
  if (pendingApprovals > 0) return { state: 'NEEDS_YOU', detail: `${pendingApprovals} approval(s) pending` };
  if (project.mode === 'DEMO') return { state: 'DEMO', detail: 'simulated agents' };
  const active = agents.filter((a) => ['WORKING', 'THINKING', 'REVIEWING'].includes(a.status)).length;
  if (active) return { state: 'ACTIVE', detail: `${active} agent(s) working` };
  if (agents.some((a) => a.status !== 'OFFLINE')) return { state: 'IDLE', detail: 'agents online, nothing running' };
  return { state: 'NO_AGENTS', detail: 'no agent connected' };
}

export interface MessageView {
  id: string;
  seq: number;
  task_id: string | null;
  conversation_id: string;
  from_kind: MessageRow['from_kind'];
  from_agent: string | null;
  from_user_name: string | null;
  to_agent: string | null;
  to_all: boolean;
  message_type: MessageRow['message_type'];
  content: string;
  status: MessageRow['status'];
  reply_to: string | null;
  priority: MessageRow['priority'];
  requires_action: boolean;
  requires_approval: boolean;
  git_branch: string | null;
  git_commit: string | null;
  files: string[];
  meta: Record<string, unknown>;
  created_at: string;
  task_key: string | null;
}

export async function listMessages(
  db: Db,
  project: ProjectRow,
  q: { conversationId?: string; taskId?: string; all?: boolean; beforeSeq?: number; afterSeq?: number; limit?: number },
): Promise<MessageView[]> {
  const conds = ['m.project_id=$1'];
  const params: unknown[] = [project.id];
  if (q.taskId) {
    params.push(q.taskId);
    conds.push(`m.task_id=$${params.length}`);
  } else if (q.conversationId) {
    params.push(q.conversationId);
    conds.push(`m.conversation_id=$${params.length}`);
  }
  if (q.beforeSeq) {
    params.push(q.beforeSeq);
    conds.push(`m.seq < $${params.length}`);
  }
  if (q.afterSeq) {
    params.push(q.afterSeq);
    conds.push(`m.seq > $${params.length}`);
  }
  params.push(Math.min(q.limit ?? 80, 200));
  const r = await db.query<MessageView>(
    `select m.id, m.seq, m.task_id, m.conversation_id, m.from_kind, m.from_agent, u.display_name as from_user_name, m.to_agent, m.to_all,
            m.message_type, m.content, m.status, m.reply_to, m.priority, m.requires_action, m.requires_approval,
            m.git_branch, m.git_commit, m.files, m.meta, m.created_at, t.key as task_key
       from messages m
       left join users u on u.id=m.from_user
       left join tasks t on t.id=m.task_id
      where ${conds.join(' and ')}
      order by m.seq ${q.afterSeq ? 'asc' : 'desc'}
      limit $${params.length}`,
    params,
  );
  const rows = r.rows.map((m) => ({ ...m, seq: Number(m.seq) }));
  return q.afterSeq ? rows : rows.reverse();
}

export async function taskDetail(db: Db, project: ProjectRow, task: TaskRow) {
  const [steps, approvals, reviews, refs, runs, subtasks] = await Promise.all([
    db.query(`select * from task_steps where task_id=$1 order by created_at desc limit 200`, [task.id]),
    db.query(`select * from approvals where task_id=$1 order by created_at desc limit 50`, [task.id]),
    db.query(`select * from reviews where task_id=$1 order by created_at desc limit 20`, [task.id]),
    db.query(`select * from git_refs where task_id=$1 order by created_at desc limit 50`, [task.id]),
    db.query(
      `select id, agent_id, status, started_at, finished_at, duration_ms, tokens_in, tokens_out, error, summary
         from agent_runs where task_id=$1 order by started_at desc limit 50`,
      [task.id],
    ),
    db.query(`select id, key, title, status, assigned_agent from tasks where parent_task_id=$1 order by seq`, [task.id]),
  ]);
  return {
    task,
    steps: steps.rows,
    approvals: approvals.rows,
    reviews: reviews.rows,
    git_refs: refs.rows,
    runs: runs.rows,
    subtasks: subtasks.rows,
    repo: project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : null,
  };
}
