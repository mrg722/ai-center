import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { postJson, ProviderError } from '@/server/providers/types';

/**
 * postJson() turns a failed HTTP response into a ProviderError whose message
 * ends up shown verbatim in the chat room ("Run failed: <message>", see
 * runs.ts). Different providers shape their error bodies differently —
 * OpenAI-style ({error:{message}} / {message}) and RFC 7807 Problem Details
 * ({title, detail}, used by NVIDIA NIM among others) — and both must produce
 * a readable sentence instead of the raw JSON blob.
 */
describe('postJson error message extraction', () => {
  let server: Server;
  let baseUrl = '';
  let nextBody: { status: number; body: unknown } = { status: 500, body: {} };

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.statusCode = nextBody.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(nextBody.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => server.close());

  it('extracts the message from an OpenAI-style {error:{message}} body', async () => {
    nextBody = { status: 400, body: { error: { message: 'invalid model' } } };
    await expect(postJson(baseUrl, {}, {}, new AbortController().signal)).rejects.toMatchObject({
      message: expect.stringContaining('invalid model'),
    });
  });

  it('extracts the message from a plain {message} body', async () => {
    nextBody = { status: 500, body: { message: 'upstream unavailable' } };
    await expect(postJson(baseUrl, {}, {}, new AbortController().signal)).rejects.toMatchObject({
      message: expect.stringContaining('upstream unavailable'),
    });
  });

  it('extracts the message from an RFC 7807 Problem Details body (NVIDIA NIM and others)', async () => {
    nextBody = {
      status: 404,
      body: { status: 404, title: 'Not Found', detail: "Function 'abc-123': Not Found for account 'acct-1'" },
    };
    let caught: ProviderError | undefined;
    try {
      await postJson(baseUrl, {}, {}, new AbortController().signal);
    } catch (e) {
      caught = e as ProviderError;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect(caught?.status).toBe(404);
    // The readable "detail" sentence must appear — never the raw {"status":...} blob.
    expect(caught?.message).toContain("Function 'abc-123': Not Found for account 'acct-1'");
    expect(caught?.message).not.toContain('{"status"');
  });

  it('falls back to the raw (truncated) body when nothing recognizable parses', async () => {
    nextBody = { status: 502, body: { unexpected: 'shape' } };
    await expect(postJson(baseUrl, {}, {}, new AbortController().signal)).rejects.toMatchObject({
      message: expect.stringContaining('unexpected'),
    });
  });
});
