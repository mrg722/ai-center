const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let threshold: number = LEVELS.info;

export function setLogLevel(level: Level): void {
  threshold = LEVELS[level] ?? LEVELS.info;
}

/** Redacts anything that looks like a secret before it reaches the terminal. */
export function redact(text: string): string {
  return text
    .replace(/acc_[a-z0-9-]+_[A-Za-z0-9_-]{20,}/g, 'acc_***')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,})/g, '***')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1***');
}

function out(level: Level, msg: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${redact(msg)}${
    extra !== undefined ? ' ' + redact(typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''
  }`;
  // stderr: stdout is reserved for the MCP stdio transport when running as MCP server
  process.stderr.write(line + '\n');
}

export const log = {
  debug: (m: string, e?: unknown) => out('debug', m, e),
  info: (m: string, e?: unknown) => out('info', m, e),
  warn: (m: string, e?: unknown) => out('warn', m, e),
  error: (m: string, e?: unknown) => out('error', m, e),
};
