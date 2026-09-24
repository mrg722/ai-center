import 'server-only';

/**
 * Server-side environment access. This module is server-only: importing it
 * from a client component fails the build, so secrets cannot be bundled into
 * browser code.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function allowEphemeralDb(): boolean {
  return read('ACC_ALLOW_EPHEMERAL_DB') === 'true';
}

export const env = {
  get databaseUrl() {
    const value = read('DATABASE_URL');
    if (!value && process.env.NODE_ENV === 'production' && !allowEphemeralDb()) {
      throw new Error('DATABASE_URL must be configured in production. Use the Supabase transaction pooler.');
    }
    return value;
  },
  get pgliteDir() {
    if (process.env.NODE_ENV === 'production' && !allowEphemeralDb()) {
      throw new Error('PGlite filesystem/in-memory mode is disabled in production. Configure DATABASE_URL.');
    }
    return read('PGLITE_DIR') ?? '.data/pglite';
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
    const value = read('APP_URL');
    if (!value && process.env.NODE_ENV === 'production') {
      throw new Error('APP_URL must be configured in production.');
    }
    return value ?? 'http://localhost:3000';
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
  get allowedCustomHosts() {
    return (read('ACC_ALLOWED_CUSTOM_HOSTS') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  },
  get contextBudgetChars() {
    return Number(read('CONTEXT_BUDGET_CHARS') ?? 24_000);
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
  get inprocessWorker() {
    return (read('ACC_INPROCESS_WORKER') ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  },
};

export const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{1,62}_(API_KEY|TOKEN)$/;
const RESERVED = new Set(['GITHUB_TOKEN', 'SETUP_TOKEN', 'SESSION_SECRET', 'CRON_SECRET']);

export function readApiKey(envName: string | undefined): string | undefined {
  if (!envName || !API_KEY_ENV_PATTERN.test(envName) || RESERVED.has(envName)) return undefined;

  // Vercel AI Gateway supports platform-issued OIDC credentials. Prefer an
  // explicitly configured Gateway API key, then fall back to VERCEL_OIDC_TOKEN.
  if (envName === 'AI_GATEWAY_API_KEY') return read(envName) ?? read('VERCEL_OIDC_TOKEN');

  return read(envName);
}

export function isApiKeyEnvAllowed(envName: string): boolean {
  return API_KEY_ENV_PATTERN.test(envName) && !RESERVED.has(envName);
}
