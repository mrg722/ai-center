import { postJson, ProviderError, type GenerateRequest, type GenerateResult, type HttpRuntime, type ResolvedHttpConfig } from './types';

/* ───────────────────────────── Anthropic (Messages API) */
export const anthropicProvider: HttpRuntime = {
  id: 'anthropic',
  label: 'Claude (Anthropic API)',
  provider: { id: 'anthropic', name: 'Anthropic' },
  runtime: 'Anthropic Messages API',
  transport: 'http-api',
  paid: true,
  description: 'Claude via the Anthropic Messages API. Conversation/analysis only (no workspace access).',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  defaultBaseUrl: 'https://api.anthropic.com',
  modelEnv: 'ANTHROPIC_MODEL',
  capabilities: ['analysis', 'code.review', 'planning'],
  async generate(req, cfg) {
    if (!cfg.apiKey) throw new ProviderError('ANTHROPIC_API_KEY is not configured');
    type R = { content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
    const r = await postJson<R>(
      `${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      },
      req.signal,
    );
    return {
      text: r.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'),
      tokensIn: r.usage?.input_tokens,
      tokensOut: r.usage?.output_tokens,
    };
  },
};

/* ───────────────────────────── OpenAI-compatible Chat Completions */
async function chatCompletions(req: GenerateRequest, cfg: ResolvedHttpConfig, keyRequired: boolean): Promise<GenerateResult> {
  if (keyRequired && !cfg.apiKey) throw new ProviderError(`${cfg.config.api_key_env ?? 'API key'} is not configured`);
  type R = {
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const r = await postJson<R>(
    `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
    cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
    },
    req.signal,
  );
  return {
    text: r.choices?.[0]?.message?.content ?? '',
    tokensIn: r.usage?.prompt_tokens,
    tokensOut: r.usage?.completion_tokens,
  };
}

function openAICompatible(p: Omit<HttpRuntime, 'transport' | 'generate' | 'runtime'> & { runtime?: string; keyRequired?: boolean }): HttpRuntime {
  const keyRequired = p.keyRequired ?? !p.apiKeyOptional;
  return { runtime: 'OpenAI-compatible Chat Completions', ...p, transport: 'http-api', generate: (req, cfg) => chatCompletions(req, cfg, keyRequired) };
}

export const openaiProvider = openAICompatible({
  id: 'openai',
  label: 'GPT (OpenAI API)',
  provider: { id: 'openai', name: 'OpenAI' },
  paid: true,
  description: 'GPT via the OpenAI API (Chat Completions). Analysis/review only — use the Codex bridge for workspace access.',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelEnv: 'OPENAI_MODEL',
  capabilities: ['analysis', 'code.review'],
});

export const perplexityProvider = openAICompatible({
  id: 'perplexity',
  label: 'Perplexity (Sonar API)',
  provider: { id: 'perplexity', name: 'Perplexity' },
  paid: true,
  description: 'Web-grounded research answers. Optional; runs only when a message is routed to it.',
  apiKeyEnv: 'PERPLEXITY_API_KEY',
  defaultBaseUrl: 'https://api.perplexity.ai',
  modelEnv: 'PERPLEXITY_MODEL',
  defaultModel: 'sonar-pro',
  capabilities: ['research', 'web.search'],
});

export const openrouterProvider = openAICompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  provider: { id: 'openrouter', name: 'OpenRouter' },
  paid: true,
  description: 'Any model available on OpenRouter (Qwen, DeepSeek, Mistral, Llama…).',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  modelEnv: 'OPENROUTER_MODEL',
  capabilities: ['analysis'],
});

export const deepseekProvider = openAICompatible({
  id: 'deepseek',
  label: 'DeepSeek',
  provider: { id: 'deepseek', name: 'DeepSeek' },
  paid: true,
  description: 'DeepSeek API (OpenAI-compatible).',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  modelEnv: 'DEEPSEEK_MODEL',
  defaultModel: 'deepseek-chat',
  capabilities: ['analysis', 'code.review'],
});

