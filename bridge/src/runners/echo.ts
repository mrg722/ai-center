import type { Runner, RunInput, RunOutput } from './types.js';
import type { AgentAction } from '../../../src/shared/protocol';
import { MESSAGE_TYPES, type MessageType } from '../../../src/shared/domain.js';

/**
 * ECHO RUNNER — infrastructure test harness, NOT an AI.
 *
 * It lets you verify the whole pipeline (auth → presence → delivery → agent
 * actions → approvals → UI) without spending tokens. Every reply is clearly
 * labelled "[echo runner]". It understands a few slash directives, one per
 * line, inside the message it receives:
 *
 *   /handoff <agent> <text>      → HANDOFF to another agent via orchestrator
 *   /review <agent> <text>       → review request
 *   /say <agent|moderator|all> <TYPE> <text>
 *   /commit <message>            → git_request commit
 *   /push <branch>               → git_request push
 *   /status <TASK_STATUS>        → update_task status
 *   /sleep <seconds>             → simulate a long run (max 30 s)
 */
export const echoRunner = (): Runner => ({
  name: 'echo',
  tools: () => ['echo-test-harness'],
  async check() {
    return null;
  },
  async run(input: RunInput): Promise<RunOutput> {
    const msg = input.item.message;
    const taskId = input.item.task?.id;
    input.onStatus(msg.message_type === 'REVIEW' ? 'REVIEWING' : 'WORKING');
    const results: string[] = [];

    for (const raw of msg.content.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('/')) continue;
      const [cmd, ...rest] = line.split(/\s+/);
      let action: AgentAction | null = null;
      switch (cmd) {
        case '/sleep': {
          const s = Math.min(30, Math.max(0, Number(rest[0]) || 1));
          input.onActivity('thinking', `sleeping ${s}s`);
          await sleep(s * 1000, input.signal);
          results.push(`slept ${s}s`);
          continue;
        }
        case '/handoff':
          if (taskId) action = { action: 'handoff', to: rest[0], task_id: taskId, content: rest.slice(1).join(' ') || 'handoff' };
          break;
        case '/review':
          if (taskId)
            action = { action: 'request_review', to: rest[0], task_id: taskId, content: rest.slice(1).join(' ') || 'please review' };
          break;
        case '/say': {
          const type = (rest[1] ?? 'STATUS').toUpperCase() as MessageType;
          action = {
            action: 'send_message',
            to: rest[0],
            type: MESSAGE_TYPES.includes(type) ? type : 'STATUS',
            content: rest.slice(2).join(' ') || '(empty)',
            task_id: taskId,
          };
          break;
        }
        case '/commit':
          if (taskId) action = { action: 'git_request', op: 'commit', task_id: taskId, message: rest.join(' ') || 'echo commit' };
          break;
        case '/push':
          if (taskId) action = { action: 'git_request', op: 'push', task_id: taskId, branch: rest[0] };
          break;
        case '/status':
          if (taskId) action = { action: 'update_task', task_id: taskId, status: rest[0] as never };
          break;
      }
      if (!action) {
        results.push(`${cmd}: ignored (unknown directive or no task)`);
        continue;
      }
      input.onActivity('tool', `${cmd} ${rest.join(' ').slice(0, 80)}`);
      const r = await input.api(action);
      results.push(`${cmd} → ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`);
    }

    const text =
      `[echo runner] ${input.agent.name} received ${msg.message_type} from ${msg.from}` +
      (input.item.task ? ` on ${input.item.task.key}` : '') +
      `. No AI model is attached to this bridge.` +
      (results.length ? `\n\nDirectives:\n- ${results.join('\n- ')}` : '');
    return { text, tokens_in: 0, tokens_out: 0 };
  },
});

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Run cancelled by orchestrator.'));
      },
      { once: true },
    );
  });
}
