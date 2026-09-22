import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { safeEqual } from '@/server/security/crypto';
import { drainHostedQueue } from '@/server/orchestrator/hosted';
import { sweepPresence } from '@/server/orchestrator/bridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Safety-net tick (Vercel Cron or any scheduler): runs pending hosted-agent
 * work, expires stale sessions and prunes old events. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = env.cronSecret;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = await getDb();
  await sweepPresence(db);
  await db.query(`update approvals set status='EXPIRED' where status='PENDING' and expires_at is not null and expires_at < now()`);
  const pruned = await db.query(`delete from events where created_at < now() - interval '30 days'`);
  await drainHostedQueue();
  return NextResponse.json({ ok: true, pruned_events: pruned.rowCount });
}
