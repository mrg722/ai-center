import type { AgentConfig, ResolvedHttpConfig, Runtime, RuntimeDescriptor } from './types';
import { isHttpRuntime } from './types';
import {
  anthropicProvider,
  deepseekProvider,
  geminiProvider,
  genericHttpProvider,
  genericMcpProvider,
  genericOpenAIProvider,
  lmstudioProvider,
  mistralProvider,
  ollamaProvider,
  openaiProvider,
  openrouterProvider,
  perplexityProvider,
  qwenProvider,
  vercelAiGatewayProvider,
} from './adapters';
import { env, readApiKey } from '../env';

/* ─── local-bridge runtimes: executed on the user's machine by the Agent Bridge */
const claudeCode: RuntimeDescriptor = {
  id: 'claude-code',
  label: 'Claude Code (local bridge)',
  provider: { id: 'anthropic', name: 'Anthropic' },
  runtime: 'Claude Code CLI',
  transport: 'local-bridge',
  bridgeRunner: 'claude-code',
  description: 'Claude Code CLI on your machine. Reads/edits the repo, runs tests, Playwright, MCP tools.',
  capabilities: ['read', 'write', 'tests.run', 'shell', 'browser.playwright', 'web.firecrawl', 'research.perplexity', 'mcp'],
};
const codex: RuntimeDescriptor = {
  id: 'codex',
  label: 'OpenAI Codex CLI (local bridge)',
  provider: { id: 'openai', name: 'OpenAI' },
  runtime: 'Codex CLI',
  transport: 'local-bridge',
  bridgeRunner: 'codex',
  description: 'Codex CLI on your machine. Audits, fixes, verifies and integrates changes.',
  capabilities: ['read', 'write', 'tests.run', 'shell', 'code.review', 'mcp'],
};
const antigravity: RuntimeDescriptor = {
  id: 'antigravity',
  label: 'Google Antigravity (local bridge)',
  provider: { id: 'google', name: 'Google' },
  runtime: 'Antigravity CLI',
  transport: 'local-bridge',
  bridgeRunner: 'antigravity',
  description: 'Google Antigravity CLI authenticated with a Google account; no Gemini API key required.',
  capabilities: ['read', 'write', 'tests.run', 'shell', 'browser.playwright', 'research', 'mcp'],
};
const localCommand: RuntimeDescriptor = {
  id: 'local-command',
  label: 'Local command (bridge)',
  provider: { id: 'custom', name: 'Custom' },
  runtime: 'Any CLI (stdin → stdout)',
  transport: 'local-bridge',
  bridgeRunner: 'command',
  description: 'Any CLI agent on your machine that reads a prompt on stdin (aider, `ollama run`, scripts…).',
  capabilities: ['read', 'local'],
};

/* ─── in-process runtime: the DEMO simulator (never an AI, always labelled) */
export const simulatorRuntime: RuntimeDescriptor = {
  id: 'simulator',
  label: 'Simulator (DEMO mode)',
  provider: { id: 'acc', name: 'AI Command Center' },
  runtime: 'Scripted simulator',
  transport: 'in-process',
  description: 'Scripted, clearly-labelled simulated agent used in DEMO mode to exercise the UI and workflows. Never touches git or paid APIs.',
  capabilities: ['simulated'],
};

const ALL: Runtime[] = [
  claudeCode,
  codex,
  antigravity,
  localCommand,
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  perplexityProvider,
  openrouterProvider,
  deepseekProvider,
  mistralProvider,
  qwenProvider,
  vercelAiGatewayProvider,
  ollamaProvider,
  lmstudioProvider,
  genericOpenAIProvider,
  genericHttpProvider,
  genericMcpProvider,
  simulatorRuntime,
];

const byId = new Map(ALL.map((p) => [p.id, p]));

export function getRuntime(id: string): Runtime | undefined {
  return byId.get(id);
}

export function listRuntimes(): Runtime[] {
  return ALL;
}

/** Public catalogue (safe for the browser — only whether a key is PRESENT). */
export function describeRuntimes() {
  return ALL.filter((p) => p.transport !== 'in-process').map((p) => ({
    id: p.id,
    label: p.label,
    provider: p.provider,
    runtime: p.runtime,
    transport: p.transport,
    description: p.description,
    apiKeyEnv: p.apiKeyEnv ?? null,
    apiKeyOptional: Boolean(p.apiKeyOptional),
    apiKeyPresent: p.apiKeyEnv ? Boolean(readApiKey(p.apiKeyEnv)) : null,
    defaultBaseUrl: p.defaultBaseUrl ?? null,
    baseUrlEditable: Boolean(p.baseUrlEditable),
    defaultModel: resolveModel(p, ''),
    paid: Boolean(p.paid),
    capabilities: p.capabilities,
  }));
}

export function resolveModel(p: Runtime, model: string): string {
  return model || (p.modelEnv ? process.env[p.modelEnv] : undefined) || p.defaultModel || '';
}


