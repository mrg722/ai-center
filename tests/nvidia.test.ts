import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateNvidiaModelsCache, resolveNvidiaModel } from '@/server/providers/nvidia';

describe('NVIDIA model resolver', () => {
  afterEach(() => {
    invalidateNvidiaModelsCache();
    vi.unstubAllGlobals();
    delete process.env.NVIDIA_API_KEY;
  });

  it('keeps a model that the live catalog exposes', async () => {
    process.env.NVIDIA_API_KEY = 'test-nvidia-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'nvidia/nemotron-3-super-120b-a12b' },
        { id: '01-ai/yi-1-large' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(resolveNvidiaModel('01-ai/yi-1-large')).resolves.toEqual({
      model: '01-ai/yi-1-large',
      repaired: false,
    });
  });

  it('repairs a stale model to an available preferred model', async () => {
    process.env.NVIDIA_API_KEY = 'test-nvidia-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'nvidia/nemotron-3-super-120b-a12b' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(resolveNvidiaModel('01-ai/yi-1-large')).resolves.toEqual({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      repaired: true,
    });
  });

  it('can exclude a model after a provider 404 and select another one', async () => {
    process.env.NVIDIA_API_KEY = 'test-nvidia-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'nvidia/nemotron-3-super-120b-a12b' },
        { id: 'meta/llama-3.3-70b-instruct' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(resolveNvidiaModel('nvidia/nemotron-3-super-120b-a12b', [
      'nvidia/nemotron-3-super-120b-a12b',
    ])).resolves.toEqual({
      model: 'meta/llama-3.3-70b-instruct',
      repaired: true,
    });
  });
});
