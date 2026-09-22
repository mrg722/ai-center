import { getDb } from '@/server/db';
import { publicRoute, readJson, HttpError } from '@/server/http/route';
import { loginSchema } from '@/server/validation';
import { verifyPassword } from '@/server/security/crypto';
import { createSession } from '@/server/auth/session';
import { LIMITS } from '@/server/security/rate-limit';
import type { UserRow } from '@/server/types';

export const dynamic = 'force-dynamic';

export const POST = publicRoute(
  async ({ req }) => {
    const body = await readJson(req, loginSchema, 4096);
    const db = await getDb();
    const r = await db.query<UserRow>('select * from users where lower(email)=lower($1)', [body.email]);
    const u = r.rows[0];
    // constant-ish time: always run a verification
    const ok = await verifyPassword(body.password, u?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
    if (!u || !ok) throw new HttpError(401, 'invalid email or password');
    await db.query('update users set last_login_at=now() where id=$1', [u.id]);
    await createSession(u);
    return { ok: true, user: { id: u.id, display_name: u.display_name, role: u.role } };
  },
  { key: 'login', limit: LIMITS.login, checkOrigin: true },
);
