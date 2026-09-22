import { userRoute } from '@/server/http/route';
import { requireProject } from '@/server/orchestrator/repo';
import { snapshot } from '@/server/orchestrator/state';

export const dynamic = 'force-dynamic';

export const GET = userRoute(async ({ db, user }) => {
  const project = await requireProject(db);
  return { ...(await snapshot(db, project)), me: user };
});
