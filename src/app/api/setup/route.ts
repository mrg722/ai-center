import { getDb } from '@/server/db';
import { publicRoute, readJson, HttpError } from '@/server/http/route';
import { setupSchema } from '@/server/validation';
import { needsSetup, runSetup } from '@/server/orchestrator/setup';
import { createSession } from '@/server/auth/session';
import { env } from '@/server/env';
import { safeEqual } from '@/server/security/crypto';
import type { UserRow } from '@/server/types';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(
  async () => {
    const db = await getDb();
    return { needs_setup: await needsSetup(db), setup_token_configured: Boolean(env.setupToken) };
  },
  { key: 'setup-get', limit: { limit: 60, windowMs: 60_000 } },
);

export const POST = publicRoute(
  async ({ req }) => {
    const body = await readJson(req, setupSchema, 8192);
    const expected = env.setupToken;
    if (!expected && env.isProduction) throw new HttpError(503, 'setup is locked until SETUP_TOKEN is configured on the server');
    if (expected && !safeEqual(body.setup_token, expected)) throw new HttpError(403, 'invalid setup token');
    if (!expected && !body.setup_token.trim()) throw new HttpError(403, 'setup token required');
    const db = await getDb();
    if (!(await needsSetup(db))) throw new HttpError(409, 'setup already completed');
    const { userId, project } = await runSetup(db, {
      email: body.email,
      display_name: body.display_name,
      password: body.password,
      project_name: body.project_name,
      project_key: body.project_key,
      repo: body.repo || undefined,
      default_branch: body.default_branch ?? 'main',
    });
    const result = await db.query<UserRow>('select id, email, display_name, role, session_version from users where id=$1', [userId]);
    const user = result.rows[0];
    if (!user) throw new HttpError(500, 'setup user was not created');
    await createSession(user);
    return { ok: true, project_id: project.id };
  },
  { key: 'setup', limit: { limit: 10, windowMs: 15 * 60_000 }, checkOrigin: true },
);