const TRUSTED_ORIGINS: Record<string, string[]> = {
  anthropic: ['https://api.anthropic.com'],
  openai: ['https://api.openai.com'],
  gemini: ['https://generativelanguage.googleapis.com'],
  perplexity: ['https://api.perplexity.ai'],
  openrouter: ['https://openrouter.ai'],
  deepseek: ['https://api.deepseek.com'],
  mistral: ['https://api.mistral.ai'],
  qwen: ['https://dashscope-intl.aliyuncs.com'],
  'vercel-ai-gateway': ['https://ai-gateway.vercel.sh'],\n  'nvidia-nim': ['https://integrate.api.nvidia.com'],
};

function trustedBaseUrl(p: Runtime, raw: string | undefined): { url: string; ok: boolean; reason?: string } {
  if (!raw) {
    if (p.id === 'ollama' || p.id === 'lmstudio') {
      if (env.isProduction) return { url: '', ok: false, reason: 'local model endpoints are disabled in production' };
    }
    return { url: p.defaultBaseUrl ?? '', ok: Boolean(p.defaultBaseUrl) };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw, ok: false, reason: 'invalid base URL' };
  }

  // Built-in keyed providers are never allowed to send their secret to an
  // operator-controlled host. The configured provider key is also fixed below.
  if (p.apiKeyEnv) {
    const allowed = TRUSTED_ORIGINS[p.id] ?? [];
    if (!allowed.includes(url.origin)) {
      return { url: raw, ok: false, reason: 'base URL is not trusted for this provider' };
    }
    if (url.protocol !== 'https:') return { url: raw, ok: false, reason: 'provider endpoints must use HTTPS' };
    return { url: raw, ok: true };
  }

  // Custom HTTP/MCP runtimes intentionally have no server-side API key.
  // In production they must be explicitly allowlisted by the operator.
  if (p.id === 'generic-http' || p.id === 'generic-mcp' || p.id === 'openai-compatible') {
    const allowedHosts = env.allowedCustomHosts;
    if (!allowedHosts.includes(url.hostname.toLowerCase())) {
      return { url: raw, ok: false, reason: 'custom endpoint host is not in ACC_ALLOWED_CUSTOM_HOSTS' };
    }
    if (url.protocol !== 'https:') return { url: raw, ok: false, reason: 'custom endpoints must use HTTPS' };
    return { url: raw, ok: true };
  }

  // Local model servers never receive hosted secrets and are useful only from
  // a local/bridge-capable environment. Keep them out of production Vercel.
  if (p.id === 'ollama' || p.id === 'lmstudio') {
    if (env.isProduction) return { url: raw, ok: false, reason: 'local model endpoints are disabled in production' };
    return { url: raw, ok: /^https?:$/.test(url.protocol) };
  }

  return { url: raw, ok: false, reason: 'runtime endpoint is not allowlisted' };
}

function resolveKeyEnv(p: Runtime): string | undefined {
  // A runtime can never choose another built-in provider's secret through the
  // database. This closes the api_key_env + arbitrary base_url exfiltration
  // path. Custom runtimes receive no server-side secret.
  return p.apiKeyEnv;
}

export function resolveHttpConfig(p: Runtime, cfg: AgentConfig): ResolvedHttpConfig {
  const envName = resolveKeyEnv(p);
  const requestedBase = p.baseUrlEditable ? cfg.base_url : p.defaultBaseUrl;
  const endpoint = trustedBaseUrl(p, requestedBase);
  return {
    baseUrl: endpoint.url,
    apiKey: envName ? readApiKey(envName) : undefined,
    config: { ...cfg, api_key_env: envName, base_url: endpoint.ok ? endpoint.url : '' },
  };
}

/** Whether an http-api runtime can run right now (key, base URL, model). */
export function httpReadiness(p: Runtime, cfg: AgentConfig, model: string): { ready: boolean; reason?: string } {
  if (!isHttpRuntime(p)) return { ready: false, reason: 'not an http-api runtime' };
  const requestedBase = p.baseUrlEditable ? cfg.base_url : p.defaultBaseUrl;
  const endpoint = trustedBaseUrl(p, requestedBase);
  if (!endpoint.ok) return { ready: false, reason: endpoint.reason ?? 'endpoint not trusted' };
  const r = resolveHttpConfig(p, cfg);
  if (!r.apiKey && !p.apiKeyOptional) return { ready: false, reason: `${r.config.api_key_env} not set on the server` };
  if (!r.baseUrl) return { ready: false, reason: 'base URL not configured' };
  if (!resolveModel(p, model) && p.id !== 'generic-http' && p.id !== 'generic-mcp') {
    return { ready: false, reason: `model not configured${p.modelEnv ? ` (set it on the agent or ${p.modelEnv})` : ''}` };
  }
  return { ready: true };
}