export const mistralProvider = openAICompatible({
  id: 'mistral',
  label: 'Mistral',
  provider: { id: 'mistral', name: 'Mistral AI' },
  paid: true,
  description: 'Mistral API (OpenAI-compatible chat completions).',
  apiKeyEnv: 'MISTRAL_API_KEY',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  modelEnv: 'MISTRAL_MODEL',
  capabilities: ['analysis'],
});

export const qwenProvider = openAICompatible({
  id: 'qwen',
  label: 'Qwen (DashScope)',
  provider: { id: 'alibaba', name: 'Alibaba Cloud (Qwen)' },
  paid: true,
  description: 'Qwen via DashScope compatible mode.',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  modelEnv: 'QWEN_MODEL',
  baseUrlEditable: true,
  capabilities: ['analysis'],
});

export const ollamaProvider = openAICompatible({
  id: 'ollama',
  label: 'Ollama (local)',
  provider: { id: 'ollama', name: 'Ollama (local models)' },
  runtime: 'Ollama server',
  paid: false,
  description: 'Local models through Ollama’s OpenAI-compatible endpoint. The orchestrator must reach the Ollama host.',
  apiKeyOptional: true,
  defaultBaseUrl: 'http://localhost:11434/v1',
  modelEnv: 'OLLAMA_MODEL',
  baseUrlEditable: true,
  capabilities: ['analysis', 'local'],
});

export const lmstudioProvider = openAICompatible({
  id: 'lmstudio',
  label: 'LM Studio (local)',
  provider: { id: 'lmstudio', name: 'LM Studio (local models)' },
  runtime: 'LM Studio server',
  paid: false,
  description: 'Local models served by LM Studio (OpenAI-compatible server).',
  apiKeyOptional: true,
  defaultBaseUrl: 'http://localhost:1234/v1',
  modelEnv: 'LMSTUDIO_MODEL',
  baseUrlEditable: true,
  capabilities: ['analysis', 'local'],
});

export const genericOpenAIProvider = openAICompatible({
  id: 'openai-compatible',
  label: 'Generic OpenAI-compatible API',
  provider: { id: 'custom', name: 'Custom' },
  paid: true,
  description: 'Any endpoint implementing /chat/completions (vLLM, Together, Groq, Fireworks, …).',
  apiKeyOptional: true,
  baseUrlEditable: true,
  capabilities: ['analysis'],
});

