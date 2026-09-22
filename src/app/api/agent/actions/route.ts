import { after } from 'next/server';
import { agentRoute, readJson, HttpError } from '@/server/http/route';
import { validateAgentAction } from '@/server/validation';
import { executeAgentAction } from '@/server/orchestrator/actions';
import { drainHostedQueue } from '@/server/orchestrator/hosted';
import { LIMITS } from '@/server/security/rate-limit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * The single entry point for agent→orchestrator requests (MCP tools call
 * this). Every action is schema-validated, then policy-checked.
 */
export const POST = agentRoute(
  async ({ req, db, agent }) => {
    const raw = await readJson(req, z.unknown(), 256 * 1024);
    const v = validateAgentAction(raw);
    if (!v.ok) throw new HttpError(400, v.error);
    const result = await executeAgentAction(db, agent, v.action);
    after(() => drainHostedQueue());
    return result;
  },
  { limit: LIMITS.agentAction },
);
