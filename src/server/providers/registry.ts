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
import { readApiKey } from '../env';

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

export function resolveHttpConfig(p: Runtime, cfg: AgentConfig): ResolvedHttpConfig {
  const envName = cfg.api_key_env || p.apiKeyEnv;
  return {
    baseUrl: (p.baseUrlEditable && cfg.base_url) || p.defaultBaseUrl || cfg.base_url || '',
    apiKey: readApiKey(envName),
    config: { ...cfg, api_key_env: envName },
  };
}

/** Whether an http-api runtime can run right now (key, base URL, model). */
export function httpReadiness(p: Runtime, cfg: AgentConfig, model: string): { ready: boolean; reason?: string } {
  if (!isHttpRuntime(p)) return { ready: false, reason: 'not an http-api runtime' };
  const r = resolveHttpConfig(p, cfg);
  if (!r.apiKey && !p.apiKeyOptional) return { ready: false, reason: `${r.config.api_key_env} not set on the server` };
  if (!r.baseUrl) return { ready: false, reason: 'base URL not configured' };
  if (!resolveModel(p, model) && p.id !== 'generic-http' && p.id !== 'generic-mcp') {
    return { ready: false, reason: `model not configured${p.modelEnv ? ` (set it on the agent or ${p.modelEnv})` : ''}` };
  }
  return { ready: true };
}
