/**
 * Agent model — five separate concepts, never conflated:
 *
 *   Agent        a team member (Claude, GPT/Codex, Gemini, Qwen…): name, role,
 *                permissions, colour. Stored in `agents`.
 *   Provider     who supplies the model (Anthropic, OpenAI, Google, Ollama…).
 *   Runtime      what actually executes the agent (Claude Code CLI, Codex CLI,
 *                Gemini API, Ollama server, simulator…). `agents.runtime` is
 *                the key into this registry.
 *   Transport    how the orchestrator reaches the runtime: local-bridge,
 *                http-api or in-process.
 *   Capabilities what the runtime can technically do (read, write, tests,
 *                browser, research…). Permissions — what it is ALLOWED to do —
 *                are separate and enforced by the policy engine.
 *
 * The orchestrator core never branches on a vendor name: it asks the
 * registry for a runtime by key and uses these interfaces.
 */
import type { Transport } from '../../shared/domain';

export interface ProviderInfo {
  id: string; // anthropic | openai | google | ollama | …
  name: string;
}

export interface RuntimeDescriptor {
  id: string; // registry key stored in agents.runtime
  label: string;
  provider: ProviderInfo;
  runtime: string; // human name of the executor, e.g. "Claude Code CLI"
  transport: Transport;
  description: string;
  capabilities: string[];
  /** env var NAME holding the API key (http-api only) */
  apiKeyEnv?: string;
  apiKeyOptional?: boolean;
  defaultBaseUrl?: string;
  baseUrlEditable?: boolean;
  modelEnv?: string;
  defaultModel?: string;
  /** calls cost money → subject to the paid_api permission + daily token budget */
  paid?: boolean;
  /** local-bridge: runner name the bridge should use */
  bridgeRunner?: string;
}

export interface AgentConfig {
  base_url?: string;
  api_key_env?: string;
  temperature?: number;
  max_tokens?: number;
  office_style?: 'builder' | 'reviewer' | 'researcher' | 'generic';
  system_prompt_extra?: string;
  /** generic-mcp: tool name to call */
  mcp_tool?: string;
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface GenerateResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ResolvedHttpConfig {
  baseUrl: string;
  apiKey: string | undefined;
  config: AgentConfig;
}

/** A runtime the orchestrator executes itself over HTTP. */
export interface HttpRuntime extends RuntimeDescriptor {
  transport: 'http-api';
  generate(req: GenerateRequest, cfg: ResolvedHttpConfig): Promise<GenerateResult>;
}

export type Runtime = RuntimeDescriptor | HttpRuntime;

export function isHttpRuntime(r: Runtime): r is HttpRuntime {
  return r.transport === 'http-api' && typeof (r as HttpRuntime).generate === 'function';
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** fetch + provider-friendly errors (never echoes the API key). */
export async function postJson<T>(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      msg = j.error?.message ?? j.message ?? msg;
    } catch {
      /* keep raw */
    }
    throw new ProviderError(`${new URL(url).host} responded ${res.status}: ${msg}`, res.status);
  }
  return JSON.parse(text) as T;
}
