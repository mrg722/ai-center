import { EventEmitter } from 'node:events';
import type { Db } from '../db';
import type { Actor } from '../types';

/**
 * Event bus.
 *  - Durable events are INSERTed into `events` (audit log + realtime cursor).
 *  - Ephemeral events (typing/streaming activity, presence ticks) are only
 *    published in-process and NEVER persisted — streaming noise is not
 *    permanent information.
 * The SSE endpoint combines both: it tails `events` by id (works across
 * serverless instances) and forwards in-process ephemeral events.
 */
export interface AccEvent {
  id: number | null; // null → ephemeral
  project_id: string;
  type: string;
  actor_kind: 'user' | 'agent' | 'system';
  actor_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const g = globalThis as unknown as { __accBus?: EventEmitter };
const bus = (g.__accBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(1000);
  return e;
})());

export function subscribe(fn: (e: AccEvent) => void): () => void {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}

function actorFields(actor: Actor) {
  return { actor_kind: actor.kind, actor_id: actor.kind === 'system' ? null : actor.id };
}

export async function emit(
  db: Db,
  e: { project_id: string; type: string; actor: Actor; task_id?: string | null; agent_id?: string | null; payload?: Record<string, unknown> },
): Promise<AccEvent> {
  const a = actorFields(e.actor);
  const r = await db.query<AccEvent>(
    `insert into events (project_id, type, actor_kind, actor_id, task_id, agent_id, payload)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [e.project_id, e.type, a.actor_kind, a.actor_id, e.task_id ?? null, e.agent_id ?? null, JSON.stringify(e.payload ?? {})],
  );
  const ev = r.rows[0];
  // publish after the surrounding transaction likely commits; consumers re-read state anyway
  queueMicrotask(() => bus.emit('event', ev));
  return ev;
}

export function emitEphemeral(e: Omit<AccEvent, 'id' | 'created_at'>): void {
  bus.emit('event', { ...e, id: null, created_at: new Date().toISOString() });
}
