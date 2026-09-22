import { getDb } from '@/server/db';
import { publicRoute, HttpError } from '@/server/http/route';
import { env } from '@/server/env';
import { verifyGithubSignature } from '@/server/security/crypto';
import { getCurrentProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { clearGithubCache } from '@/server/github/client';
import { LIMITS } from '@/server/security/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GitHub webhook (push, pull_request, issues, check_run…).
 * - HMAC SHA-256 signature verified against GITHUB_WEBHOOK_SECRET.
 * - Payload text is UNTRUSTED: only a few structured fields are stored, and
 *   anything textual that reaches an agent is wrapped as <untrusted_data>.
 */
export const POST = publicRoute(
  async ({ req }) => {
    const secret = env.githubWebhookSecret;
    if (!secret) throw new HttpError(503, 'webhook secret not configured');
    const raw = await req.text();
    if (raw.length > 2_000_000) throw new HttpError(413, 'payload too large');
    if (!verifyGithubSignature(raw, req.headers.get('x-hub-signature-256'), secret)) throw new HttpError(401, 'bad signature');
    const event = req.headers.get('x-github-event') ?? 'unknown';
    const body = JSON.parse(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const db = await getDb();
    const project = await getCurrentProject(db);
    if (!project) return { ok: true, ignored: 'no project' };
    const repo = body.repository?.full_name as string | undefined;
    if (repo && project.repo_owner && `${project.repo_owner}/${project.repo_name}`.toLowerCase() !== repo.toLowerCase()) {
      return { ok: true, ignored: 'other repository' };
    }
    clearGithubCache();
    const payload: Record<string, unknown> = { event, action: body.action ?? null, repo: repo ?? null };
    if (event === 'push') {
      payload.ref = body.ref;
      payload.after = body.after;
      payload.commits = Array.isArray(body.commits) ? body.commits.length : 0;
      payload.pusher = body.pusher?.name;
    } else if (event === 'pull_request') {
      payload.number = body.number;
      payload.title = String(body.pull_request?.title ?? '').slice(0, 200);
      payload.merged = Boolean(body.pull_request?.merged);
      payload.head = body.pull_request?.head?.ref;
    } else if (event === 'issues') {
      payload.number = body.issue?.number;
      payload.title = String(body.issue?.title ?? '').slice(0, 200);
    }
    await emit(db, { project_id: project.id, type: `github.${event}`, actor: { kind: 'system' }, payload });
    return { ok: true };
  },
  { key: 'webhook', limit: LIMITS.webhook },
);
