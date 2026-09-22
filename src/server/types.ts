import type {
  AgentStatus,
  Transport,
  MessageType,
  Mode,
  PermissionSet,
  Priority,
  TaskStatus,
} from '../shared/domain';
import type { AgentConfig } from './providers/types';
import type { ToolServerConfig, WorkspaceState } from '../shared/protocol';

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  repo_owner: string | null;
  repo_name: string | null;
  default_branch: string;
  mode: Mode;
  halted: boolean;
  halted_at: string | null;
  max_auto_hops: number;
  settings: ProjectSettings;
  created_at: string;
  updated_at: string;
}

export interface ProjectSettings {
  tool_servers?: ToolServerConfig[];
  /** default reviewer agent slug */
  default_reviewer?: string;
  /** max tokens (in+out) per agent per UTC day on paid http-api runtimes */
  daily_token_budget?: number;
  /** GitHub Actions workflow file triggered by an approved `deploy` (e.g. deploy.yml) */
  deploy_workflow?: string;
}

export interface AgentRow {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  runtime: string; // registry key (see providers/types.ts)
  transport: Transport;
  model: string;
  role: string;
  role_label: string;
  description: string;
  color: string;
  config: AgentConfig;
  enabled: boolean;
  paused: boolean;
  token_hash: string | null;
  token_prefix: string | null;
  token_created_at: string | null;
  sort_order: number;
  created_at: string;
}

export interface SessionRow {
  id: string;
  agent_id: string;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  status: Exclude<AgentStatus, 'OFFLINE'>;
  provider_session_id: string | null;
  activity: string;
  current_task_id: string | null;
  workspace: WorkspaceState;
  tools: string[];
  client_version: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  key: string;
  seq: number;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  created_by_user: string | null;
  created_by_agent: string | null;
  assigned_agent: string | null;
  next_agent: string | null;
  conversation_id: string;
  parent_task_id: string | null;
  requires_human_approval: boolean;
  current_branch: string | null;
  current_commit: string | null;
  context_summary: string;
  created_files: string[];
  modified_files: string[];
  related_commits: string[];
  auto_hops: number;
  paused: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MessageRow {
  id: string;
  seq: number;
  project_id: string;
  task_id: string | null;
  conversation_id: string;
  from_kind: 'user' | 'agent' | 'system';
  from_agent: string | null;
  from_user: string | null;
  to_agent: string | null;
  to_all: boolean;
  message_type: MessageType;
  content: string;
  reply_to: string | null;
  priority: Priority;
  requires_action: boolean;
  requires_approval: boolean;
  git_branch: string | null;
  git_commit: string | null;
  files: string[];
  attachments: unknown[];
  status: 'SENT' | 'HELD' | 'DELIVERED' | 'PROCESSED' | 'FAILED' | 'CANCELLED';
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  message_id: string;
  agent_id: string;
  status: 'PENDING' | 'HELD' | 'DELIVERED' | 'DONE' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lease_until: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  project_id: string;
  task_id: string | null;
  requested_by_agent: string | null;
  action: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: 'owner' | 'moderator' | 'viewer';
  session_version: number;
}

export type Actor =
  | { kind: 'user'; id: string; name: string }
  | { kind: 'agent'; id: string; slug: string; name: string }
  | { kind: 'system' };

export interface AgentView {
  id: string;
  slug: string;
  name: string;
  /** Agent ≠ Provider ≠ Runtime ≠ Transport — all exposed separately */
  provider: { id: string; name: string };
  runtime: string;
  runtime_label: string;
  transport: Transport;
  capabilities: string[];
  /** true when the state shown comes from the DEMO simulator */
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
  config: AgentConfig;
  sort_order: number;
}
