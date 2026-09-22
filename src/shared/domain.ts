/**
 * Domain vocabulary shared by the web app, the orchestrator and the local
 * Agent Bridge. Pure TypeScript — no runtime dependencies — so it can be
 * compiled into the bridge worker as well.
 */

export const TASK_STATUSES = [
  'OPEN',
  'PLANNING',
  'IN_PROGRESS',
  'WAITING_AGENT',
  'WAITING_REVIEW',
  'WAITING_USER',
  'APPROVED',
  'REJECTED',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED', 'REJECTED'];

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MESSAGE_TYPES = [
  'TASK',
  'REQUEST',
  'REVIEW',
  'QUESTION',
  'ANSWER',
  'WARNING',
  'ERROR',
  'PROPOSAL',
  'APPROVAL_REQUEST',
  'STATUS',
  'RESULT',
  'HANDOFF',
  // internal extensions
  'COMMAND', // orchestrator → bridge control (approved git op, cancel)
  'NOTE', // moderator note, never delivered
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Message types an agent is allowed to author. */
export const AGENT_MESSAGE_TYPES: readonly MessageType[] = [
  'REQUEST',
  'REVIEW',
  'QUESTION',
  'ANSWER',
  'WARNING',
  'ERROR',
  'PROPOSAL',
  'STATUS',
  'RESULT',
  'HANDOFF',
];

/** Message types the moderator can author from the UI. */
export const USER_MESSAGE_TYPES: readonly MessageType[] = [
  'TASK',
  'REQUEST',
  'REVIEW',
  'QUESTION',
  'ANSWER',
  'WARNING',
  'NOTE',
];

export const AGENT_STATUSES = [
  'ONLINE',
  'WORKING',
  'THINKING',
  'WAITING',
  'REVIEWING',
  'ERROR',
  'OFFLINE',
  'BLOCKED',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Statuses a live agent session can report (OFFLINE is derived from missing heartbeats). */
export const SESSION_STATUSES = AGENT_STATUSES.filter((s) => s !== 'OFFLINE') as Exclude<AgentStatus, 'OFFLINE'>[];

/**
 * DEMO       → every agent is executed by the in-process simulator (clearly
 *              labelled SIMULATED); nothing touches git, workspaces or paid APIs.
 * MODERATED  → agents converse; handoffs and sensitive operations need approval.
 * SUPERVISED → agents hand work to each other; push/PR/deploy need approval.
 * AUTONOMOUS → full chains within permissions; merge/deploy/dangerous still need approval.
 */
export const MODES = ['DEMO', 'MODERATED', 'SUPERVISED', 'AUTONOMOUS'] as const;
export type Mode = (typeof MODES)[number];

/**
 * How the orchestrator reaches an agent's runtime:
 *  local-bridge → a worker on the user's machine (Claude Code, Codex, any CLI)
 *  http-api     → the orchestrator calls an HTTP API (Gemini, OpenAI, Ollama…)
 *  in-process   → runs inside the orchestrator (the DEMO simulator)
 */
export const TRANSPORTS = ['local-bridge', 'http-api', 'in-process'] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * Actions governed by the permission system. `read`/`write` are workspace
 * capabilities; the rest are orchestrator-level operations.
 */
export const PERMISSION_ACTIONS = [
  'read',
  'write',
  'commit',
  'push',
  'merge',
  'dangerous_operations',
  'handoff',
  'create_task',
  'pr_create',
  'deploy',
  'paid_api',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionSet = Record<PermissionAction, boolean>;

export const APPROVAL_ACTIONS = [
  'commit',
  'push',
  'merge',
  'pr_create',
  'deploy',
  'handoff',
  'dangerous_operations',
  'paid_api',
  'continue_chain',
  'task_complete',
  'generic',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const AGENT_ROLES = ['PRIMARY_BUILDER', 'AUDITOR_INTEGRATOR', 'RESEARCHER', 'GENERIC'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Seconds without heartbeat after which a bridge agent is considered OFFLINE. */
export const HEARTBEAT_TIMEOUT_S = 45;
/** Interval the bridge should heartbeat at. */
export const HEARTBEAT_INTERVAL_S = 15;

/**
 * Global system state — computed ONLY by the orchestrator (state.ts) from
 * agent states, approvals and the halt flag. The UI never derives it.
 */
export const SYSTEM_STATES = ['HALTED', 'DEMO', 'NEEDS_YOU', 'ACTIVE', 'IDLE', 'NO_AGENTS'] as const;
export type SystemState = (typeof SYSTEM_STATES)[number];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}
