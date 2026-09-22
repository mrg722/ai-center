import type { Db } from '../db';
import type { AgentRow, MessageRow, ProjectRow, TaskRow } from '../types';
import type { ContextPackage, WireMessage, WireTask } from '../../shared/protocol';
import { env } from '../env';
import { agentViews, effectivePermissions, openSession } from './repo';
import { renderContext, summarizeMessages, type CtxMessage } from './context-render';
import { ACTION_PROTOCOL_HELP } from './action-parser';

const HISTORY_WINDOW = 14;

/**
 * Context Manager — loading half. Pulls exactly the layers a run needs
 * (permanent memory, task memory, session/git) and hands them to the pure
 * renderer, which enforces the character budget.
 */
export async function buildContext(
  db: Db,
  i: { project: ProjectRow; agent: AgentRow; task: TaskRow | null; incoming: MessageRow | null },
): Promise<ContextPackage> {
  const { project, agent, task, incoming } = i;
  const [views, perms, session, docs, decisions] = await Promise.all([
    agentViews(db, project),
    effectivePermissions(db, agent.id),
    openSession(db, agent.id),
    db.query<{ kind: string; title: string; content: string }>(
      `select kind, title, content from project_context where project_id=$1 order by pinned desc, updated_at desc limit 12`,
      [project.id],
    ),
    db.query<{ title: string; decision: string }>(
      `select title, decision from decisions where project_id=$1 and status='accepted' order by created_at desc limit 10`,
      [project.id],
    ),
  ]);
  const names = new Map(views.map((v) => [v.id, v.slug]));

  let history: CtxMessage[] = [];
  let olderSummary = '';
  let reviews: { reviewer: string; verdict: string; summary: string }[] = [];
  if (task) {
    const msgs = await db.query<MessageRow>(
      `select * from messages where task_id=$1 and message_type <> 'COMMAND' ${incoming ? 'and id <> $2' : ''} order by seq desc limit 60`,
      incoming ? [task.id, incoming.id] : [task.id],
    );
    const all = msgs.rows.reverse().map((m) => toCtx(m, names));
    history = all.slice(-HISTORY_WINDOW);
    const older = all.slice(0, -HISTORY_WINDOW);
    olderSummary = task.context_summary || (older.length ? summarizeMessages(older) : '');
    const rv = await db.query<{ reviewer_agent: string; verdict: string; summary: string }>(
      `select reviewer_agent, verdict, summary from reviews where task_id=$1 order by created_at desc limit 5`,
      [task.id],
    );
    reviews = rv.rows.map((r) => ({ reviewer: names.get(r.reviewer_agent) ?? '?', verdict: r.verdict, summary: r.summary }));
  }

  return renderContext({
    agent: { slug: agent.slug, name: agent.name, role: agent.role, role_label: agent.role_label, transport: agent.transport, permissions: perms },
    project: {
      name: project.name,
      key: project.key,
      repo: project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : null,
      default_branch: project.default_branch,
      mode: project.mode,
    },
    roster: views.filter((v) => v.id !== agent.id).map((v) => ({ slug: v.slug, name: v.name, role_label: v.role_label, status: v.status })),
    task: task
      ? {
          key: task.key,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          assigned: task.assigned_agent ? (names.get(task.assigned_agent) ?? null) : null,
          branch: task.current_branch,
          commit: task.current_commit,
          summary: task.context_summary,
          created_files: task.created_files,
          modified_files: task.modified_files,
          related_commits: task.related_commits,
        }
      : null,
    incoming: incoming ? toCtx(incoming, names) : null,
    history,
    olderSummary,
    docs: docs.rows,
    decisions: decisions.rows,
    reviews,
    workspace: agent.transport === 'local-bridge' ? (session?.workspace ?? null) : null,
    protocolHelp:
      agent.transport !== 'local-bridge'
        ? ACTION_PROTOCOL_HELP + (agent.config.system_prompt_extra ? `\n\n${agent.config.system_prompt_extra}` : '')
        : agent.config.system_prompt_extra || null,
    budgetChars: env.contextBudgetChars,
  });
}

function toCtx(m: MessageRow, names: Map<string, string>): CtxMessage {
  return {
    from: m.from_kind === 'user' ? 'moderator' : m.from_kind === 'system' ? 'system' : (names.get(m.from_agent ?? '') ?? 'agent'),
    to: m.to_agent ? (names.get(m.to_agent) ?? 'agent') : m.to_all ? 'all' : 'moderator',
    type: m.message_type,
    content: m.content,
    created_at: new Date(m.created_at).toISOString(),
    from_kind: m.from_kind,
    external: Boolean((m.meta as { external?: boolean }).external),
  };
}

export function toWireMessage(m: MessageRow, names: Map<string, string>): WireMessage {
  return {
    id: m.id,
    seq: Number(m.seq),
    task_id: m.task_id,
    conversation_id: m.conversation_id,
    from_kind: m.from_kind,
    from: m.from_kind === 'user' ? 'moderator' : m.from_kind === 'system' ? 'system' : (names.get(m.from_agent ?? '') ?? 'agent'),
    to: m.to_agent ? (names.get(m.to_agent) ?? null) : null,
    to_all: m.to_all,
    message_type: m.message_type,
    content: m.content,
    priority: m.priority,
    reply_to: m.reply_to,
    requires_action: m.requires_action,
    files: m.files,
    git_branch: m.git_branch,
    git_commit: m.git_commit,
    meta: m.meta,
    created_at: new Date(m.created_at).toISOString(),
  };
}

export function toWireTask(t: TaskRow, names: Map<string, string>): WireTask {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigned_agent: t.assigned_agent ? (names.get(t.assigned_agent) ?? null) : null,
    current_branch: t.current_branch,
    current_commit: t.current_commit,
    modified_files: t.modified_files,
    created_files: t.created_files,
    context_summary: t.context_summary,
  };
}
