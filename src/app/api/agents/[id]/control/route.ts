import { after } from 'next/server';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { agentControlSchema } from '@/server/validation';
import { getAgent, requireProject } from '@/server/orchestrator/repo';
import {
  cancelAgentRun,
  issueToken,
  revokeTemporary,
  revokeToken,
  setAgentPaused,
  setPermission,
} from '@/server/orchestrator/moderator';
import { drainHostedQueue } from '@/server/orchestrator/hosted';

export const dynamic = 'force-dynamic';

export const POST = userRoute<{ id: string }>(
  async ({ req, db, user, params }) => {
    const body = await readJson(req, agentControlSchema);
    const project = await requireProject(db);
    const agent = await getAgent(db, params.id);
    if (agent.project_id !== project.id) throw new HttpError(404, 'agent not found');
    const actor = userActor(user);
    switch (body.op) {
      case 'pause':
        await setAgentPaused(db, agent, true, actor);
        return { ok: true };
      case 'resume':
        await setAgentPaused(db, agent, false, actor);
        after(() => drainHostedQueue());
        return { ok: true };
      case 'cancel_run':
        return { ok: true, cancelled: await cancelAgentRun(db, agent, actor) };
      case 'issue_token': {
        const token = await issueToken(db, agent, actor);
        // Returned once. The UI shows it with copy instructions; it is not retrievable later.
        return { ok: true, token };
      }
      case 'revoke_token':
        await revokeToken(db, agent, actor);
        return { ok: true };
      case 'set_permission':
        await setPermission(db, agent, actor, {
          action: body.action,
          allowed: body.allowed,
          temporaryMinutes: body.temporary_minutes,
          reason: body.reason ?? '',
        });
        return { ok: true };
      case 'revoke_temporary':
        await revokeTemporary(db, agent, actor, body.action);
        return { ok: true };
    }
  },
  { roles: ['owner', 'moderator'] },
);
