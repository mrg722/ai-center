import { agentRoute } from '@/server/http/route';
import { bridgeInbox } from '@/server/orchestrator/bridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Long-poll inbox (≤25 s). Returns at most one delivery at a time. */
export const GET = agentRoute(async ({ req, db, agent }) => {
  const wait = Number(req.nextUrl.searchParams.get('wait') ?? 20);
  return bridgeInbox(db, agent, Number.isFinite(wait) ? wait : 20, req.signal);
});
