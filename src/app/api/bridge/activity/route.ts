import { agentRoute, readJson } from '@/server/http/route';
import { activitySchema } from '@/server/validation';
import { bridgeActivity } from '@/server/orchestrator/bridge';

export const dynamic = 'force-dynamic';

/** Ephemeral live activity (tool use, partial output). Not persisted. */
export const POST = agentRoute(async ({ req, agent }) => {
  const body = await readJson(req, activitySchema, 8 * 1024);
  await bridgeActivity(agent, body.kind, body.text, body.task_id ?? null);
  return { ok: true };
});
