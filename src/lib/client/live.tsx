'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { EventView, Flight, Snapshot } from './types';

export interface ActivityLine {
  agentId: string;
  kind: string;
  text: string;
  at: number;
}

interface LiveState {
  snap: Snapshot | null;
  error: string | null;
  connected: boolean;
  refresh: () => Promise<void>;
  /** increments whenever a message is created (conversation views refetch) */
  messageTick: number;
  lastMessageEvent: EventView | null;
  activity: Record<string, ActivityLine[]>;
  flights: Flight[];
  liveEvents: EventView[];
  /**
   * Monotonic counters, incremented once per matching event as it arrives.
   * Views that only need to know "did something in this category change"
   * (to decide whether to refetch) should read these instead of deriving a
   * count from `liveEvents.filter(...)`: that array is capped at 80 entries
   * for display, so a count re-derived from it can plateau or even go
   * backwards in a long session as old matching events get evicted while
   * unrelated ones arrive — the exact same total length hides a real change.
   * A monotonic counter also avoids every consumer re-scanning the array on
   * every single SSE tick, which otherwise makes typing/clicking feel
   * laggy once there's real traffic (every event re-renders every view that
   * reads `useLive()`, including ones with a long list of chat messages to
   * re-diff).
   */
  statusTick: number;
  gitTick: number;
}

const Ctx = createContext<LiveState | null>(null);

/**
 * Keeps the browser in sync with the orchestrator — one direction only:
 *
 *   AgentState (orchestrator) → Postgres/events → SSE → this store → views
 *
 * GET /api/state gives a snapshot; EventSource(/api/stream) delivers changes.
 * Durable events trigger a debounced snapshot refresh; ephemeral events
 * (live activity text) are kept only in memory. No view derives state.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [messageTick, setMessageTick] = useState(0);
  const [lastMessageEvent, setLastMessageEvent] = useState<EventView | null>(null);
  const [activity, setActivity] = useState<Record<string, ActivityLine[]>>({});
  const [flights, setFlights] = useState<Flight[]>([]);
  const [liveEvents, setLiveEvents] = useState<EventView[]>([]);
  const [statusTick, setStatusTick] = useState(0);
  const [gitTick, setGitTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  const refresh = useCallback(async () => {
    try {
      const s = await api<Snapshot>('/api/state');
      setSnap(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void refresh();
    }, 250);
  }, [refresh]);

  // No client-side polling: every state change (including time-based ones such as a
  // bridge losing its heartbeat) arrives as an event from the orchestrator.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => {
        setConnected(true);
        void refresh();
      };
      es.onerror = () => {
        setConnected(false);
        // EventSource auto-reconnects; if it gave up, recreate
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          retry = setTimeout(connect, 3000);
        }
      };
      es.addEventListener('event', (m) => {
        const e = JSON.parse((m as MessageEvent).data) as EventView;
        setLiveEvents((prev) => [e, ...prev].slice(0, 80));
        if (/^(run\.|system\.|approval\.decided)/.test(e.type)) setStatusTick((t) => t + 1);
        if (e.type.startsWith('git') || e.type.startsWith('github')) setGitTick((t) => t + 1);
        if (e.type === 'message.created') {
          setMessageTick((t) => t + 1);
          setLastMessageEvent(e);
          const s = snapRef.current;
          const slugs = (e.payload.to as string[] | undefined) ?? [];
          const toIds = slugs.map((slug) => s?.agents.find((a) => a.slug === slug)?.id).filter(Boolean) as string[];
          if (e.payload.to_moderator) toIds.push('moderator');
          const from = e.actor_kind === 'agent' && e.actor_id ? e.actor_id : e.actor_kind === 'user' ? 'moderator' : 'system';
          if (toIds.length) {
            setFlights((f) => [...f.filter((x) => Date.now() - x.at < 8000), { id: String(e.id), from, to: toIds, type: String(e.payload.message_type), at: Date.now() }]);
          }
        }
        scheduleRefresh();
      });
      es.addEventListener('ephemeral', (m) => {
        const e = JSON.parse((m as MessageEvent).data) as EventView;
        if (e.type === 'agent.activity' && e.agent_id) {
          const line: ActivityLine = { agentId: e.agent_id, kind: String(e.payload.kind), text: String(e.payload.text), at: Date.now() };
          setActivity((prev) => ({ ...prev, [e.agent_id!]: [line, ...(prev[e.agent_id!] ?? [])].slice(0, 30) }));
        }
        if (e.type === 'agent.presence') {
          setSnap((s) => {
            if (!s) return s;
            const target = s.agents.find((a) => a.id === e.agent_id);
            if (!target || target.status === 'OFFLINE' || target.status === 'BLOCKED') return s;
            const next = String(e.payload.activity ?? target.activity);
            // Presence pings repeat frequently (heartbeats, sweeper ticks) and
            // often carry the same activity text as last time. Skip the
            // update (and the context-wide re-render it would trigger for
            // every view on the page) when nothing actually changed.
            if (next === target.activity) return s;
            return { ...s, agents: s.agents.map((a) => (a.id === e.agent_id ? { ...a, activity: next } : a)) };
          });
        }
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [refresh, scheduleRefresh]);

  const value = useMemo(
    () => ({ snap, error, connected, refresh, messageTick, lastMessageEvent, activity, flights, liveEvents, statusTick, gitTick }),
    [snap, error, connected, refresh, messageTick, lastMessageEvent, activity, flights, liveEvents, statusTick, gitTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLive outside LiveProvider');
  return v;
}

export function useAgentMap() {
  const { snap } = useLive();
  return useMemo(() => new Map((snap?.agents ?? []).map((a) => [a.id, a])), [snap?.agents]);
}
