import type {
  AckRequest,
  ActionResult,
  ActivityRequest,
  AgentAction,
  HeartbeatRequest,
  HeartbeatResponse,
  HelloRequest,
  HelloResponse,
  InboxResponse,
} from '../../src/shared/protocol';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal authenticated client for the orchestrator's bridge API. */
export class OrchestratorClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          'user-agent': 'acc-bridge',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data: unknown = undefined;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok) {
        const msg = (data as { error?: string } | undefined)?.error ?? text.slice(0, 200) ?? res.statusText;
        throw new HttpError(res.status, `${method} ${path} → ${res.status}: ${msg}`);
      }
      return data as T;
    } finally {
      clearTimeout(t);
    }
  }

  hello(body: HelloRequest) {
    return this.req<HelloResponse>('POST', '/api/bridge/hello', body);
  }
  heartbeat(body: HeartbeatRequest) {
    return this.req<HeartbeatResponse>('POST', '/api/bridge/heartbeat', body);
  }
  inbox(waitSeconds: number) {
    return this.req<InboxResponse>('GET', `/api/bridge/inbox?wait=${waitSeconds}`, undefined, (waitSeconds + 15) * 1000);
  }
  ack(deliveryId: string, body: AckRequest) {
    return this.req<{ ok: true }>('POST', `/api/bridge/deliveries/${encodeURIComponent(deliveryId)}/ack`, body);
  }
  activity(body: ActivityRequest) {
    return this.req<{ ok: true }>('POST', '/api/bridge/activity', body, 5_000);
  }
  action(body: AgentAction) {
    return this.req<ActionResult>('POST', '/api/agent/actions', body);
  }
  context(taskId?: string) {
    return this.req<{ prompt: string }>('GET', `/api/agent/context${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''}`);
  }
  roster() {
    return this.req<{ agents: unknown[] }>('GET', '/api/agent/roster');
  }
  commandResult(body: { approval_id?: string; task_id: string; command: string; ok: boolean; output: string; commit?: string; branch?: string }) {
    return this.req<{ ok: true }>('POST', '/api/bridge/command-result', body);
  }
}
