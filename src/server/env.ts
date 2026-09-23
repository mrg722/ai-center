import 'server-only';

/**
 * Server-side environment access. This module is `server-only`: importing it
 * from a client component fails the build, so secrets can never be bundled
 * into browser code.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get databaseUrl() {
    return read('DATABASE_URL');
  },
  /**
   * When DATABASE_URL is empty, use embedded Postgres (PGlite).
   * Vercel's filesystem is not a persistent writable application disk, so
   * production falls back to memory for smoke-testing instead of attempting
   * to create .data/pglite. Configure DATABASE_URL for persistent production.
   */
  get pgliteDir() {
    return read('PGLITE_DIR') ?? (process.env.NODE_ENV === 'production' ? 'memory' : '.data/pglite');
  },
  get sessionSecret(): string {
    const s = read('SESSION_SECRET');
    if (!s || s.length < 32) {
      throw new Error('SESSION_SECRET must be set to at least 32 random characters (see docs/ENVIRONMENT.md).');
    }
    return s;
  },
  get setupToken() {
    return read('SETUP_TOKEN');
  },
  get appUrl() {
    return read('APP_URL') ?? 'http://localhost:3000';
  },
  get cronSecret() {
    return read('CRON_SECRET');
  },
  get githubToken() {
    return read('GITHUB_TOKEN');
  },
  get githubWebhookSecret() {
    return read('GITHUB_WEBHOOK_SECRET');
  },
  get contextBudgetChars() {
    return Number(read('CONTEXT_BUDGET_CHARS') ?? 24_000);
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
  /** Run hosted agents in-process on an interval (dev / long-running servers). */
  get inprocessWorker() {
    return (read('ACC_INPROCESS_WORKER') ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  },
};

/**
 * Only environment variables matching this pattern may be referenced as an
 * agent's API key. This prevents a misconfigured agent from exfiltrating
 * other secrets (SESSION_SECRET, DATABASE_URL, …) to an arbitrary base URL.
 */
export const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{1,62}_(API_KEY|TOKEN)$/;
const RESERVED = new Set(['GITHUB_TOKEN', 'SETUP_TOKEN']);

export function readApiKey(envName: string | undefined): string | undefined {
  if (!envName || !API_KEY_ENV_PATTERN.test(envName) || RESERVED.has(envName)) return undefined;
  return read(envName);
}

export function isApiKeyEnvAllowed(envName: string): boolean {
  return API_KEY_ENV_PATTERN.test(envName) && !RESERVED.has(envName);
}
