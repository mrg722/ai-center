/**
 * Policy engine — the single place that decides whether an operation is
 * allowed, needs human approval, or is denied. Pure & deterministic so it
 * can be unit tested exhaustively.
 *
 *   Action → Policy Engine → allowed? → requires approval? → Execute
 *
 * Every sensitive operation goes through here BEFORE it happens:
 * messages/handoffs, commit, push, PR, merge, deploy, running an agent on a
 * local machine (and whether it may modify files), and calling a paid API.
 * Inputs are facts (mode, permissions, flags, counters, budget); prompts can
 * never change the outcome. DEMO mode follows SUPERVISED rules (so approvals
 * can be exercised) while execution is simulated.
 */
import type { Mode, PermissionAction, PermissionSet, TaskStatus } from '../../shared/domain';
import { TERMINAL_TASK_STATUSES } from '../../shared/domain';

export type PolicyAction =
  | 'message' // agent → agent/moderator conversation
  | 'handoff'
  | 'request_review'
  | 'commit'
  | 'push'
  | 'pr_create'
  | 'merge'
  | 'dangerous_operations'
  | 'create_task'
  | 'task_complete'
  | 'update_task'
  | 'deploy'
  | 'local_run' // start an agent run on a user's machine (bridge)
  | 'paid_api_call'; // call a paid http-api runtime

export type Decision =
  | { kind: 'allow' }
  | { kind: 'approval'; reason: string; approvalAction: string }
  | { kind: 'deny'; reason: string };

export interface PolicyInput {
  action: PolicyAction;
  mode: Mode;
  halted: boolean;
  agentEnabled: boolean;
  agentPaused: boolean;
  permissions: PermissionSet;
  /** agent→agent deliveries since the last human intervention on this task */
  autoHops?: number;
  maxAutoHops?: number;
  /** delivery targets another agent (as opposed to the moderator) */
  targetsAgent?: boolean;
  taskRequiresHumanApproval?: boolean;
  taskStatus?: TaskStatus;
  /** paid_api_call: tokens used today vs daily budget */
  tokensToday?: number;
  dailyTokenBudget?: number;
}

const REQUIRED_PERMISSION: Partial<Record<PolicyAction, PermissionAction>> = {
  handoff: 'handoff',
  request_review: 'handoff',
  commit: 'commit',
  push: 'push',
  pr_create: 'pr_create',
  merge: 'merge',
  dangerous_operations: 'dangerous_operations',
  create_task: 'create_task',
  deploy: 'deploy',
  local_run: 'read',
  paid_api_call: 'paid_api',
};

export function decide(input: PolicyInput): Decision {
  // DEMO executes nothing real; it uses SUPERVISED approval rules
  const i: PolicyInput = input.mode === 'DEMO' ? { ...input, mode: 'SUPERVISED' } : input;
  if (i.halted) return { kind: 'deny', reason: 'STOP ALL is active. The moderator must resume the system.' };
  if (!i.agentEnabled) return { kind: 'deny', reason: 'Agent is disabled.' };
  if (i.agentPaused) return { kind: 'deny', reason: 'Agent is paused by the moderator.' };
  if (i.taskStatus && TERMINAL_TASK_STATUSES.includes(i.taskStatus) && i.action !== 'message') {
    return { kind: 'deny', reason: `Task is ${i.taskStatus}; only the moderator can reopen it.` };
  }

  const perm = REQUIRED_PERMISSION[i.action];
  if (perm && !i.permissions[perm]) {
    return { kind: 'deny', reason: `Agent lacks the "${perm}" permission. The moderator can grant it temporarily.` };
  }

  // Chain/loop guard: any agent→agent delivery beyond the budget pauses for a human.
  const hopLimited = ['message', 'handoff', 'request_review'].includes(i.action) && i.targetsAgent;
  if (hopLimited && i.maxAutoHops !== undefined && (i.autoHops ?? 0) >= i.maxAutoHops) {
    return {
      kind: 'approval',
      approvalAction: 'continue_chain',
      reason: `Agent-to-agent chain reached ${i.maxAutoHops} hops without human input.`,
    };
  }

  switch (i.action) {
    case 'deploy':
      return { kind: 'approval', approvalAction: 'deploy', reason: 'Deploys always require human approval.' };
    case 'paid_api_call':
      if (i.dailyTokenBudget !== undefined && (i.tokensToday ?? 0) >= i.dailyTokenBudget) {
        return {
          kind: 'deny',
          reason: `Daily token budget reached (${i.tokensToday}/${i.dailyTokenBudget}). The moderator can raise it in Settings.`,
        };
      }
      return { kind: 'allow' };
    case 'local_run':
      return { kind: 'allow' }; // write access is shaped separately by the `write` permission
    case 'merge':
      return { kind: 'approval', approvalAction: 'merge', reason: 'Merges always require human approval.' };
    case 'dangerous_operations':
      return { kind: 'approval', approvalAction: 'dangerous_operations', reason: 'Dangerous operations always require approval.' };
    case 'push':
      return i.mode === 'AUTONOMOUS'
        ? { kind: 'allow' }
        : { kind: 'approval', approvalAction: 'push', reason: `Push requires approval in ${i.mode} mode.` };
    case 'pr_create':
      return i.mode === 'AUTONOMOUS'
        ? { kind: 'allow' }
        : { kind: 'approval', approvalAction: 'pr_create', reason: `Opening a PR requires approval in ${i.mode} mode.` };
    case 'commit':
      return i.mode === 'MODERATED'
        ? { kind: 'approval', approvalAction: 'commit', reason: 'Commits require approval in MODERATED mode.' }
        : { kind: 'allow' };
    case 'handoff':
    case 'request_review':
      return i.mode === 'MODERATED'
        ? { kind: 'approval', approvalAction: 'handoff', reason: 'Handoffs between agents require approval in MODERATED mode.' }
        : { kind: 'allow' };
    case 'create_task':
      return i.mode === 'MODERATED'
        ? { kind: 'approval', approvalAction: 'generic', reason: 'Creating tasks requires approval in MODERATED mode.' }
        : { kind: 'allow' };
    case 'task_complete':
      return i.taskRequiresHumanApproval
        ? { kind: 'approval', approvalAction: 'task_complete', reason: 'This task requires human sign-off to complete.' }
        : { kind: 'allow' };
    case 'message':
    case 'update_task':
      return { kind: 'allow' };
  }
}

/** Statuses an agent may move a task to (moderator can set any). */
export function agentCanSetStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (TERMINAL_TASK_STATUSES.includes(from)) return false;
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(to)) return false;
  return from !== to;
}
