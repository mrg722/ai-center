import 'server-only';
import { cookies } from 'next/headers';
import type { Db } from '../db';
import type { Actor, UserRow } from '../types';
import { env } from '../env';
import { sign, unsign } from '../security/crypto';

export const SESSION_COOKIE = 'acc_session';
const MAX_AGE_S = 60 * 60 * 24 * 7;

interface SessionPayload {
  uid: string;
  v: number;
  exp: number;
  email?: string;
  display_name?: string;
  role?: UserRow['role'];
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRow['role'];
}

export async function createSession(user: Pick<UserRow, 'id' | 'session_version' | 'email' | 'display_name' | 'role'>): Promise<void> {
  const token = sign({
    uid: user.id,
    v: user.session_version,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_S,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
  } satisfies SessionPayload, env.sessionSecret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.isProduction,
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionUser(db: Db): Promise<SessionUser | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const p = unsign<SessionPayload>(raw, env.sessionSecret);
  if (!p || p.exp < Date.now() / 1000) return null;

  if (!env.databaseUrl && env.isProduction && p.email && p.display_name && p.role) {
    return { id: p.uid, email: p.email, display_name: p.display_name, role: p.role };
  }

  const r = await db.query<UserRow>('select id, email, display_name, role, session_version from users where id=$1', [p.uid]);
  const u = r.rows[0];
  if (!u || u.session_version !== p.v) return null;
  return { id: u.id, email: u.email, display_name: u.display_name, role: u.role };
}

export function userActor(u: SessionUser): Extract<Actor, { kind: 'user' }> {
  return { kind: 'user', id: u.id, name: u.display_name };
}