/* ───────────────────────────── Google Gemini (generateContent) */
export const geminiProvider: HttpRuntime = {
  id: 'gemini',
  label: 'Gemini (Google AI)',
  provider: { id: 'google', name: 'Google' },
  runtime: 'Gemini generateContent API',
  transport: 'http-api',
  paid: true,
  description: 'Gemini via the Generative Language API. Default role: researcher / second opinion.',
  apiKeyEnv: 'GEMINI_API_KEY',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelEnv: 'GEMINI_MODEL',
  defaultModel: 'gemini-3.8-flash',
  capabilities: ['research', 'analysis', 'second-opinion'],
  async generate(req, cfg) {
    if (!cfg.apiKey) throw new ProviderError('GEMINI_API_KEY is not configured');
    type R = {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const model = encodeURIComponent(req.model);
    const r = await postJson<R>(
      `${cfg.baseUrl.replace(/\/$/, '')}/models/${model}:generateContent`,
      { 'x-goog-api-key': cfg.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature },
      },
      req.signal,
    );
    const text = (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return { text, tokensIn: r.usageMetadata?.promptTokenCount, tokensOut: r.usageMetadata?.candidatesTokenCount };
  },
};

/* ───────────────────────────── Vercel AI Gateway */
/**
 * Vercel AI Gateway exposes a single OpenAI-compatible endpoint for a large
 * catalogue of models. The model field is intentionally not constrained here:
 * ACC can call any current Gateway model without a code change.
 */
export const vercelAiGatewayProvider = openAICompatible({
  id: 'vercel-ai-gateway',
  label: 'Vercel AI Gateway',
  provider: { id: 'vercel', name: 'Vercel AI Gateway' },
  paid: true,
  description: 'Hundreds of models through one Gateway key. Set the model to any Vercel AI Gateway model slug (creator/model).',
  apiKeyEnv: 'AI_GATEWAY_API_KEY',
  defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1',
  modelEnv: 'VERCEL_AI_GATEWAY_MODEL',
  defaultModel: 'openai/gpt-5.6-luna',
  capabilities: ['analysis', 'code.review', 'research', 'multi-model'],
});

/* ───────────────────────────── Generic HTTP agent */
/**
 * Contract: POST <base_url> with {system, prompt, model} (+ Bearer key if
 * configured) → {text: string, tokens_in?, tokens_out?}.
 * Lets you plug any custom agent service without touching the core.
 */
export const genericHttpProvider: HttpRuntime = {
  id: 'generic-http',
  label: 'Generic HTTP agent',
  provider: { id: 'custom', name: 'Custom' },
  runtime: 'HTTP agent service',
  transport: 'http-api',
  paid: true,
  description: 'Your own agent service: POST {system,prompt,model} → {text}.',
  apiKeyOptional: true,
  baseUrlEditable: true,
  capabilities: ['custom'],
  async generate(req, cfg) {
    if (!cfg.baseUrl) throw new ProviderError('base_url is required for generic-http');
    const r = await postJson<{ text: string; tokens_in?: number; tokens_out?: number }>(
      cfg.baseUrl,
      cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      { system: req.system, prompt: req.prompt, model: req.model },
      req.signal,
    );
    return { text: String(r.text ?? ''), tokensIn: r.tokens_in, tokensOut: r.tokens_out };
  },
};

/* ───────────────────────────── Generic MCP agent (Streamable HTTP) */
/**
 * Talks to a remote MCP server as an "agent": calls one configured tool
 * (config.mcp_tool, default "chat") with {prompt} and uses its text output.
 */
export const genericMcpProvider: HttpRuntime = {
  id: 'generic-mcp',
  label: 'Generic MCP agent (HTTP)',
  provider: { id: 'custom', name: 'Custom' },
  runtime: 'MCP server (Streamable HTTP)',
  transport: 'http-api',
  paid: true,
  description: 'Any MCP server over Streamable HTTP exposing a prompt→text tool.',
  apiKeyOptional: true,
  baseUrlEditable: true,
  capabilities: ['mcp'],
  async generate(req, cfg) {
    if (!cfg.baseUrl) throw new ProviderError('base_url (MCP endpoint) is required for generic-mcp');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    };
    const rpc = async (id: number, method: string, params: unknown, session?: string) => {
      const res = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: req.signal,
        redirect: 'error',
      });
      if (!res.ok) throw new ProviderError(`MCP ${method} → ${res.status}`, res.status);
      const sid = res.headers.get('mcp-session-id') ?? session;
      const ct = res.headers.get('content-type') ?? '';
      const body = await res.text();
      let msg: { result?: unknown; error?: { message: string } } | undefined;
      if (ct.includes('text/event-stream')) {
        for (const line of body.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const j = JSON.parse(line.slice(5));
          if (j.id === id) msg = j;
        }
      } else msg = JSON.parse(body);
      if (!msg) throw new ProviderError(`MCP ${method}: empty response`);
      if (msg.error) throw new ProviderError(`MCP ${method}: ${msg.error.message}`);
      return { result: msg.result, session: sid };
    };
    const init = await rpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ai-command-center', version: '0.1.0' },
    });
    await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: { ...headers, ...(init.session ? { 'mcp-session-id': init.session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: req.signal,
        redirect: 'error',
    }).catch(() => undefined);
    const call = await rpc(
      2,
      'tools/call',
      { name: cfg.config.mcp_tool ?? 'chat', arguments: { prompt: `${req.system}\n\n${req.prompt}` } },
      init.session ?? undefined,
    );
    const content = (call.result as { content?: { type: string; text?: string }[] })?.content ?? [];
    return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') };
  },
};
