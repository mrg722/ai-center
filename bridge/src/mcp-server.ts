/**
 * "acc" MCP server (stdio). Started by Claude Code / Codex as a child process.
 *
 * It exposes the orchestrator's agent API as MCP tools so a CLI agent can
 * message other agents, hand off work, request reviews/approvals and git
 * operations — always THROUGH the orchestrator, which enforces permissions.
 *
 * Transport: JSON-RPC 2.0, newline-delimited, over stdin/stdout.
 * Auth: agent token read from a 0600 file (--token-file), never from argv.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { OrchestratorClient } from './client.js';
import { parseFlags } from './config.js';
import { MESSAGE_TYPES, TASK_STATUSES, APPROVAL_ACTIONS } from '../../src/shared/domain.js';
import type { AgentAction } from '../../src/shared/protocol';

type Json = Record<string, unknown>;
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
  toAction?: (args: Json, defaultTask?: string) => AgentAction;
  handler?: (args: Json) => Promise<unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const strArr = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const TASK = str('Task id (defaults to the task of the current run)');

export function buildTools(client: OrchestratorClient): ToolDef[] {
  const task = (a: Json, d?: string) => String(a.task_id ?? d ?? '');
  return [
    {
      name: 'acc_get_context',
      description: 'Get the current task context (task, recent conversation, git state, project rules).',
      inputSchema: { type: 'object', properties: { task_id: TASK } },
      handler: async (a) => (await client.context(a.task_id ? String(a.task_id) : process.env.ACC_TASK_ID)).prompt,
    },
    {
      name: 'acc_list_agents',
      description: 'List the agents in the Command Center with their role, status and permissions.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => client.roster(),
    },
    {
      name: 'acc_send_message',
      description:
        'Send a message to another agent, the moderator, or everyone. The orchestrator routes it; you never contact agents directly.',
      inputSchema: {
        type: 'object',
        required: ['to', 'type', 'content'],
        properties: {
          to: str('Agent slug (e.g. "gpt"), "moderator" or "all"'),
          type: { type: 'string', enum: MESSAGE_TYPES.filter((t) => !['COMMAND', 'NOTE', 'TASK'].includes(t)) },
          content: str('Message body (markdown)'),
          task_id: TASK,
          reply_to: str('Message id this replies to'),
          files: strArr('Relevant file paths'),
          requires_action: { type: 'boolean' },
        },
      },
      toAction: (a, d) => ({
        action: 'send_message',
        to: String(a.to),
        type: String(a.type) as never,
        content: String(a.content),
        task_id: a.task_id ? String(a.task_id) : d,
        reply_to: a.reply_to ? String(a.reply_to) : undefined,
        files: a.files as string[] | undefined,
        requires_action: Boolean(a.requires_action),
      }),
    },
    {
      name: 'acc_handoff',
      description: 'Hand the current task over to another agent (e.g. builder → auditor). May require moderator approval.',
      inputSchema: {
        type: 'object',
        required: ['to', 'content'],
        properties: { to: str('Target agent slug'), content: str('What you did and what they should do'), task_id: TASK, files: strArr('Files touched') },
      },
      toAction: (a, d) => ({ action: 'handoff', to: String(a.to), task_id: task(a, d), content: String(a.content), files: a.files as string[] }),
    },
    {
      name: 'acc_request_review',
      description: 'Ask another agent (default: the auditor) to review your changes.',
      inputSchema: {
        type: 'object',
        required: ['content'],
        properties: { to: str('Reviewer agent slug (optional)'), content: str('What to review'), task_id: TASK, files: strArr('Files to review'), commit: str('Commit sha') },
      },
      toAction: (a, d) => ({
        action: 'request_review',
        to: a.to ? String(a.to) : undefined,
        task_id: task(a, d),
        content: String(a.content),
        files: a.files as string[],
        commit: a.commit ? String(a.commit) : undefined,
      }),
    },
    {
      name: 'acc_request_approval',
      description: 'Ask the human moderator to approve something before you proceed.',
      inputSchema: {
        type: 'object',
        required: ['approval', 'title', 'detail'],
        properties: { approval: { type: 'string', enum: [...APPROVAL_ACTIONS] }, title: str('Short title'), detail: str('Why / what exactly'), task_id: TASK },
      },
      toAction: (a, d) => ({
        action: 'request_approval',
        approval: String(a.approval) as never,
        title: String(a.title),
        detail: String(a.detail),
        task_id: a.task_id ? String(a.task_id) : d,
      }),
    },
    {
      name: 'acc_update_task',
      description: 'Update task status, summary, branch/commit or created/modified files.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: TASK,
          status: { type: 'string', enum: [...TASK_STATUSES] },
          context_summary: str('Concise summary of progress so far'),
          current_branch: str('Branch'),
          current_commit: str('Commit sha'),
          created_files: strArr('Files created'),
          modified_files: strArr('Files modified'),
          related_commits: strArr('Commit shas'),
        },
      },
      toAction: (a, d) => ({ action: 'update_task', ...(a as object), task_id: task(a, d) }) as AgentAction,
    },
    {
      name: 'acc_record_review',
      description: 'Record the result of a code review you performed.',
      inputSchema: {
        type: 'object',
        required: ['verdict', 'summary'],
        properties: {
          task_id: TASK,
          verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'] },
          summary: str('Review summary'),
          commit: str('Reviewed commit'),
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['note'],
              properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string' }, note: { type: 'string' } },
            },
          },
        },
      },
      toAction: (a, d) => ({ action: 'record_review', ...(a as object), task_id: task(a, d) }) as AgentAction,
    },
    {
      name: 'acc_propose_decision',
      description: 'Propose an architectural/technical decision for the permanent project memory (moderator accepts it).',
      inputSchema: {
        type: 'object',
        required: ['title', 'decision'],
        properties: { title: str('Title'), decision: str('The decision'), rationale: str('Why'), task_id: TASK },
      },
      toAction: (a, d) => ({
        action: 'propose_decision',
        title: String(a.title),
        decision: String(a.decision),
        rationale: a.rationale ? String(a.rationale) : undefined,
        task_id: a.task_id ? String(a.task_id) : d,
      }),
    },
    {
      name: 'acc_git_request',
      description:
        'Request a git operation. commit/push are executed by the bridge after the orchestrator checks permissions and (if needed) moderator approval. Never run git commit/push yourself.',
      inputSchema: {
        type: 'object',
        required: ['op'],
        properties: {
          op: { type: 'string', enum: ['commit', 'push', 'pr_create', 'merge', 'deploy'] },
          task_id: TASK,
          message: str('Commit message'),
          files: strArr('Files to stage (default: all changes)'),
          branch: str('Branch to push / PR head'),
          title: str('PR title'),
          body: str('PR body'),
          base: str('PR base branch'),
        },
      },
      toAction: (a, d) => ({ action: 'git_request', ...(a as object), task_id: task(a, d) }) as AgentAction,
    },
    {
      name: 'acc_create_subtask',
      description: 'Create a sub-task, optionally assigned to another agent.',
      inputSchema: {
        type: 'object',
        required: ['title', 'description'],
        properties: { parent_task_id: TASK, title: str('Title'), description: str('Description'), assign_to: str('Agent slug') },
      },
      toAction: (a, d) => ({
        action: 'create_subtask',
        parent_task_id: String(a.parent_task_id ?? d ?? ''),
        title: String(a.title),
        description: String(a.description),
        assign_to: a.assign_to ? String(a.assign_to) : undefined,
      }),
    },
  ];
}

export async function runMcpServer(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const url = flags.url ?? process.env.ACC_URL ?? 'http://localhost:3000';
  const tokenFile = flags['token-file'] ?? process.env.ACC_AGENT_TOKEN_FILE;
  const token = (tokenFile ? readFileSync(tokenFile, 'utf8') : (process.env.ACC_AGENT_TOKEN ?? '')).trim();
  const defaultTask = flags['task-id'] ?? process.env.ACC_TASK_ID ?? undefined;
  const client = new OrchestratorClient(url.replace(/\/$/, ''), token);
  const tools = buildTools(client);

  const send = (obj: Json) => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req: { id?: string | number; method?: string; params?: Json };
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const { id, method, params } = req;
    if (id === undefined) return; // notification
    try {
      switch (method) {
        case 'initialize':
          send({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'acc', version: '0.1.0' },
              instructions:
                'AI Command Center orchestrator. Use these tools to coordinate with other AI agents and the human moderator.',
            },
          });
          break;
        case 'ping':
          send({ jsonrpc: '2.0', id, result: {} });
          break;
        case 'tools/list':
          send({
            jsonrpc: '2.0',
            id,
            result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
          });
          break;
        case 'tools/call': {
          const name = String(params?.name ?? '');
          const args = (params?.arguments ?? {}) as Json;
          const tool = tools.find((t) => t.name === name);
          if (!tool) {
            send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${name}` } });
            break;
          }
          try {
            const out = tool.handler ? await tool.handler(args) : await client.action(tool.toAction!(args, defaultTask));
            const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
            const isError = typeof out === 'object' && out !== null && (out as { ok?: boolean }).ok === false;
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError } });
          } catch (e) {
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String((e as Error).message) }], isError: true } });
          }
          break;
        }
        default:
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: String((e as Error).message) } });
    }
  });
  await new Promise<void>((resolve) => rl.on('close', () => resolve()));
}
