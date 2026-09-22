import { agentRoute, readJson } from '@/server/http/route';
import { ackSchema } from '@/server/validation';
import { completeDelivery } from '@/server/orchestrator/runs';
import { updateWorkspace } from '@/server/orchestrator/bridge';
import type { WorkspaceState } from '@/shared/protocol';

export const dynamic = 'force-dynamic';

export const POST = agentRoute<{ id: string }>(async ({ req, db, agent, params }) => {
  const body = await readJson(req, ackSchema, 256 * 1024);
  await updateWorkspace(db, agent, body.workspace as WorkspaceState | undefined);
  await completeDelivery(db, agent, params.id, {
    status: body.status,
    resultText: body.result_text,
    error: body.error,
    tokensIn: body.run?.tokens_in,
    tokensOut: body.run?.tokens_out,
    outputChars: body.run?.output_chars,
    summary: body.run?.summary,
  });
  return { ok: true };
});
