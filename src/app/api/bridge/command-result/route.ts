import { agentRoute, readJson } from '@/server/http/route';
import { commandResultSchema } from '@/server/validation';
import { bridgeCommandResult } from '@/server/orchestrator/bridge';

export const dynamic = 'force-dynamic';

export const POST = agentRoute(async ({ req, db, agent }) => {
  const body = await readJson(req, commandResultSchema, 32 * 1024);
  await bridgeCommandResult(db, agent, body);
  return { ok: true };
});
