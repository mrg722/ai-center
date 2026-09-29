import 'server-only';
import { cookies } from 'next/headers';
import type { Db } from '../db';
import { env } from '../env';
import { hashPassword, sign, unsign, verifyPassword } from './crypto';
import { BadRequest, Forbidden, getProjectById } from '../orchestrator/repo';

/**
 * Security Lab second factor (Bloque 9 lockdown). Strix performs REAL active
 * exploitation, not a passive scan — access is owner-only (enforced by
 * `roles: ['owner']` on every /api/security/* route) AND requires this PIN,
 * a separate secret from the owner's login password so a leaked session
 * cookie alone can't reach it. The PIN is never stored or logged in
 * plaintext (scrypt, same scheme as user passwords) and is never hardcoded
 * anywhere in this codebase — the owner sets it themselves from the UI.
 */

const UNLOCK_COOKIE = 'acc_security_unlock';
const UNLOCK_TTL_S = 2 * 60 * 60; // 2h — re-enter the PIN periodically, not once per browser lifetime

interface UnlockPayload {
  project_id: string;
  uid: string;
  exp: number;
}

export async function hasSecurityPin(db: Db, projectId: string): Promise<boolean> {
  const p = await getProjectById(db, projectId);
  return !!p.security_pin_hash;
}

/** First-time set, or change with the correct current PIN. */
export async function setSecurityPin(db: Db, projectId: string, newPin: string, currentPin?: string): Promise<void> {
  if (newPin.length < 8) throw new BadRequest('PIN must be at least 8 characters');
  const p = await getProjectById(db, projectId);
  if (p.security_pin_hash) {
    if (!currentPin || !(await verifyPassword(currentPin, p.security_pin_hash))) {
      throw new Forbidden('current PIN is incorrect');
    }
  }
  const hash = await hashPassword(newPin);
  await db.query('update projects set security_pin_hash=$2 where id=$1', [projectId, hash]);
}

export async function verifySecurityPin(db: Db, projectId: string, pin: string): Promise<boolean> {
  const p = await getProjectById(db, projectId);
  if (!p.security_pin_hash) return false;
  return verifyPassword(pin, p.security_pin_hash);
}

export async function grantSecurityUnlock(projectId: string, userId: string): Promise<void> {
  const token = sign({ project_id: projectId, uid: userId, exp: Math.floor(Date.now() / 1000) + UNLOCK_TTL_S } satisfies UnlockPayload, env.sessionSecret);
  (await cookies()).set(UNLOCK_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: env.isProduction, path: '/', maxAge: UNLOCK_TTL_S });
}

export async function clearSecurityUnlock(): Promise<void> {
  (await cookies()).delete(UNLOCK_COOKIE);
}

export async function hasSecurityUnlock(projectId: string, userId: string): Promise<boolean> {
  const raw = (await cookies()).get(UNLOCK_COOKIE)?.value;
  if (!raw) return false;
  const p = unsign<UnlockPayload>(raw, env.sessionSecret);
  if (!p || p.exp < Date.now() / 1000) return false;
  return p.project_id === projectId && p.uid === userId;
}

/** Throws 403 unless the PIN was entered for this project within the unlock window. */
export async function assertSecurityUnlocked(projectId: string, userId: string): Promise<void> {
  if (!(await hasSecurityUnlock(projectId, userId))) {
    throw new Forbidden('Security Lab is locked — enter the PIN first (POST /api/security/unlock)');
  }
}
