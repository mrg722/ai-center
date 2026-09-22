import type { Runner, RunInput, RunOutput } from './types.js';
import { runProcess, which } from './proc.js';

/**
 * Runs Google's Antigravity CLI in non-interactive print mode.
 * Authentication is handled by the user's local agy installation.
 */
export function buildAntigravityArgs(input: Pick<RunInput, 'agent' | 'extraArgs' | 'providerSessionId'>): string[] {
  const args = ['-p'];
  if (input.agent.model) args.push('--model', input.agent.model);
  if (input.providerSessionId) args.push('--conversation', input.providerSessionId);
  args.push(...input.extraArgs);
  return args;
}

interface AgyEvent {
  session_id?: string;
  conversation_id?: string;
  id?: string;
  type?: string;
  text?: string;
  result?: string;
  error?: string;
}

export const antigravityRunner = (bin = 'agy'): Runner => ({
  name: 'antigravity',
  tools: () => ['antigravity', 'mcp:acc'],
  async check() {
    return (await which(bin)) ? null : 'Antigravity CLI "agy" not found. Install it and sign in with Google OAuth.';
  },
  async run(input: RunInput): Promise<RunOutput> {
    let finalText = '';
    let sessionId: string | undefined;
    input.onStatus(input.item.message.message_type === 'REVIEW' ? 'REVIEWING' : 'THINKING');

    const res = await runProcess({
      bin,
      args: buildAntigravityArgs(input),
      cwd: input.workspace,
      stdin: input.item.context.prompt,
      signal: input.signal,
      timeoutS: input.maxRunSeconds,
      onLine: (line) => {
        let ev: AgyEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          if (line.trim()) {
            finalText = line.trim();
            input.onActivity('output', finalText.slice(0, 400));
          }
          return;
        }
        sessionId = ev.conversation_id ?? ev.session_id ?? ev.id ?? sessionId;
        if (ev.text) {
          finalText = ev.text;
          input.onActivity('output', ev.text.slice(0, 400));
        }
        if (ev.result) {
          finalText = ev.result;
          input.onActivity('output', ev.result.slice(0, 400));
        }
        if (ev.error) input.onActivity('log', ev.error.slice(0, 300));
        if (ev.type === 'tool' || ev.type === 'tool_call') input.onStatus('WORKING');
        if (ev.type === 'thinking' || ev.type === 'reasoning') input.onStatus('THINKING');
      },
      onErrLine: (line) => input.onActivity('log', line.slice(0, 300)),
    });

    if (res.aborted) throw new Error('Run cancelled by orchestrator.');
    if (res.timedOut) throw new Error(`Run exceeded ${input.maxRunSeconds}s and was stopped.`);
    if (res.code !== 0) throw new Error(`agy exited with code ${res.code}: ${res.stderr.slice(-1000)}`);
    return { text: finalText || res.stdout.trim(), providerSessionId: sessionId };
  },
});
