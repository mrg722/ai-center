import { agentRoute } from '@/server/http/route';
import { listQueuedSecurityRuns } from '@/server/security/store';

export const dynamic = 'force-dynamic';

/** StrixRuntime bridge adapter polling target — see claim/report routes. */
export const GET = agentRoute(async ({ db, agent }) => {
  const runs = await listQueuedSecurityRuns(db, agent.project_id);
  return { runs };
});
