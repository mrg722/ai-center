import type { Runner, RunInput, RunOutput } from './types.js';
import { runProcess, which } from './proc.js';

/**
 * Generic local agent: any CLI that reads a prompt on stdin and prints its
 * answer on stdout (aider, `ollama run <model>`, `llm`, a custom script...).
 * Configure with ACC_COMMAND="ollama run qwen2.5-coder" or "command": [...]
 * in acc-bridge.json. Executed without a shell.
 *
 * The runner exports ACC_TASK_ID; scripts that want to hand off can call the
 * orchestrator agent API with their own agent token (ACC_AGENT_TOKEN).
 */
export const commandRunner = (command: string[]): Runner => ({
  name: 'command',
  tools: () => [command[0] ?? 'command'],
  async check() {
    if (!command.length) return 'runner=command requires ACC_COMMAND or "command" in acc-bridge.json';
    return (await which(command[0])) ? null : `Command "${command[0]}" not found.`;
  },
  async run(input: RunInput): Promise<RunOutput> {
    input.onStatus('WORKING');
    const res = await runProcess({
      bin: command[0],
      args: [...command.slice(1), ...input.extraArgs],
      cwd: input.workspace,
      stdin: input.item.context.prompt,
      signal: input.signal,
      timeoutS: input.maxRunSeconds,
      env: { ACC_TASK_ID: input.item.task?.id ?? '' },
      onLine: (l) => input.onActivity('output', l.slice(0, 300)),
      onErrLine: (l) => input.onActivity('log', l.slice(0, 300)),
    });
    if (res.aborted) throw new Error('Run cancelled by orchestrator.');
    if (res.timedOut) throw new Error(`Run exceeded ${input.maxRunSeconds}s and was stopped.`);
    if (res.code !== 0) throw new Error(`${command[0]} exited with code ${res.code}: ${res.stderr.slice(-800)}`);
    return { text: res.stdout.trim() };
  },
});
