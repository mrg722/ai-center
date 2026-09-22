import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner, RunInput, RunOutput } from './types.js';
import { runProcess, which } from './proc.js';

/** TOML string literal (basic string, escaped). */
const tomlStr = (s: string) => JSON.stringify(s);

/**
 * Runs OpenAI Codex CLI non-interactively (`codex exec`).
 *
 * - Prompt goes through stdin (`codex exec -`).
 * - Sandbox is derived from permissions: workspace-write or read-only.
 * - The ACC MCP server is injected with `-c mcp_servers.acc.*` overrides; the
 *   agent token is passed as a 0600 token FILE path, never on argv.
 * - Final answer is read from `--output-last-message`.
 */
export function buildCodexArgs(input: Pick<RunInput, 'agent' | 'mcpServer' | 'extraArgs'>, lastMsgFile: string): string[] {
  const p = input.agent.permissions;
  const args = ['exec', '--json', '--sandbox', p.write ? 'workspace-write' : 'read-only', '-o', lastMsgFile];
  if (input.agent.model) args.push('--model', input.agent.model);
  if (input.mcpServer) {
    args.push('-c', `mcp_servers.acc.command=${tomlStr(input.mcpServer.command)}`);
    args.push('-c', `mcp_servers.acc.args=[${input.mcpServer.args.map(tomlStr).join(',')}]`);
  }
  args.push(...input.extraArgs, '-');
  return args;
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string; command?: string; status?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

export const codexRunner = (bin = 'codex'): Runner => ({
  name: 'codex',
  tools: () => ['codex', 'mcp:acc'],
  async check() {
    return (await which(bin)) ? null : `Codex CLI "${bin}" not found. Install it and log in (codex login).`;
  },
  async run(input: RunInput): Promise<RunOutput> {
    const dir = mkdtempSync(join(tmpdir(), 'acc-codex-'));
    const lastMsg = join(dir, 'last.txt');
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let lastAgentText = '';
    const reviewing = input.item.message.message_type === 'REVIEW';
    input.onStatus(reviewing ? 'REVIEWING' : 'THINKING');
    try {
      const res = await runProcess({
        bin,
        args: buildCodexArgs(input, lastMsg),
        cwd: input.workspace,
        stdin: input.item.context.prompt,
        signal: input.signal,
        timeoutS: input.maxRunSeconds,
        onLine: (line) => {
          let ev: CodexEvent;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          const t = ev.type ?? '';
          if (t === 'item.started' || t === 'item.completed') {
            const it = ev.item ?? {};
            if (it.type === 'reasoning') input.onStatus('THINKING');
            else if (it.type === 'command_execution') {
              input.onStatus(reviewing ? 'REVIEWING' : 'WORKING');
              input.onActivity('tool', `shell ${String(it.command ?? '').slice(0, 160)}`);
            } else if (it.type === 'file_change' || it.type === 'file_changes') {
              input.onStatus('WORKING');
              input.onActivity('tool', 'editing files');
            } else if (it.type === 'mcp_tool_call') {
              input.onActivity('tool', 'mcp tool call');
            } else if (it.type === 'agent_message' && it.text) {
              lastAgentText = it.text;
              input.onActivity('output', it.text.slice(0, 400));
            }
          } else if (t === 'turn.completed') {
            tokensIn = ev.usage?.input_tokens;
            tokensOut = ev.usage?.output_tokens;
          } else if (t === 'error' || t === 'turn.failed') {
            input.onActivity('log', ev.error?.message ?? ev.message ?? 'codex error');
          }
        },
        onErrLine: (l) => input.onActivity('log', l.slice(0, 300)),
      });
      if (res.aborted) throw new Error('Run cancelled by orchestrator.');
      if (res.timedOut) throw new Error(`Run exceeded ${input.maxRunSeconds}s and was stopped.`);
      let text = '';
      try {
        text = readFileSync(lastMsg, 'utf8');
      } catch {
        text = lastAgentText;
      }
      if (res.code !== 0) throw new Error(`codex exited with code ${res.code}: ${res.stderr.slice(-1000)}`);
      return { text: text || lastAgentText, tokens_in: tokensIn, tokens_out: tokensOut };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
