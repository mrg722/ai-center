import type { NextRequest } from 'next/server';
import { getDb } from '@/server/db';
import { getSessionUser } from '@/server/auth/session';
import { requireProject } from '@/server/orchestrator/repo';
import { subscribe, type AccEvent } from '@/server/events/bus';
import { sweepPresence } from '@/server/orchestrator/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Server-Sent Events. Durable events are tailed from the `events` table by id
 * (so it works across serverless instances; the browser resumes with
 * Last-Event-ID). In-process bus notifications wake the loop instantly and
 * carry ephemeral activity (typing, tool use) that is never persisted.
 */
export async function GET(req: NextRequest) {
  const db = await getDb();
  const user = await getSessionUser(db);
  if (!user) return new Response('unauthorized', { status: 401 });
  const project = await requireProject(db);

  const lastIdHeader = req.headers.get('last-event-id') ?? req.nextUrl.searchParams.get('after');
  let cursor = Number(lastIdHeader ?? 0);
  if (!cursor) {
    const r = await db.query<{ id: number }>('select coalesce(max(id),0)::bigint as id from events where project_id=$1', [project.id]);
    cursor = Number(r.rows[0].id);
  }

  const encoder = new TextEncoder();
  const maxLifetimeMs = 240_000; // reconnect before platform limits
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };
      let wake: (() => void) | null = null;
      const unsub = subscribe((e: AccEvent) => {
        if (e.project_id !== project.id) return;
        if (e.id === null) send(`event: ephemeral\ndata: ${JSON.stringify(e)}\n\n`);
        else wake?.();
      });
      const close = () => {
        if (closed) return;
        closed = true;
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', close);
      send(`retry: 2000\n: connected\n\n`);
      const started = Date.now();
      let lastPing = Date.now();
      let lastSweep = 0;
      try {
        while (!closed && Date.now() - started < maxLifetimeMs) {
          const r = await db.query<AccEvent>(
            'select * from events where project_id=$1 and id > $2 order by id asc limit 200',
            [project.id, cursor],
          );
          for (const e of r.rows) {
            cursor = Number(e.id);
            send(`id: ${cursor}\nevent: event\ndata: ${JSON.stringify(e)}\n\n`);
          }
          if (Date.now() - lastSweep > 10_000) {
            lastSweep = Date.now();
            await sweepPresence(db, project.id).catch(() => 0); // time-based state → explicit events
          }
          if (Date.now() - lastPing > 15_000) {
            send(`: ping\n\n`);
            lastPing = Date.now();
          }
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 1500);
            wake = () => {
              clearTimeout(t);
              setTimeout(resolve, 60); // let the writer's transaction commit
            };
          });
          wake = null;
        }
      } catch (e) {
        console.error('[acc] stream', e);
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
