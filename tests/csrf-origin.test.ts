import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { checkOrigin, HttpError } from '@/server/http/route';

/**
 * checkOrigin() is the CSRF guard on every cookie-authenticated mutation
 * (POST /api/messages — sending a chat message to an agent — among them).
 * Real users reported a 403 there. Modern browsers always send `Origin` on
 * same-origin POSTs, but some mobile in-app WebViews and carrier proxies
 * strip it while still forwarding `Referer`; a plain Origin-or-reject check
 * false-positives on exactly that traffic. These cases confirm the fallback
 * without weakening the actual CSRF guarantee.
 */
function req(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://ignored.example/api/messages', { method, headers });
}

describe('checkOrigin', () => {
  it('allows a normal same-origin request with a matching Origin header', () => {
    expect(() => checkOrigin(req('POST', { origin: 'https://app.example', host: 'app.example' }))).not.toThrow();
  });

  it('rejects a cross-site Origin', () => {
    expect(() => checkOrigin(req('POST', { origin: 'https://evil.example', host: 'app.example' }))).toThrow(HttpError);
  });

  it('falls back to a matching Referer when Origin is missing (mobile WebView / carrier proxy)', () => {
    expect(() =>
      checkOrigin(req('POST', { host: 'app.example', referer: 'https://app.example/tasks/ACC-1' })),
    ).not.toThrow();
  });

  it('rejects a cross-site Referer when Origin is missing', () => {
    expect(() =>
      checkOrigin(req('POST', { host: 'app.example', referer: 'https://evil.example/' })),
    ).toThrow(HttpError);
  });

  it('rejects when both Origin and Referer are missing', () => {
    expect(() => checkOrigin(req('POST', { host: 'app.example' }))).toThrow(HttpError);
  });

  it('respects X-Forwarded-Host (behind Vercel) over the raw Host header', () => {
    expect(() =>
      checkOrigin(req('POST', { origin: 'https://app.example', host: 'internal.vercel.app', 'x-forwarded-host': 'app.example' })),
    ).not.toThrow();
  });

  it('never checks Origin/Referer on GET or HEAD', () => {
    expect(() => checkOrigin(req('GET', {}))).not.toThrow();
    expect(() => checkOrigin(req('HEAD', {}))).not.toThrow();
  });
});
