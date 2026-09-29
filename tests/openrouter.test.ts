import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenRouterKeyStatus, invalidateOpenRouterModelsCache, listOpenRouterModels } from '@/server/providers/openrouter';

describe('OpenRouter catalogue + usage status', () => {
  afterEach(() => {
    invalidateOpenRouterModelsCache();
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('flags a model as free from its :free id suffix or zero pricing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek V3.1 (free)' },
        { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', pricing: { prompt: '0.000015', completion: '0.000075' } },
        { id: 'meta/llama-3-explicit-free', name: 'Llama 3', pricing: { prompt: '0', completion: '0' } },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const models = await listOpenRouterModels();
    expect(models.find((m) => m.id === 'deepseek/deepseek-chat-v3.1:free')?.free).toBe(true);
    expect(models.find((m) => m.id === 'meta/llama-3-explicit-free')?.free).toBe(true);
    expect(models.find((m) => m.id === 'anthropic/claude-opus-5')?.free).toBe(false);
  });

  it('caches the catalogue between calls (single fetch)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'x/y:free' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await listOpenRouterModels();
    await listOpenRouterModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null key status (never throws) when no API key is configured', async () => {
    await expect(getOpenRouterKeyStatus()).resolves.toBeNull();
  });

  it('parses usage/limit/reset info when a key is configured', async () => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { limit: 1000, usage: 42, limit_remaining: 958, is_free_tier: true, rate_limit: { requests: 20, interval: '10s' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(getOpenRouterKeyStatus()).resolves.toEqual({
      limit: 1000,
      usage: 42,
      limit_remaining: 958,
      is_free_tier: true,
      rate_limit: { requests: 20, interval: '10s' },
    });
  });

  it('returns null key status on a failed request rather than throwing', async () => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    await expect(getOpenRouterKeyStatus()).resolves.toBeNull();
  });
});
