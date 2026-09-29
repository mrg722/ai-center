import { userRoute } from '@/server/http/route';
import { requireProject } from '@/server/orchestrator/repo';
import { repoStatus } from '@/server/github/client';

export const dynamic = 'force-dynamic';

export const GET = userRoute(async ({ db, user }) => {
  const project = await requireProject(db, user.id);
  return repoStatus(project);
});
