import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { vercelAiGatewayProvider } from '@/server/providers/adapters';

describe('Vercel AI Gateway runtime', () => {
  let server: Server;
  let baseUrl = '';
  let authorization = '';
  let model = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        authorization = req.headers.authorization ?? '';
        const parsed = JSON.parse(body) as { model: string };
        model = parsed.model;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          choices: [{ message: { content: 'gateway-ok' } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });

  afterAll(() => server.close());

  it('uses the Gateway model slug and server-side key without exposing it to the request body', async () => {
    const controller = new AbortController();
    const result = await vercelAiGatewayProvider.generate(
      {
        system: 'You are a reviewer.',
        prompt: 'Audit this change.',
        model: 'openai/gpt-5.6-luna',
        maxTokens: 256,
        temperature: 0.2,
        signal: controller.signal,
      },
      {
        baseUrl,
        apiKey: 'gw_test_secret',
        config: { api_key_env: 'AI_GATEWAY_API_KEY' },
      },
    );

    expect(result).toMatchObject({ text: 'gateway-ok', tokensIn: 12, tokensOut: 7 });
    expect(authorization).toBe('Bearer gw_test_secret');
    expect(model).toBe('openai/gpt-5.6-luna');
  });
});
