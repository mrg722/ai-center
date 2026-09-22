import type { Db } from '../db';
import type { Actor, AgentRow, ApprovalRow, ProjectRow, TaskRow } from '../types';
import type { ActionResult, AgentAction, BridgeCommand } from '../../shared/protocol';
import { decide, agentCanSetStatus, type Decision, type PolicyAction } from './policy';
import { AGENT_MESSAGE_TYPES } from '../../shared/domain';
import { emit } from '../events/bus';
import { addStep, postMessage } from './router';
import { BadRequest, effectivePermissions, getAgentBySlug, getProjectById, getTask, listAgentRows } from './repo';
import { createTask, patchTask, setStatus } from './tasks';
import { createPullRequest, dispatchWorkflow, mergePullRequest } from '../github/client';

export function agentActor(a: AgentRow): Actor {
  return { kind: 'agent', id: a.id, slug: a.slug, name: a.name };
}

export interface ExecOptions {
  /** set when the moderator approved this exact action (skips the approval step) */
  approvedBy?: { approvalId: string; userId: string };
}

/**
 * Action → Policy Engine → allowed? / requires approval? → Execute.
 * Every non-allow decision is recorded as an audit event.
 */
export async function authorize(
  db: Db,
  project: ProjectRow,
  agent: AgentRow,
  action: PolicyAction,
  task: TaskRow | null,
  targetsAgent = false,
  extra: { tokensToday?: number; dailyTokenBudget?: number } = {},
): Promise<Decision> {
  const d = decide({
    ...extra,
    action,
    mode: project.mode,
    halted: project.halted,
    agentEnabled: agent.enabled,
    agentPaused: agent.paused,
    permissions: await effectivePermissions(db, agent.id),
    autoHops: task?.auto_hops,
    maxAutoHops: project.max_auto_hops,
    targetsAgent,
    taskRequiresHumanApproval: task?.requires_human_approval,
    taskStatus: task?.status,
  });
  if (d.kind !== 'allow') {
    await emit(db, {
      project_id: project.id,
      type: 'policy.decision',
      actor: agentActor(agent),
      agent_id: agent.id,
      task_id: task?.id ?? null,
      payload: { action, decision: d.kind, reason: d.reason },
    });
  }
  return d;
}
const policyFor = authorize;

async function resolveTarget(db: Db, project: ProjectRow, to: string | undefined): Promise<AgentRow | 'moderator' | 'all'> {
  const t = (to ?? '').trim().toLowerCase();
  if (t === 'moderator' || t === 'user' || t === 'human') return 'moderator';
  if (t === 'all' || t === '*') return 'all';
  const a = await getAgentBySlug(db, project.id, t);
  if (!a) throw new BadRequest(`Unknown agent "${to}". Use acc_list_agents to see valid slugs.`);
  if (!a.enabled) throw new BadRequest(`Agent "${to}" is disabled.`);
  return a;
}

async function loadTask(db: Db, project: ProjectRow, id: string | undefined, required: boolean): Promise<TaskRow | null> {
  if (!id) {
    if (required) throw new BadRequest('task_id is required');
    return null;
  }
  const t = await getTask(db, id);
  if (t.project_id !== project.id) throw new BadRequest('task belongs to another project');
  return t;
}

