import { agentRoute, readJson } from '@/server/http/route';
import { securityRunClaimSchema } from '@/server/validation';
import { claimSecurityRun } from '@/server/security/store';
import { emit } from '@/server/events/bus';
import { agentActor } from '@/server/orchestrator/actions';

export const dynamic = 'force-dynamic';

/**
 * StrixRuntime bridge adapter only — a bridge agent token claims the next
 * queued run for its own project. Never reachable from the browser/UI and
 * never invoked from hosted infra (see docs/ARCHITECTURE_AI_PLATFORM.md
 * § Security Lab: Strix runs exclusively via the Local Bridge).
 */
export const POST = agentRoute<{ id: string }>(async ({ req, db, agent, params }) => {
  const body = await readJson(req, securityRunClaimSchema);
  const run = await claimSecurityRun(db, agent.project_id, params.id, body.bridge_run_name);
  await emit(db, { project_id: agent.project_id, type: 'security.run_started', actor: agentActor(agent), agent_id: agent.id, payload: { run_id: run.id } });
  return { run };
});
