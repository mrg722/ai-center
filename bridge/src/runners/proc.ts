import { spawn, execFile } from 'node:child_process';

const SECRET_ENV_NAME = /(?:API[_-]?KEY|ACCESS[_-]?KEY|AUTH(?:ORIZATION)?|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|DATABASE_URL)/i;

export function sanitizedChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SECRET_ENV_NAME.test(key)) out[key] = value;
  }
  // Runner-specific non-secret overrides remain supported.
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!SECRET_ENV_NAME.test(key)) out[key] = value;
  }
  return out;
}

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
}

/**
 * Spawns a process without a shell, streams stdout line by line, supports
 * abort (SIGTERM → SIGKILL after 5 s) and a hard timeout.
 */
export function runProcess(opts: {
  bin: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutS: number;
  onLine?: (line: string) => void;
  onErrLine?: (line: string) => void;
}): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      // Do not inherit API keys, tokens, database URLs or other obvious secrets into an agent CLI.
      // Local CLIs authenticate through their own credential stores; secret-bearing env vars
      // require an explicit, separate integration rather than implicit inheritance.
      env: sanitizedChildEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    let timedOut = false;
    let buf = '';
    let ebuf = '';
    const MAX = 4 * 1024 * 1024;

    const kill = () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref();
    };
    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutS * 1000);

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (stdout.length < MAX) stdout += s;
      buf += s;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) opts.onLine?.(line);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (stderr.length < MAX) stderr += s;
      ebuf += s;
      let i: number;
      while ((i = ebuf.indexOf('\n')) >= 0) {
        const line = ebuf.slice(0, i);
        ebuf = ebuf.slice(i + 1);
        if (line.trim()) opts.onErrLine?.(line);
      }
    });
    child.on('error', (err) => {
      stderr += String(err);
    });
    child.on('close', (code) => {
      if (buf.trim()) opts.onLine?.(buf);
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, aborted, timedOut });
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export function which(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 15_000 }, (err) => resolve(!err));
  });
}
