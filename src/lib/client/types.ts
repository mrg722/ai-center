/* Client-side view types (mirror of server read models, no secrets). */
import type { AgentStatus, MessageType, Mode, PermissionSet, Priority, SystemState, TaskStatus, Transport } from '@/shared/domain';
import type { ToolServerConfig, WorkspaceState } from '@/shared/protocol';

export interface AgentView {
  id: string;
  slug: string;
  name: string;
  provider: { id: string; name: string };
  runtime: string;
  runtime_label: string;
  transport: Transport;
  capabilities: string[];
  simulated: boolean;
  model: string;
  role: string;
  role_label: string;
  description: string;
  color: string;
  enabled: boolean;
  paused: boolean;
  status: AgentStatus;
  status_reason: string;
  activity: string;
  last_heartbeat_at: string | null;
  current_task_id: string | null;
  workspace: WorkspaceState;
  tools: string[];
  client_version: string;
  permissions: PermissionSet;
  temporary_grants: { action: string; allowed: boolean; expires_at: string | null }[];
  has_token: boolean;
  token_prefix: string | null;
  office_style: string;
  config: {
    base_url?: string;
    api_key_env?: string;
    temperature?: number;
    max_tokens?: number;
    office_style?: string;
    system_prompt_extra?: string;
    mcp_tool?: string;
  };
  sort_order: number;
}

export interface TaskSummary {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
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

export interface ApprovalView {
  id: string;
  task_id: string | null;
  requested_by_agent: string | null;
  action: string;
  title: string;
  detail: string;
  created_at: string;
}

export interface EventView {
  id: number | null;
  type: string;
  actor_kind: 'user' | 'agent' | 'system';
  actor_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Snapshot {
  /** computed by the orchestrator — the UI renders it, never derives it */
  system: { state: SystemState; detail: string };
  project: {
    id: string;
    key: string;
    name: string;
    description: string;
    repo: string | null;
    default_branch: string;
    mode: Mode;
    halted: boolean;
    halted_at: string | null;
    max_auto_hops: number;
    default_reviewer: string | null;
    tool_servers: ToolServerConfig[];
    daily_token_budget: number | null;
    deploy_workflow: string | null;
  };
  general_conversation_id: string | null;
  agents: AgentView[];
  tasks: TaskSummary[];
  approvals: ApprovalView[];
  events: EventView[];
  last_event_id: number;
  task_counts: Record<string, number>;
  server_time: string;
  me: { id: string; email: string; display_name: string; role: string };
}

export interface MessageView {
  id: string;
  seq: number;
  task_id: string | null;
  conversation_id: string;
  from_kind: 'user' | 'agent' | 'system';
  from_agent: string | null;
  from_user_name: string | null;
  to_agent: string | null;
  to_all: boolean;
  message_type: MessageType;
  content: string;
  status: string;
  reply_to: string | null;
  priority: Priority;
  requires_action: boolean;
  requires_approval: boolean;
  git_branch: string | null;
  git_commit: string | null;
  files: string[];
  meta: Record<string, unknown>;
  created_at: string;
  task_key: string | null;
}

export interface RuntimeInfo {
  id: string;
  label: string;
  provider: { id: string; name: string };
  runtime: string;
  transport: Transport;
  description: string;
  paid: boolean;
  apiKeyEnv: string | null;
  apiKeyOptional: boolean;
  apiKeyPresent: boolean | null;
  defaultBaseUrl: string | null;
  baseUrlEditable: boolean;
  defaultModel: string;
  capabilities: string[];
}

export interface GithubStatus {
  configured: boolean;
  token: boolean;
  repo: string | null;
  error?: string;
  default_branch?: string;
  head_commit?: { sha: string; message: string; author: string; date: string };
  open_prs?: { number: number; title: string; head: string; url: string; draft: boolean; author: string }[];
  open_issues?: number;
  branches?: string[];
}

export interface Flight {
  id: string;
  from: string | 'moderator' | 'system';
  to: string[]; // agent ids or 'moderator'
  type: string;
  at: number;
}
