import { after } from 'next/server';
import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { approvalDecisionSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { decideApproval, getApprovalForProject } from '@/server/orchestrator/moderator';
import { drainHostedQueue } from '@/server/orchestrator/hosted';

export const dynamic = 'force-dynamic';

export const POST = userRoute<{ id: string }>(async ({ req, db, user, params }) => {
  const body = await readJson(req, approvalDecisionSchema);
  const project = await requireProject(db);
  const approval = await getApprovalForProject(db, project, params.id);
  const out = await decideApproval(db, project, approval, userActor(user), body.decision === 'approve', body.note ?? '');
  after(() => drainHostedQueue());
  return { ok: true, ...out };
});
