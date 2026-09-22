import { agentRoute, readJson } from '@/server/http/route';
import { helloSchema } from '@/server/validation';
import { bridgeHello } from '@/server/orchestrator/bridge';
import type { HelloRequest } from '@/shared/protocol';

export const dynamic = 'force-dynamic';

export const POST = agentRoute(async ({ req, db, agent }) => {
  const body = await readJson(req, helloSchema, 64 * 1024);
  return bridgeHello(db, agent, body as HelloRequest);
});
