import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { getDb, type Db } from '../db';
import { getSessionUser, type SessionUser } from '../auth/session';
import { rateLimit, LIMITS } from '../security/rate-limit';
import { sha256 } from '../security/crypto';
import { getAgentByTokenHash } from '../orchestrator/repo';
import type { AgentRow } from '../types';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Ctx<P> = { params: Promise<P> };

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

function toResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json({ error: 'invalid input', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
  }
  const status = (e as { status?: number }).status;
  if (status && status >= 400 && status < 500) return NextResponse.json({ error: (e as Error).message }, { status });
  console.error('[acc] unhandled', e);
  return NextResponse.json({ error: 'internal error' }, { status: 500 });
}

/** CSRF defence for cookie-authenticated mutations: Origin must match Host. */
function checkOrigin(req: NextRequest) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) throw new HttpError(403, 'missing origin');
  if (new URL(origin).host !== host) throw new HttpError(403, 'cross-origin request rejected');
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'payload too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload too large');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
  return schema.parse(data);
}

/** Route for the human moderator (cookie session). */
export function userRoute<P = Record<string, string>>(
  handler: (a: { req: NextRequest; db: Db; user: SessionUser; params: P }) => Promise<Response | unknown>,
  opts: { write?: boolean; roles?: SessionUser['role'][] } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const db = await getDb();
      const user = await getSessionUser(db);
      if (!user) throw new HttpError(401, 'not signed in');
      const write = opts.write ?? req.method !== 'GET';
      if (write) {
        checkOrigin(req);
        if (user.role === 'viewer') throw new HttpError(403, 'viewers cannot modify anything');
        const rl = rateLimit(`u:${user.id}`, LIMITS.userWrite.limit, LIMITS.userWrite.windowMs);
        if (!rl.ok) throw new HttpError(429, `rate limited, retry in ${rl.retryAfterS}s`);
      }
      if (opts.roles && !opts.roles.includes(user.role)) throw new HttpError(403, 'forbidden');
      const out = await handler({ req, db, user, params: (await ctx.params) ?? ({} as P) });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Route for agents (bridge / MCP): Bearer agent token. */
export function agentRoute<P = Record<string, string>>(
  handler: (a: { req: NextRequest; db: Db; agent: AgentRow; params: P }) => Promise<Response | unknown>,
  opts: { limit?: { limit: number; windowMs: number } } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const auth = req.headers.get('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!token) throw new HttpError(401, 'missing agent token');
      const lim = opts.limit ?? LIMITS.bridge;
      const ipRl = rateLimit(`ip:${clientIp(req)}`, lim.limit * 3, lim.windowMs);
      if (!ipRl.ok) throw new HttpError(429, 'rate limited');
      const db = await getDb();
      const agent = await getAgentByTokenHash(db, sha256(token));
      if (!agent) throw new HttpError(401, 'invalid agent token');
      if (!agent.enabled) throw new HttpError(403, 'agent disabled');
      const rl = rateLimit(`a:${agent.id}:${lim.limit}`, lim.limit, lim.windowMs);
      if (!rl.ok) throw new HttpError(429, `rate limited, retry in ${rl.retryAfterS}s`);
      const out = await handler({ req, db, agent, params: (await ctx.params) ?? ({} as P) });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Unauthenticated route (login, setup, webhooks) with IP rate limiting. */
export function publicRoute<P = Record<string, string>>(
  handler: (a: { req: NextRequest; params: P }) => Promise<Response | unknown>,
  opts: { limit: { limit: number; windowMs: number }; key: string; checkOrigin?: boolean },
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const rl = rateLimit(`${opts.key}:${clientIp(req)}`, opts.limit.limit, opts.limit.windowMs);
      if (!rl.ok) throw new HttpError(429, `too many attempts, retry in ${rl.retryAfterS}s`);
      if (opts.checkOrigin) checkOrigin(req);
      const out = await handler({ req, params: (await ctx.params) ?? ({} as P) });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}
