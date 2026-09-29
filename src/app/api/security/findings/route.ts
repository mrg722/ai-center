import { z } from 'zod';
import { userRoute } from '@/server/http/route';
import { requireProject } from '@/server/orchestrator/repo';
import { listFindings } from '@/server/security/store';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'confirmed', 'false_positive', 'fixed']).optional(),
  security_run_id: z.string().uuid().optional(),
});

export const GET = userRoute(async ({ req, db, user }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const project = await requireProject(db, user.id);
  const findings = await listFindings(db, project.id, { severity: q.severity, status: q.status, securityRunId: q.security_run_id });
  return { findings, total: findings.length };
});
