/**
 * Wire protocol between the Orchestrator and agents (local Agent Bridge
 * workers and the MCP server they expose to Claude Code / Codex).
 *
 * All bridge endpoints authenticate with `Authorization: Bearer <agent token>`.
 * The token identifies exactly one agent; an agent can never act as another.
 */
import type {
  AgentStatus,
  ApprovalAction,
  Mode,
  MessageType,
  PermissionSet,
  Priority,
  TaskStatus,
} from './domain';

export const PROTOCOL_VERSION = 1;

export interface WorkspaceState {
  repo?: string; // "owner/name" if a GitHub remote is detected
  branch?: string;
  commit?: string;
  dirty_files?: string[];
  ahead?: number;
  behind?: number;
}

export interface ToolServerConfig {
  /** MCP server name as seen by the agent CLI */
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  /**
   * Environment variable NAMES the local machine must provide. Values are
   * never stored server-side — the bridge resolves them from its own env.
   */
  env_vars?: string[];
  enabled: boolean;
  description?: string;
}

export interface AgentIdentity {
  id: string;
  slug: string;
  name: string;
  role: string;
  role_label: string;
  runtime: string; // registry key, e.g. claude-code
  provider: string; // vendor id, e.g. anthropic
  model: string;
  permissions: PermissionSet;
}

export interface HelloRequest {
  protocol: number;
  client_version: string;
  runner: string;
  tools: string[];
  workspace: WorkspaceState;
}

export interface HelloResponse {
  agent: AgentIdentity;
  session_id: string;
  heartbeat_interval_s: number;
  mode: Mode;
  halted: boolean;
  tool_servers: ToolServerConfig[];
  project: { key: string; name: string; repo: string | null; default_branch: string };
}

export interface HeartbeatRequest {
  session_id: string;
  status: Exclude<AgentStatus, 'OFFLINE'>;
  activity?: string;
  current_task_id?: string | null;
  workspace?: WorkspaceState;
}

export interface HeartbeatResponse {
  halted: boolean;
  paused: boolean;
  mode: Mode;
  /** deliveries the orchestrator wants the bridge to abort */
  cancel_delivery_ids: string[];
  permissions: PermissionSet;
}

export interface WireMessage {
  id: string;
  seq: number;
  task_id: string | null;
  conversation_id: string;
  from_kind: 'user' | 'agent' | 'system';
  from: string; // agent slug, 'moderator' or 'system'
  to: string | null; // agent slug or null (broadcast)
  to_all: boolean;
  message_type: MessageType;
  content: string;
  priority: Priority;
  reply_to: string | null;
  requires_action: boolean;
  files: string[];
  git_branch: string | null;
  git_commit: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface WireTask {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigned_agent: string | null; // slug
  current_branch: string | null;
  current_commit: string | null;
  modified_files: string[];
  created_files: string[];
  context_summary: string;
}

export interface ContextPackage {
  /** Rendered, budgeted prompt ready to give to an LLM/CLI. */
  prompt: string;
  /** Rough size, for logging/metrics. */
  chars: number;
  sections: string[];
}

export interface InboxItem {
  delivery_id: string;
  message: WireMessage;
  task: WireTask | null;
  context: ContextPackage;
}

export interface InboxResponse {
  items: InboxItem[];
  halted: boolean;
}

export interface AckRequest {
  status: 'DONE' | 'FAILED';
  error?: string;
  run?: {
    started_at: string;
    finished_at: string;
    output_chars?: number;
    tokens_in?: number;
    tokens_out?: number;
    summary?: string;
  };
  /** final output from the agent; stored as a RESULT/ERROR message */
  result_text?: string;
  workspace?: WorkspaceState;
}

export interface ActivityRequest {
  kind: 'log' | 'thinking' | 'tool' | 'output';
  text: string;
  task_id?: string | null;
}

// ─────────────────────────────────────────────────────────── agent actions
// These are what an agent can ask the orchestrator to do. They are the ONLY
// way agents talk to each other: agents never call one another directly.

export type AgentAction =
  | {
      action: 'send_message';
      to: string; // agent slug | 'moderator' | 'all'
      type: MessageType;
      content: string;
      task_id?: string;
      reply_to?: string;
      files?: string[];
      requires_action?: boolean;
    }
  | {
      action: 'handoff';
      to: string;
      task_id: string;
      content: string;
      files?: string[];
    }
  | {
      action: 'request_review';
      to?: string;
      task_id: string;
      content: string;
      files?: string[];
      commit?: string;
    }
  | {
      action: 'request_approval';
      approval: ApprovalAction;
      task_id?: string;
      title: string;
      detail: string;
    }
  | {
      action: 'update_task';
      task_id: string;
      status?: TaskStatus;
      context_summary?: string;
      current_branch?: string;
      current_commit?: string;
      created_files?: string[];
      modified_files?: string[];
      related_commits?: string[];
    }
  | {
      action: 'record_review';
      task_id: string;
      verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
      summary: string;
      findings?: { file?: string; line?: number; severity?: string; note: string }[];
      commit?: string;
    }
  | {
      action: 'propose_decision';
      task_id?: string;
      title: string;
      decision: string;
      rationale?: string;
    }
  | {
      action: 'git_request';
      op: 'commit' | 'push' | 'pr_create' | 'merge' | 'deploy';
      task_id: string;
      branch?: string;
      message?: string;
      files?: string[];
      title?: string;
      body?: string;
      base?: string;
    }
  | {
      action: 'create_subtask';
      parent_task_id: string;
      title: string;
      description: string;
      assign_to?: string;
      priority?: Priority;
    };

export type ActionOutcome = 'done' | 'delivered' | 'held_for_approval' | 'denied' | 'error';

export interface ActionResult {
  ok: boolean;
  outcome: ActionOutcome;
  reason?: string;
  message_id?: string;
  approval_id?: string;
  task_id?: string;
}

/** Payload of a COMMAND message (orchestrator → bridge). */
export type BridgeCommand =
  | { command: 'git_commit'; approval_id?: string; task_id: string; message: string; files?: string[] }
  | { command: 'git_push'; approval_id?: string; task_id: string; branch: string; remote?: string }
  | { command: 'cancel'; delivery_id: string };