/** Creates an approval and announces it in the room. */
export async function requestApproval(
  db: Db,
  i: {
    project: ProjectRow;
    task: TaskRow | null;
    agent: AgentRow | null;
    action: string;
    title: string;
    detail: string;
    payload: Record<string, unknown>;
  },
): Promise<ApprovalRow> {
  const r = await db.query<ApprovalRow>(
    `insert into approvals (project_id, task_id, requested_by_agent, action, title, detail, payload)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [i.project.id, i.task?.id ?? null, i.agent?.id ?? null, i.action, i.title.slice(0, 300), i.detail.slice(0, 8000), JSON.stringify(i.payload)],
  );
  const approval = r.rows[0];
  const actor: Actor = i.agent ? agentActor(i.agent) : { kind: 'system' };
  await postMessage(db, {
    project: i.project,
    task: i.task,
    from: actor,
    to: { moderator: true },
    type: 'APPROVAL_REQUEST',
    content: `${i.title}\n\n${i.detail}`,
    requiresApproval: true,
    meta: { approval_id: approval.id, approval_action: i.action },
  });
  if (i.task) {
    await addStep(db, i.task.id, actor, 'approval', `Approval requested: ${i.title}`, { approval_id: approval.id });
    if (!['WAITING_USER', 'COMPLETED', 'CANCELLED'].includes(i.task.status)) {
      await setStatus(db, i.task, 'WAITING_USER', actor, 'awaiting moderator approval');
    }
  }
  await emit(db, {
    project_id: i.project.id,
    type: 'approval.created',
    actor,
    task_id: i.task?.id ?? null,
    agent_id: i.agent?.id ?? null,
    payload: { approval_id: approval.id, action: i.action, title: i.title },
  });
  return approval;
}

async function hold(
  db: Db,
  project: ProjectRow,
  agent: AgentRow,
  task: TaskRow | null,
  decision: Extract<Decision, { kind: 'approval' }>,
  action: AgentAction,
  title: string,
): Promise<ActionResult> {
  const approval = await requestApproval(db, {
    project,
    task,
    agent,
    action: decision.approvalAction,
    title,
    detail: decision.reason,
    payload: { agent_action: action, agent_id: agent.id },
  });
  return { ok: true, outcome: 'held_for_approval', approval_id: approval.id, reason: decision.reason };
}

/** Enqueues a deterministic COMMAND for an agent's bridge (git commit / push). */
export async function enqueueBridgeCommand(
  db: Db,
  project: ProjectRow,
  task: TaskRow,
  agent: AgentRow,
  cmd: BridgeCommand,
  actor: Actor,
): Promise<string> {
  if (agent.transport !== 'local-bridge') throw new BadRequest(`${agent.name} does not run on a local bridge; git operations run there.`);
  const label = cmd.command === 'git_push' ? `git push ${cmd.branch}` : cmd.command === 'git_commit' ? 'git commit' : cmd.command;
  const { message } = await postMessage(db, {
    project,
    task,
    from: actor.kind === 'user' ? actor : { kind: 'system' },
    to: { agentId: agent.id },
    type: 'COMMAND',
    content: `Execute ${label} (approved by orchestrator policy).`,
    meta: cmd as unknown as Record<string, unknown>,
  });
  await addStep(db, task.id, actor, 'git', `Queued ${label} on ${agent.name}`, { command: cmd.command });
  return message.id;
}

/**
 * Executes one agent action through the policy engine.
 * Returns what happened; never throws for policy denials (the agent gets a
 * readable reason instead).
 */
export async function executeAgentAction(db: Db, agent: AgentRow, action: AgentAction, opts: ExecOptions = {}): Promise<ActionResult> {
  const project = await getProjectById(db, agent.project_id);
  const actor = agentActor(agent);
  const approved = Boolean(opts.approvedBy);
  const gate = (d: Decision): Decision => (approved && d.kind === 'approval' ? { kind: 'allow' } : d);

  switch (action.action) {
    case 'send_message': {
      if (!AGENT_MESSAGE_TYPES.includes(action.type)) return { ok: false, outcome: 'denied', reason: `agents cannot send ${action.type}` };
      const task = await loadTask(db, project, action.task_id, false);
      const target = await resolveTarget(db, project, action.to);
      const d = gate(await policyFor(db, project, agent, 'message', task, target !== 'moderator'));
      if (d.kind === 'deny') return { ok: false, outcome: 'denied', reason: d.reason };
      if (d.kind === 'approval') return hold(db, project, agent, task, d, action, `Continue agent chain: ${agent.name} → ${action.to}`);
      const { message } = await postMessage(db, {
        project,
        task,
        from: actor,
        to: target === 'moderator' ? { moderator: true } : target === 'all' ? { all: true } : { agentId: target.id },
        type: action.type,
        content: action.content,
        replyTo: action.reply_to,
        files: action.files,
        requiresAction: action.requires_action,
      });
      return { ok: true, outcome: target === 'moderator' ? 'done' : 'delivered', message_id: message.id };
    }

    case 'handoff':
    case 'request_review': {
      const task = (await loadTask(db, project, action.task_id, true))!;
      let target: AgentRow | 'moderator' | 'all';
      if (action.action === 'request_review' && !action.to) {
        const agents = await listAgentRows(db, project.id);
        const preferred = project.settings.default_reviewer;
        target =
          agents.find((a) => a.slug === preferred && a.id !== agent.id && a.enabled) ??
          agents.find((a) => a.role === 'AUDITOR_INTEGRATOR' && a.id !== agent.id && a.enabled) ??
          'moderator';
      } else {
        target = await resolveTarget(db, project, action.to);
      }
      if (target === 'all') return { ok: false, outcome: 'denied', reason: 'handoff/review needs a single target' };
      if (target !== 'moderator' && target.id === agent.id) return { ok: false, outcome: 'denied', reason: 'cannot hand off to yourself' };

      const pa: PolicyAction = action.action === 'handoff' ? 'handoff' : 'request_review';
      const d = gate(await policyFor(db, project, agent, pa, task, target !== 'moderator'));
      if (d.kind === 'deny') return { ok: false, outcome: 'denied', reason: d.reason };
      const targetName = target === 'moderator' ? 'moderator' : target.name;
      if (d.kind === 'approval') {
        return hold(db, project, agent, task, d, action, `${action.action === 'handoff' ? 'Handoff' : 'Review request'}: ${agent.name} → ${targetName} (${task.key})`);
      }
      const isReview = action.action === 'request_review';
      const { message } = await postMessage(db, {
        project,
        task,
        from: actor,
        to: target === 'moderator' ? { moderator: true } : { agentId: target.id },
        type: isReview ? 'REVIEW' : 'HANDOFF',
        content: action.content,
        files: action.files,
        gitCommit: isReview ? (action.commit ?? task.current_commit) : task.current_commit,
        gitBranch: task.current_branch,
        requiresAction: true,
        meta: { requested_by: agent.slug },
      });
      if (target !== 'moderator') {
        await patchTask(
          db,
          task,
          isReview
            ? { next_agent: target.id, modified_files: action.files }
            : { assigned_agent: target.id, next_agent: null, modified_files: action.files },
          actor,
        );
        await setStatus(db, await getTask(db, task.id), isReview ? 'WAITING_REVIEW' : 'IN_PROGRESS', actor, `${isReview ? 'review' : 'handoff'} → ${targetName}`);
      }
      await addStep(db, task.id, actor, isReview ? 'review' : 'handoff', `${agent.name} → ${targetName}`, { message_id: message.id });
      return { ok: true, outcome: 'delivered', message_id: message.id, task_id: task.id };
    }

    case 'request_approval': {
      const task = await loadTask(db, project, action.task_id, false);
      const approval = await requestApproval(db, {
        project,
        task,
        agent,
        action: action.approval,
        title: action.title,
        detail: action.detail,
        payload: { agent_id: agent.id, informational: true },
      });
      return { ok: true, outcome: 'held_for_approval', approval_id: approval.id };
    }

    case 'update_task': {
      const task = (await loadTask(db, project, action.task_id, true))!;
      const d0 = await policyFor(db, project, agent, 'update_task', task);
      if (d0.kind === 'deny') return { ok: false, outcome: 'denied', reason: d0.reason };
      let updated = await patchTask(
        db,
        task,
        {
          context_summary: action.context_summary,
          current_branch: action.current_branch,
          current_commit: action.current_commit,
          created_files: action.created_files,
          modified_files: action.modified_files,
          related_commits: action.related_commits,
        },
        actor,
      );
      if (action.status && action.status !== task.status) {
        if (!agentCanSetStatus(task.status, action.status)) {
          return { ok: false, outcome: 'denied', reason: `agents cannot move a task from ${task.status} to ${action.status}` };
        }
        if (action.status === 'COMPLETED') {
          const d = gate(await policyFor(db, project, agent, 'task_complete', updated));
          if (d.kind === 'deny') return { ok: false, outcome: 'denied', reason: d.reason };
          if (d.kind === 'approval') return hold(db, project, agent, updated, d, action, `Complete ${task.key}: ${task.title}`);
        }
        updated = await setStatus(db, updated, action.status, actor);
      }
      return { ok: true, outcome: 'done', task_id: updated.id };
    }

    case 'record_review': {
      const task = (await loadTask(db, project, action.task_id, true))!;
      // author = whoever asked this agent for the review most recently
      const req = await db.query<{ from_agent: string | null }>(
        `select from_agent from messages where task_id=$1 and to_agent=$2 and message_type='REVIEW' order by seq desc limit 1`,
        [task.id, agent.id],
      );
      const author = req.rows[0]?.from_agent ?? task.assigned_agent;
      await db.query(
        `insert into reviews (project_id, task_id, reviewer_agent, author_agent, verdict, summary, findings, git_commit)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [project.id, task.id, agent.id, author, action.verdict, action.summary.slice(0, 8000), JSON.stringify(action.findings ?? []), action.commit ?? task.current_commit],
      );
      const findings = (action.findings ?? []).map((f) => `- ${f.severity ? `[${f.severity}] ` : ''}${f.file ? `${f.file}${f.line ? `:${f.line}` : ''} — ` : ''}${f.note}`);
      const content = `Review ${action.verdict}: ${action.summary}${findings.length ? `\n\n${findings.join('\n')}` : ''}`;
      const authorIsOther = author && author !== agent.id;
      // CHANGES_REQUESTED goes back to the author (hop-limited); otherwise it is reported to the room
      if (action.verdict === 'CHANGES_REQUESTED' && authorIsOther) {
        const d = await policyFor(db, project, agent, 'message', task, true);
        if (d.kind === 'allow') {
          await postMessage(db, { project, task, from: actor, to: { agentId: author! }, type: 'REVIEW', content, requiresAction: true });
          await patchTask(db, task, { assigned_agent: author, next_agent: null }, actor);
          await setStatus(db, await getTask(db, task.id), 'IN_PROGRESS', actor, 'changes requested');
        } else {
          await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'REVIEW', content });
        }
      } else {
        await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'REVIEW', content });
        if (action.verdict === 'APPROVED' && task.status === 'WAITING_REVIEW') {
          await setStatus(db, task, 'IN_PROGRESS', actor, 'review approved');
        }
      }
      await addStep(db, task.id, actor, 'review', `Review: ${action.verdict}`, { findings: action.findings?.length ?? 0 });
      await emit(db, { project_id: project.id, type: 'review.created', actor, task_id: task.id, agent_id: agent.id, payload: { verdict: action.verdict } });
      return { ok: true, outcome: 'done', task_id: task.id };
    }

    case 'propose_decision': {
      const task = await loadTask(db, project, action.task_id, false);
      await db.query(
        `insert into decisions (project_id, task_id, title, decision, rationale, status, proposed_by_agent) values ($1,$2,$3,$4,$5,'proposed',$6)`,
        [project.id, task?.id ?? null, action.title.slice(0, 300), action.decision.slice(0, 8000), (action.rationale ?? '').slice(0, 8000), agent.id],
      );
      await postMessage(db, {
        project,
        task,
        from: actor,
        to: { moderator: true },
        type: 'PROPOSAL',
        content: `Decision proposed: ${action.title}\n\n${action.decision}${action.rationale ? `\n\nWhy: ${action.rationale}` : ''}`,
      });
      await emit(db, { project_id: project.id, type: 'decision.created', actor, task_id: task?.id ?? null, payload: { title: action.title } });
      return { ok: true, outcome: 'done' };
    }

    case 'git_request': {
      const task = (await loadTask(db, project, action.task_id, true))!;
      const pa: PolicyAction = action.op === 'pr_create' ? 'pr_create' : action.op;
      const d = gate(await policyFor(db, project, agent, pa, task));
      if (d.kind === 'deny') return { ok: false, outcome: 'denied', reason: d.reason };
      const branch = action.branch ?? task.current_branch ?? undefined;
      if (d.kind === 'approval') {
        const what =
          action.op === 'commit'
            ? `Commit on ${agent.name}: "${(action.message ?? '').slice(0, 80)}"`
            : action.op === 'push'
              ? `Push ${branch ?? '(current branch)'} from ${agent.name}`
              : action.op === 'pr_create'
                ? `Open PR ${branch} → ${action.base ?? project.default_branch}`
                : action.op === 'deploy'
                  ? `Deploy ${branch ?? project.default_branch} (workflow ${project.settings.deploy_workflow ?? 'not configured'})`
                  : `Merge PR for ${branch}`;
        return hold(db, project, agent, task, d, action, `${what} (${task.key})`);
      }
      const approvalId = opts.approvedBy?.approvalId;
      if (project.mode === 'DEMO') {
        // DEMO: the decision path is real, the execution is simulated — nothing touches git or GitHub.
        const fakeSha = Array.from({ length: 40 }, (_, k) => '0123456789abcdef'[(task.seq * 7 + k * 13) % 16]).join('');
        if (action.op === 'commit') await patchTask(db, task, { current_commit: fakeSha, related_commits: [fakeSha] }, actor);
        if (action.op === 'push' && branch) await patchTask(db, task, { current_branch: branch }, actor);
        await postMessage(db, {
          project,
          task,
          from: actor,
          to: { moderator: true },
          type: 'STATUS',
          content: `[SIMULADO] git ${action.op}${branch ? ` ${branch}` : ''} — modo DEMO: no se ha ejecutado nada real.`,
          meta: { simulated: true },
        });
        return { ok: true, outcome: 'done', reason: 'simulated (DEMO mode)' };
      }
      if (action.op === 'deploy') {
        const wf = project.settings.deploy_workflow;
        if (!wf) return { ok: false, outcome: 'error', reason: 'No deploy workflow configured (Settings → Proyecto).' };
        await dispatchWorkflow(project, wf, branch ?? project.default_branch, { task: task.key });
        await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'RESULT', content: `Deploy triggered: workflow ${wf} on ${branch ?? project.default_branch}` });
        return { ok: true, outcome: 'done' };
      }
      if (action.op === 'commit') {
        if (!action.message) return { ok: false, outcome: 'error', reason: 'commit message required' };
        const id = await enqueueBridgeCommand(db, project, task, agent, { command: 'git_commit', task_id: task.id, message: action.message, files: action.files, approval_id: approvalId }, actor);
        return { ok: true, outcome: 'delivered', message_id: id, reason: 'The bridge will commit and report back.' };
      }
      if (action.op === 'push') {
        if (!branch) return { ok: false, outcome: 'error', reason: 'branch required (or set current_branch on the task)' };
        const id = await enqueueBridgeCommand(db, project, task, agent, { command: 'git_push', task_id: task.id, branch, approval_id: approvalId }, actor);
        return { ok: true, outcome: 'delivered', message_id: id, reason: 'The bridge will push and report back.' };
      }
      if (action.op === 'pr_create') {
        if (!branch) return { ok: false, outcome: 'error', reason: 'branch required' };
        const pr = await createPullRequest(project, {
          head: branch,
          base: action.base ?? project.default_branch,
          title: action.title ?? `${task.key}: ${task.title}`,
          body: `${action.body ?? task.context_summary ?? ''}\n\n---\nTask ${task.key} · opened by ${agent.name} via AI Command Center`,
        });
        await db.query(
          `insert into git_refs (project_id, task_id, kind, ref, title, url, author_agent) values ($1,$2,'pr',$3,$4,$5,$6) on conflict do nothing`,
          [project.id, task.id, String(pr.number), pr.title, pr.url, agent.id],
        );
        await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'RESULT', content: `Opened PR #${pr.number}: ${pr.url}` });
        return { ok: true, outcome: 'done', reason: pr.url };
      }
      // merge (only reachable after approval)
      const prRef = await db.query<{ ref: string }>(`select ref from git_refs where task_id=$1 and kind='pr' order by created_at desc limit 1`, [task.id]);
      if (!prRef.rows[0]) return { ok: false, outcome: 'error', reason: 'no PR recorded for this task' };
      const merged = await mergePullRequest(project, Number(prRef.rows[0].ref));
      await postMessage(db, { project, task, from: actor, to: { moderator: true }, type: 'RESULT', content: `Merged PR #${prRef.rows[0].ref} (${merged.sha.slice(0, 10)})` });
      return { ok: true, outcome: 'done' };
    }

    case 'create_subtask': {
      const parent = (await loadTask(db, project, action.parent_task_id, true))!;
      const d = gate(await policyFor(db, project, agent, 'create_task', parent));
      if (d.kind === 'deny') return { ok: false, outcome: 'denied', reason: d.reason };
      if (d.kind === 'approval') return hold(db, project, agent, parent, d, action, `Create sub-task "${action.title}" under ${parent.key}`);
      const assignee = action.assign_to ? await resolveTarget(db, project, action.assign_to) : null;
      const t = await createTask(db, {
        project,
        actor,
        title: action.title,
        description: action.description,
        priority: action.priority,
        parentTaskId: parent.id,
        assignedAgentId: assignee && typeof assignee === 'object' ? assignee.id : null,
        requiresHumanApproval: parent.requires_human_approval,
      });
      return { ok: true, outcome: 'done', task_id: t.id };
    }
  }
}
