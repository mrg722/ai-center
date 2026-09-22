import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type RunnerName = 'claude-code' | 'codex' | 'antigravity' | 'command' | 'echo';

export interface BridgeConfig {
  url: string;
  token: string;
  workspace: string;
  runner: RunnerName;
  /** extra args appended to the runner CLI */
  runnerArgs: string[];
  /** binary override for the runner (e.g. full path to `claude`) */
  runnerBin?: string;
  /** for runner=command: shell-free command + args; prompt goes to stdin */
  command?: string[];
  maxRunSeconds: number;
  protectedBranches: string[];
  installPushGuard: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const RUNNERS: RunnerName[] = ['claude-code', 'codex', 'antigravity', 'command', 'echo'];

/**
 * Configuration comes from (lowest → highest priority):
 *   1. acc-bridge.json in the current directory (or --config <file>)
 *   2. environment variables (ACC_*)
 *   3. CLI flags (--url, --token-file, --workspace, --runner)
 *
 * The agent token should come from ACC_AGENT_TOKEN or a file readable only by
 * the user (--token-file). It is never logged.
 */
export function loadConfig(argv: string[]): BridgeConfig {
  const flags = parseFlags(argv);
  const cfgFile = flags.config ?? (existsSync('acc-bridge.json') ? 'acc-bridge.json' : undefined);
  const file: Record<string, unknown> = cfgFile ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
  if (file.token) {
    throw new Error('Do not store the agent token in acc-bridge.json. Use ACC_AGENT_TOKEN or --token-file.');
  }

  const pick = (flag: string | undefined, env: string | undefined, fromFile: unknown): string | undefined =>
    flag ?? env ?? (typeof fromFile === 'string' ? fromFile : undefined);

  const url = pick(flags.url, process.env.ACC_URL, file.url) ?? 'http://localhost:3000';
  const tokenFile = pick(flags['token-file'], process.env.ACC_AGENT_TOKEN_FILE, file.tokenFile);
  const token = (tokenFile ? readFileSync(tokenFile, 'utf8') : (process.env.ACC_AGENT_TOKEN ?? '')).trim();
  if (!token) throw new Error('Missing agent token. Set ACC_AGENT_TOKEN or pass --token-file <path>.');
  if (!/^acc_[a-z0-9-]+_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Agent token has an unexpected format.');

  const runner = (pick(flags.runner, process.env.ACC_RUNNER, file.runner) ?? 'echo') as RunnerName;
  if (!RUNNERS.includes(runner)) throw new Error(`Unknown runner "${runner}". Use one of: ${RUNNERS.join(', ')}`);

  const workspace = resolve(pick(flags.workspace, process.env.ACC_WORKSPACE, file.workspace) ?? process.cwd());
  if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);

  const listFrom = (v: unknown, env?: string): string[] =>
    Array.isArray(v) ? v.map(String) : env ? env.split(/\s+/).filter(Boolean) : [];

  const u = new URL(url);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
    throw new Error('Refusing to send the agent token over plain HTTP to a non-local host. Use https://');
  }

  return {
    url: url.replace(/\/$/, ''),
    token,
    workspace,
    runner,
    runnerArgs: listFrom(file.runnerArgs, process.env.ACC_RUNNER_ARGS),
    runnerBin: pick(undefined, process.env.ACC_RUNNER_BIN, file.runnerBin),
    command: listFrom(file.command, process.env.ACC_COMMAND),
    maxRunSeconds: Number(process.env.ACC_MAX_RUN_SECONDS ?? file.maxRunSeconds ?? 1800),
    protectedBranches: listFrom(file.protectedBranches, process.env.ACC_PROTECTED_BRANCHES).length
      ? listFrom(file.protectedBranches, process.env.ACC_PROTECTED_BRANCHES)
      : ['main', 'master'],
    installPushGuard: (process.env.ACC_INSTALL_PUSH_GUARD ?? String(file.installPushGuard ?? 'false')) === 'true',
    logLevel: (process.env.ACC_LOG_LEVEL as BridgeConfig['logLevel']) ?? 'info',
  };
}

export function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = 'true';
  }
  return out;
}
