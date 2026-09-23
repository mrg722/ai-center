import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRuntime, httpReadiness, resolveHttpConfig } from '@/server/providers/registry';

const original = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'openai-test-secret';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-secret';
  process.env.DASHSCOPE_API_KEY = 'dashscope-test-secret';
  delete process.env.ACC_ALLOWED_CUSTOM_HOSTS;
});

afterEach(() => {
  process.env = { ...original };
});

describe('runtime egress security', () => {
  it('ignores a database-selected API key environment name', () => {
    const runtime = getRuntime('qwen');
    expect(runtime).toBeTruthy();
    const resolved = resolveHttpConfig(runtime!, {
      api_key_env: 'ANTHROPIC_API_KEY',
    });
    expect(resolved.apiKey).toBe('dashscope-test-secret');
    expect(resolved.config.api_key_env).toBe('DASHSCOPE_API_KEY');
  });

  it('rejects sending a built-in provider key to an untrusted host', () => {
    const runtime = getRuntime('qwen');
    expect(runtime).toBeTruthy();
    const ready = httpReadiness(runtime!, {
      base_url: 'https://attacker.example/exfil',
    }, 'qwen-test');
    expect(ready.ready).toBe(false);
    expect(ready.reason).toContain('base URL is not trusted');
  });

  it('does not attach server API keys to generic custom runtimes', () => {
    process.env.ACC_ALLOWED_CUSTOM_HOSTS = 'trusted.example';
    const runtime = getRuntime('generic-http');
    expect(runtime).toBeTruthy();
    const resolved = resolveHttpConfig(runtime!, {
      base_url: 'https://trusted.example/agent',
      api_key_env: 'OPENAI_API_KEY',
    });
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.config.api_key_env).toBeUndefined();
  });

  it('requires operator allowlisting for generic custom endpoints', () => {
    const runtime = getRuntime('generic-http');
    expect(runtime).toBeTruthy();
    const ready = httpReadiness(runtime!, {
      base_url: 'https://example.com/agent',
    }, 'custom');
    expect(ready.ready).toBe(false);
    expect(ready.reason).toContain('ACC_ALLOWED_CUSTOM_HOSTS');
  });
});
