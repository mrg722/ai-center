import { getDb } from '@/server/db';
import { publicRoute, readJson, HttpError } from '@/server/http/route';
import { setupSchema } from '@/server/validation';
import { needsSetup, runSetup } from '@/server/orchestrator/setup';
import { createSession } from '@/server/auth/session';
import { env } from '@/server/env';
import { safeEqual } from '@/server/security/crypto';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(
  async () => {
    const db = await getDb();
    return { needs_setup: await needsSetup(db), setup_token_configured: Boolean(env.setupToken) };
  },
  { key: 'setup-get', limit: { limit: 60, windowMs: 60_000 } },
);

/**
 * First-run bootstrap. Requires SETUP_TOKEN (from the server environment) so
 * nobody who merely finds the URL can claim the instance. Works only once.
 */
export const POST = publicRoute(
  async ({ req }) => {
    const body = await readJson(req, setupSchema, 8192);
    const expected = env.setupToken;
    if (!expected) throw new HttpError(503, 'SETUP_TOKEN is not configured on the server.');
    if (!safeEqual(body.setup_token, expected)) throw new HttpError(403, 'invalid setup token');
    const db = await getDb();
    if (!(await needsSetup(db))) throw new HttpError(409, 'setup already completed');
    const { userId, project } = await runSetup(db, {
      email: body.email,
      display_name: body.display_name,
      password: body.password,
      project_name: body.project_name,
      project_key: body.project_key,
      repo: body.repo || undefined,
      default_branch: body.default_branch,
    });
    await createSession({ id: userId, session_version: 1 });
    return { ok: true, project_id: project.id };
  },
  { key: 'setup', limit: { limit: 10, windowMs: 15 * 60_000 }, checkOrigin: true },
);
