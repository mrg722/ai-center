import { execFile } from 'node:child_process';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceState } from '../../src/shared/protocol';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs git WITHOUT a shell (no injection through branch names / messages). */
export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout).trim(), stderr: String(stderr).trim() }),
    );
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout === 'true';
}

export function parseGithubRepo(remoteUrl: string): string | undefined {
  const m = remoteUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

export async function workspaceState(cwd: string): Promise<WorkspaceState> {
  if (!(await isGitRepo(cwd))) return {};
  const [branch, commit, status, remote, counts] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1']),
    git(cwd, ['remote', 'get-url', 'origin']),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
  ]);
  const dirty = status.ok
    ? status.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3).trim())
        .slice(0, 200)
    : [];
  const [behind, ahead] = counts.ok ? counts.stdout.split(/\s+/).map(Number) : [undefined, undefined];
  return {
    repo: remote.ok ? parseGithubRepo(remote.stdout) : undefined,
    branch: branch.ok ? branch.stdout : undefined,
    commit: commit.ok ? commit.stdout : undefined,
    dirty_files: dirty,
    ahead,
    behind,
  };
}

export async function isValidBranchName(cwd: string, branch: string): Promise<boolean> {
  if (!branch || branch.startsWith('-') || branch.length > 200) return false;
  return (await git(cwd, ['check-ref-format', '--branch', branch])).ok;
}

/** Stage + commit. Never amends, never uses --no-verify. */
export async function commit(
  cwd: string,
  message: string,
  files: string[] | undefined,
  trailers: Record<string, string>,
): Promise<{ ok: boolean; output: string; commit?: string }> {
  const safeFiles = (files ?? []).filter((f) => f && !f.startsWith('-') && !f.includes('\0'));
  const add = safeFiles.length ? await git(cwd, ['add', '--', ...safeFiles]) : await git(cwd, ['add', '-A']);
  if (!add.ok) return { ok: false, output: add.stderr };
  const staged = await git(cwd, ['diff', '--cached', '--name-only']);
  if (!staged.stdout) return { ok: false, output: 'Nothing staged to commit.' };
  const trailerText = Object.entries(trailers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const msg = `${message.trim().slice(0, 5000)}\n\n${trailerText}`;
  const res = await git(cwd, ['commit', '-m', msg]);
  if (!res.ok) return { ok: false, output: res.stderr || res.stdout };
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  return { ok: true, output: res.stdout, commit: head.stdout };
}

/** Push a branch. Never forces, never deletes, refuses protected branches. */
export async function push(
  cwd: string,
  branch: string,
  remote: string,
  protectedBranches: string[],
): Promise<{ ok: boolean; output: string }> {
  if (!(await isValidBranchName(cwd, branch))) return { ok: false, output: `Invalid branch name: ${branch}` };
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) return { ok: false, output: `Invalid remote: ${remote}` };
  if (protectedBranches.includes(branch)) {
    return { ok: false, output: `Branch "${branch}" is protected on this bridge. Push a feature branch and open a PR.` };
  }
  const res = await git(cwd, ['push', '--set-upstream', remote, `${branch}:${branch}`], { ACC_BRIDGE_PUSH: '1' });
  return { ok: res.ok, output: (res.stdout + '\n' + res.stderr).trim() };
}

const GUARD_MARK = '# installed by AI Command Center bridge';

/**
 * Optional defense-in-depth: a pre-push hook that rejects pushes not executed
 * by the bridge. Never overwrites an existing hook.
 * This is a guardrail, NOT a security boundary (an agent with shell access
 * could remove it). Real enforcement = GitHub branch protection + token scope.
 */
export function installPushGuard(cwd: string): 'installed' | 'exists' | 'skipped' {
  const hook = join(cwd, '.git', 'hooks', 'pre-push');
  if (!existsSync(join(cwd, '.git', 'hooks'))) return 'skipped';
  if (existsSync(hook)) return 'exists';
  writeFileSync(
    hook,
    `#!/bin/sh\n${GUARD_MARK}\nif [ "$ACC_BRIDGE_PUSH" != "1" ]; then\n  echo "AI Command Center: pushes from this workspace must be approved and executed by the bridge." >&2\n  exit 1\nfi\n`,
  );
  chmodSync(hook, 0o755);
  return 'installed';
}
