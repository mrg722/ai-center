/**
 * Hosted (API) agents cannot call MCP tools, so they express actions with a
 * fenced block in their reply:
 *
 *   ```acc-actions
 *   [{"action":"request_review","to":"gpt","content":"please audit"}]
 *   ```
 *
 * This parser extracts those blocks and returns the visible text without
 * them. Validation of each action happens later (schema + policy).
 */
export interface ParsedReply {
  text: string;
  actions: unknown[];
  errors: string[];
}

const BLOCK = /```acc-actions\s*\n([\s\S]*?)```/g;

export function parseAgentReply(raw: string): ParsedReply {
  const actions: unknown[] = [];
  const errors: string[] = [];
  const text = raw
    .replace(BLOCK, (_m, body: string) => {
      try {
        const parsed = JSON.parse(body.trim());
        if (Array.isArray(parsed)) actions.push(...parsed.slice(0, 10));
        else if (parsed && typeof parsed === 'object') actions.push(parsed);
        else errors.push('acc-actions block must contain an object or array');
      } catch (e) {
        errors.push(`invalid acc-actions JSON: ${(e as Error).message}`);
      }
      return '';
    })
    .trim();
  return { text, actions, errors };
}

export const ACTION_PROTOCOL_HELP = `To act, end your reply with ONE fenced block:
\`\`\`acc-actions
[{"action":"send_message","to":"<agent-slug|moderator|all>","type":"QUESTION|ANSWER|PROPOSAL|WARNING|STATUS|RESULT","content":"..."},
 {"action":"request_review","to":"<agent-slug>","content":"..."},
 {"action":"handoff","to":"<agent-slug>","content":"..."},
 {"action":"record_review","verdict":"APPROVED|CHANGES_REQUESTED|COMMENTED","summary":"...","findings":[{"file":"...","note":"..."}]},
 {"action":"propose_decision","title":"...","decision":"...","rationale":"..."},
 {"action":"update_task","status":"IN_PROGRESS|WAITING_REVIEW|WAITING_USER|BLOCKED|COMPLETED","context_summary":"..."}]
\`\`\`
task_id defaults to the current task. Omit the block if no action is needed; your reply text is posted to the conversation automatically.`;
