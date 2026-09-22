import { agentRoute, readJson } from '@/server/http/route';
import { heartbeatSchema } from '@/server/validation';
import { bridgeHeartbeat } from '@/server/orchestrator/bridge';
import type { HeartbeatRequest } from '@/shared/protocol';

export const dynamic = 'force-dynamic';

export const POST = agentRoute(async ({ req, db, agent }) => {
  const body = await readJson(req, heartbeatSchema, 64 * 1024);
  return bridgeHeartbeat(db, agent, body as HeartbeatRequest);
});
