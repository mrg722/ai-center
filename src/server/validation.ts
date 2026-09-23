import { z } from 'zod';
import {
  APPROVAL_ACTIONS,
  MESSAGE_TYPES,
  MODES,
  PERMISSION_ACTIONS,
  PRIORITIES,
  SESSION_STATUSES,
  TASK_STATUSES,
  USER_MESSAGE_TYPES,
} from '../shared/domain';
import type { AgentAction } from '../shared/protocol';

/* All external input (browser, bridges, hosted-LLM action blocks, webhooks)
 * is validated here with explicit size limits. */

const text = (max: number) => z.string().max(max);
const id = z.string().uuid();
const slugRef = z.string().trim().min(1).max(40);
const files = z.array(z.string().max(500)).max(200).optional();
const sha = z.string().regex(/^[0-9a-f]{7,64}$/i).optional();
const branch = z
  .string()
  .max(200)
  .regex(/^(?!-)[A-Za-z0-9._/-]+$/, 'invalid branch name')
  .optional();

export const agentActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send_message'),
    to: slugRef,
    type: z.enum(MESSAGE_TYPES),
    content: text(60_000).min(1),
    task_id: id.optional(),
    reply_to: id.optional(),
    files,
    requires_action: z.boolean().optional(),
  }),
  z.object({ action: z.literal('handoff'), to: slugRef, task_id: id, content: text(60_000).min(1), files }),
  z.object({
    action: z.literal('request_review'),
    to: slugRef.optional(),
    task_id: id,
    content: text(60_000).min(1),
    files,
    commit: sha,
  }),
  z.object({
    action: z.literal('request_approval'),
    approval: z.enum(APPROVAL_ACTIONS),
    task_id: id.optional(),
    title: text(300).min(1),
    detail: text(8000),
  }),
  z.object({
    action: z.literal('update_task'),
    task_id: id,
    status: z.enum(TASK_STATUSES).optional(),
    context_summary: text(8000).optional(),
    current_branch: branch,
    current_commit: sha,
    created_files: files,
    modified_files: files,
    related_commits: z.array(z.string().regex(/^[0-9a-f]{7,64}$/i)).max(100).optional(),
  }),
  z.object({
    action: z.literal('record_review'),
    task_id: id,
    verdict: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']),
    summary: text(8000).min(1),
    findings: z
      .array(
        z.object({
          file: z.string().max(500).optional(),
          line: z.number().int().nonnegative().optional(),
          severity: z.string().max(20).optional(),
          note: text(2000),
        }),
      )
      .max(100)
      .optional(),
    commit: sha,
  }),
  z.object({
    action: z.literal('propose_decision'),
    task_id: id.optional(),
    title: text(300).min(1),
    decision: text(8000).min(1),
    rationale: text(8000).optional(),
  }),
  z.object({
    action: z.literal('git_request'),
    op: z.enum(['commit', 'push', 'pr_create', 'merge', 'deploy']),
    task_id: id,
    branch,
    message: text(5000).optional(),
    files,
    title: text(250).optional(),
    body: text(20_000).optional(),
    base: branch,
  }),
  z.object({
    action: z.literal('create_subtask'),
    parent_task_id: id,
    title: text(300).min(1),
    description: text(20_000),
    assign_to: slugRef.optional(),
    priority: z.enum(PRIORITIES).optional(),
  }),
]);

export function validateAgentAction(input: unknown): { ok: true; action: AgentAction } | { ok: false; error: string } {
  // strip keys the model may add that don't belong to the chosen action
  const r = agentActionSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, action: r.data as AgentAction };
}

export const workspaceSchema = z
  .object({
    repo: z.string().max(200).optional(),
    branch: z.string().max(200).optional(),
    commit: z.string().max(64).optional(),
    dirty_files: z.array(z.string().max(500)).max(200).optional(),
    ahead: z.number().int().optional(),
    behind: z.number().int().optional(),
  })
  .partial();

export const helloSchema = z.object({
  protocol: z.number().int(),
  client_version: text(200),
  runner: text(40),
  tools: z.array(text(80)).max(50),
  workspace: workspaceSchema,
});

export const heartbeatSchema = z.object({
  session_id: id,
  status: z.enum(SESSION_STATUSES as [string, ...string[]]),
  activity: text(500).optional(),
  current_task_id: id.nullable().optional(),
  workspace: workspaceSchema.optional(),
});

export const ackSchema = z.object({
  status: z.enum(['DONE', 'FAILED']),
  error: text(8000).optional(),
  result_text: text(100_000).optional(),
  provider_session_id: text(500).optional(),
  workspace: workspaceSchema.optional(),
  run: z
    .object({
      started_at: z.string().max(40),
      finished_at: z.string().max(40),
      output_chars: z.number().int().optional(),
      tokens_in: z.number().int().optional(),
      tokens_out: z.number().int().optional(),
      summary: text(500).optional(),
    })
    .optional(),
});

export const activitySchema = z.object({
  kind: z.enum(['log', 'thinking', 'tool', 'output']),
  text: text(2000),
  task_id: id.nullable().optional(),
});

