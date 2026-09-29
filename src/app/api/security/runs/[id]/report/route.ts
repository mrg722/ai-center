import { agentRoute, readJson } from '@/server/http/route';
import { securityRunReportSchema } from '@/server/validation';
import { reportSecurityRun } from '@/server/security/store';
import { emit } from '@/server/events/bus';
import { agentActor } from '@/server/orchestrator/actions';

export const dynamic = 'force-dynamic';

/** StrixRuntime bridge adapter only — see claim/route.ts. */
export const POST = agentRoute<{ id: string }>(async ({ req, db, agent, params }) => {
  const body = await readJson(req, securityRunReportSchema, 2 * 1024 * 1024);
  const findings = (body.findings ?? []).map((f) => ({ ...f, severity: f.severity ?? 'info' }));
  const run = await reportSecurityRun(db, agent.project_id, params.id, { status: body.status, summary: body.summary ?? '', error: body.error ?? '', findings });
  await emit(db, {
    project_id: agent.project_id,
    type: 'security.run_completed',
    actor: agentActor(agent),
    agent_id: agent.id,
    payload: { run_id: run.id, status: body.status, findings: findings.length },
  });
  return { run };
});
