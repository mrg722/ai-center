import { agentRoute } from '@/server/http/route';
import { agentViews, getProjectById } from '@/server/orchestrator/repo';

export const dynamic = 'force-dynamic';

/** What an agent may know about its teammates (no config, no tokens). */
export const GET = agentRoute(async ({ db, agent }) => {
  const project = await getProjectById(db, agent.project_id);
  const views = await agentViews(db, project);
  return {
    you: agent.slug,
    mode: project.mode,
    agents: views.map((v) => ({
      slug: v.slug,
      name: v.name,
      role: v.role_label || v.role,
      status: v.status,
      provider: v.provider.name,
      runtime: v.runtime_label,
      transport: v.transport,
      capabilities: v.capabilities,
      permissions: v.permissions,
    })),
  };
});