export const commandResultSchema = z.object({
  approval_id: id.optional(),
  task_id: id,
  command: z.enum(['git_commit', 'git_push']),
  ok: z.boolean(),
  output: text(8000),
  commit: sha,
  branch: z.string().max(200).optional(),
});

/* ───────────────────────────── moderator (browser) inputs */
export const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const setupSchema = z.object({
  setup_token: z.string().min(1).max(200),
  email: z.string().email().max(200),
  display_name: text(80).min(1),
  password: z.string().min(12, 'Use at least 12 characters').max(200),
  project_name: text(80).min(1),
  project_key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, '2–10 uppercase letters/digits, starting with a letter'),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/name')
    .optional()
    .or(z.literal('')),
  default_branch: z.string().max(100).default('main'),
});

export const createTaskSchema = z.object({
  title: text(300).min(1),
  description: text(50_000).default(''),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  assigned_agent: id.nullable().optional(),
  parent_task_id: id.nullable().optional(),
  requires_human_approval: z.boolean().default(true),
});

export const userMessageSchema = z.object({
  task_id: id.nullable().optional(),
  to: z.union([id, z.literal('all'), z.literal('room')]),
  type: z.enum(USER_MESSAGE_TYPES as [string, ...string[]]).default('REQUEST'),
  content: text(60_000).min(1),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  reply_to: id.nullable().optional(),
});

export const taskControlSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('assign'), agent_id: id, note: text(5000).optional() }),
  z.object({ op: z.literal('status'), status: z.enum(TASK_STATUSES), note: text(2000).optional() }),
  z.object({ op: z.literal('pause') }),
  z.object({ op: z.literal('resume') }),
  z.object({ op: z.literal('cancel'), chain: z.boolean().default(true) }),
  z.object({ op: z.literal('approve'), note: text(2000).optional() }),
  z.object({ op: z.literal('reject'), note: text(2000).optional() }),
  z.object({ op: z.literal('request_review'), agent_id: id, note: text(5000).optional() }),
  z.object({ op: z.literal('continue'), agent_id: id.optional(), note: text(5000).optional() }),
  z.object({
    op: z.literal('update'),
    title: text(300).optional(),
    description: text(50_000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    requires_human_approval: z.boolean().optional(),
    current_branch: branch,
  }),
]);

export const approvalDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), note: text(2000).default('') });

export const projectUpdateSchema = z.object({
  name: text(80).min(1).optional(),
  description: text(2000).optional(),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .or(z.literal(''))
    .optional(),
  default_branch: z.string().max(100).optional(),
  mode: z.enum(MODES).optional(),
  max_auto_hops: z.number().int().min(1).max(200).optional(),
  default_reviewer: z.string().max(40).optional(),
  daily_token_budget: z.number().int().min(0).max(100_000_000).optional(),
  deploy_workflow: z.string().regex(/^[\w.-]+\.ya?ml$/).or(z.literal('')).optional(),
  tool_servers: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
        transport: z.enum(['stdio', 'http']),
        command: z.string().max(200).optional(),
        args: z.array(z.string().max(300)).max(30).optional(),
        url: z.string().url().max(500).optional(),
        env_vars: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/)).max(10).optional(),
        enabled: z.boolean(),
        description: z.string().max(300).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const agentUpsertSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  name: text(60).min(1),
  runtime: z.string().max(40),
  model: z.string().max(120).default(''),
  role: z.enum(['PRIMARY_BUILDER', 'AUDITOR_INTEGRATOR', 'RESEARCHER', 'GENERIC']).default('GENERIC'),
  role_label: text(80).default(''),
  description: text(1000).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#94a3b8'),
  enabled: z.boolean().default(true),
  config: z
    .object({
      base_url: z.string().url().max(500).optional().or(z.literal('')),
      api_key_env: z.string().max(64).optional().or(z.literal('')),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().min(64).max(64_000).optional(),
      office_style: z.enum(['builder', 'reviewer', 'researcher', 'generic']).optional(),
      system_prompt_extra: text(4000).optional(),
      mcp_tool: z.string().max(80).optional(),
    })
    .default({}),
});

export const agentControlSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('pause') }),
  z.object({ op: z.literal('resume') }),
  z.object({ op: z.literal('cancel_run') }),
  z.object({ op: z.literal('issue_token') }),
  z.object({ op: z.literal('revoke_token') }),
  z.object({
    op: z.literal('set_permission'),
    action: z.enum(PERMISSION_ACTIONS),
    allowed: z.boolean(),
    temporary_minutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
    reason: text(500).default(''),
  }),
  z.object({ op: z.literal('revoke_temporary'), action: z.enum(PERMISSION_ACTIONS) }),
]);

export const contextDocSchema = z.object({
  kind: z.enum(['rule', 'architecture', 'documentation', 'glossary', 'note', 'result']),
  title: text(200).min(1),
  content: text(20_000).min(1),
  pinned: z.boolean().default(false),
});

export const decisionUpdateSchema = z.object({ status: z.enum(['accepted', 'superseded', 'proposed']) });

export const systemControlSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('stop_all'), reason: text(500).default('') }),
  z.object({ op: z.literal('resume_all') }),
  z.object({ op: z.literal('mode'), mode: z.enum(MODES) }),
]);
