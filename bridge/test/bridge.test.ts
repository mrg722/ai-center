/**
 * Bridge tests — node:test, zero dependencies.
 * Run: npm run test (inside bridge/) → compiles then runs dist tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { commit, push, workspaceState, parseGithubRepo, installPushGuard, isValidBranchName } from '../src/git.js';
import { buildClaudeArgs } from '../src/runners/claude-code.js';
import { buildCodexArgs } from '../src/runners/codex.js';
import { parseFlags } from '../src/config.js';
import { redact } from '../src/log.js';
import { sanitizedChildEnv } from '../src/runners/proc.js';
import { resolveToolServer } from '../src/worker.js';
import type { AgentIdentity } from '../../src/shared/protocol';

const perms = (over: Partial<AgentIdentity['permissions']> = {}): AgentIdentity['permissions'] => ({
  read: true,
  write: true,
  commit: true,
  push: false,
  merge: false,
  dangerous_operations: false,
  handoff: true,
  create_task: true,
  pr_create: false,
  deploy: false,
  paid_api: true,
  ...over,
});
const agent = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: 'a',
  slug: 'claude',
  name: 'Claude',
  role: 'PRIMARY_BUILDER',
  role_label: 'Builder',
  runtime: 'claude-code',
  provider: 'anthropic',
  model: '',
  permissions: perms(),
  ...over,
});

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'acc-bridge-test-'));
  const remote = join(root, 'remote.git');
  const ws = join(root, 'ws');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', ws]);
  sh(ws, 'config', 'user.email', 't@example.com');
  sh(ws, 'config', 'user.name', 'Test');
  sh(ws, 'config', 'commit.gpgsign', 'false');
  sh(ws, 'remote', 'add', 'origin', remote);
  writeFileSync(join(ws, 'README.md'), '# test\n');
  sh(ws, 'add', '-A');
  sh(ws, 'commit', '-q', '-m', 'init');
  return { root, remote, ws };
}

test('parseGithubRepo handles https and ssh remotes', () => {
  assert.equal(parseGithubRepo('https://github.com/acme/web.git'), 'acme/web');
  assert.equal(parseGithubRepo('git@github.com:acme/web.git'), 'acme/web');
  assert.equal(parseGithubRepo('https://gitlab.com/acme/web.git'), undefined);
});

test('commit stages, commits with task trailers and reports the sha', async () => {
  const { ws } = tempRepo();
  writeFileSync(join(ws, 'a.txt'), 'hello');
  const r = await commit(ws, 'feat: add a', undefined, { 'ACC-Task': 'ACC-001', 'ACC-Agent': 'claude' });
  assert.equal(r.ok, true, r.output);
  assert.match(r.commit ?? '', /^[0-9a-f]{40}$/);
  const msg = sh(ws, 'log', '-1', '--format=%B');
  assert.match(msg, /ACC-Task: ACC-001/);
  const nothing = await commit(ws, 'empty', undefined, {});
  assert.equal(nothing.ok, false);
});

test('push refuses protected branches and invalid names, never forces', async () => {
  const { ws, remote } = tempRepo();
  const prot = await push(ws, 'main', 'origin', ['main', 'master']);
  assert.equal(prot.ok, false);
  assert.match(prot.output, /protected/);
  const bad = await push(ws, '--force', 'origin', []);
  assert.equal(bad.ok, false);
  assert.equal(await isValidBranchName(ws, 'feature/ok-1'), true);
  assert.equal(await isValidBranchName(ws, 'bad..name'), false);

  sh(ws, 'checkout', '-q', '-b', 'acc-001-feature');
  writeFileSync(join(ws, 'b.txt'), 'b');
  await commit(ws, 'feat: b', undefined, {});
  const ok = await push(ws, 'acc-001-feature', 'origin', ['main']);
  assert.equal(ok.ok, true, ok.output);
  assert.ok(sh(remote, 'branch', '--list', 'acc-001-feature').includes('acc-001-feature'));

  // diverge the remote → a non-force push must be rejected, not overwritten
  const other = join(mkdtempSync(join(tmpdir(), 'acc-other-')), 'o');
  execFileSync('git', ['clone', '-q', '-b', 'acc-001-feature', remote, other]);
  sh(other, 'config', 'user.email', 'o@example.com');
  sh(other, 'config', 'user.name', 'O');
  sh(other, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(other, 'c.txt'), 'c');
  sh(other, 'add', '-A');
  sh(other, 'commit', '-q', '-m', 'other');
  sh(other, 'push', '-q', 'origin', 'acc-001-feature');
  sh(ws, 'commit', '-q', '--allow-empty', '-m', 'local');
  const rejected = await push(ws, 'acc-001-feature', 'origin', []);
  assert.equal(rejected.ok, false, 'diverged push must fail without --force');
});

test('workspaceState reports branch, commit and dirty files', async () => {
  const { ws } = tempRepo();
  writeFileSync(join(ws, 'dirty.txt'), 'x');
  const s = await workspaceState(ws);
  assert.equal(s.branch, 'main');
  assert.match(s.commit ?? '', /^[0-9a-f]{40}$/);
  assert.deepEqual(s.dirty_files, ['dirty.txt']);
});

test('push guard is installed once and never overwrites an existing hook', () => {
  const { ws } = tempRepo();
  assert.equal(installPushGuard(ws), 'installed');
  assert.equal(installPushGuard(ws), 'exists');
  assert.match(readFileSync(join(ws, '.git/hooks/pre-push'), 'utf8'), /AI Command Center/);
});

test('claude args: permissions shape allowed/disallowed tools; git always routed through orchestrator', () => {
  const rw = buildClaudeArgs({ agent: agent(), mcpConfigPath: '/tmp/x.json', extraArgs: [] });
  assert.ok(rw.includes('acceptEdits'));
  assert.ok(rw.includes('Edit'));
  assert.ok(rw.includes('Bash(git push:*)'));
  assert.ok(rw.includes('Bash(git commit:*)'));
  assert.ok(rw.includes('Bash(rm -rf:*)'));
  assert.ok(rw.includes('--mcp-config'));
  const ro = buildClaudeArgs({ agent: agent({ permissions: perms({ write: false }) }), mcpConfigPath: null, extraArgs: [] });
  assert.ok(!ro.includes('Edit'));
  assert.ok(!ro.includes('Bash'));
  assert.ok(ro.includes('default'));
});

test('codex args: sandbox follows write permission; token never on argv', () => {
  const a = buildCodexArgs({ agent: agent(), mcpServer: { command: '/usr/bin/node', args: ['cli.js', 'mcp', '--token-file', '/tmp/t'] }, extraArgs: [] }, '/tmp/last');
  assert.deepEqual(a.slice(0, 4), ['exec', '--json', '--sandbox', 'workspace-write']);
  assert.ok(a.includes('-o'));
  assert.equal(a[a.length - 1], '-');
  assert.ok(a.some((x) => x.startsWith('mcp_servers.acc.args=')));
  assert.ok(!a.join(' ').includes('acc_'));
  const ro = buildCodexArgs({ agent: agent({ permissions: perms({ write: false }) }), mcpServer: null, extraArgs: [] }, '/tmp/last');
  assert.equal(ro[3], 'read-only');
});

test('flags parser + log redaction', () => {
  assert.deepEqual(parseFlags(['--url', 'http://x', '--runner=echo', '--flag']), { url: 'http://x', runner: 'echo', flag: 'true' });
  const s = redact('token acc_claude_abcdefghijklmnopqrstuvwxyz0123 and Bearer sk-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz');
  assert.ok(!s.includes('abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(!s.includes('sk-abcdefghijklmnop'));
  assert.ok(!s.includes('ghp_abcdefghijklmnopqrstuvwxyz'));
});

test('tool servers resolve env from the local machine and skip when missing', () => {
  process.env.ACC_TEST_FIRECRAWL_KEY = 'fc-local';
  const ok = resolveToolServer({ name: 'firecrawl', transport: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'], env_vars: ['ACC_TEST_FIRECRAWL_KEY'], enabled: true });
  assert.deepEqual((ok as { env: Record<string, string> }).env, { ACC_TEST_FIRECRAWL_KEY: 'fc-local' });
  assert.equal(resolveToolServer({ name: 'x', transport: 'stdio', command: 'npx', env_vars: ['NOPE_NOT_SET_KEY'], enabled: true }), null);
  assert.equal(resolveToolServer({ name: 'acc', transport: 'stdio', command: 'evil', enabled: true }), null, 'cannot shadow the acc server');
  assert.equal(resolveToolServer({ name: 'p', transport: 'stdio', command: 'npx', enabled: false }), null);
});

test('MCP server speaks JSON-RPC over stdio and forwards tool calls to the orchestrator', async () => {
  const received: { path: string; auth: string; body: unknown }[] = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', auth: String(req.headers.authorization), body: b ? JSON.parse(b) : null });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, outcome: 'delivered', message_id: 'm1' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), 'acc-mcp-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, 'acc_claude_' + 'x'.repeat(43), { mode: 0o600 });
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  assert.ok(existsSync(cli));
  const child = spawn(process.execPath, [cli, 'mcp', '--url', `http://127.0.0.1:${port}`, '--token-file', tokenFile, '--task-id', '11111111-1111-1111-1111-111111111111']);
  const lines: Record<string, unknown>[] = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (o: object) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'acc_request_review', arguments: { to: 'gpt', content: 'please audit' } } });
  const deadline = Date.now() + 5000;
  while (lines.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  srv.close();
  const byId = new Map(lines.map((l) => [l.id, l]));
  assert.equal((byId.get(1) as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'acc');
  const tools = (byId.get(2) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  for (const t of ['acc_send_message', 'acc_handoff', 'acc_request_review', 'acc_git_request', 'acc_request_approval']) assert.ok(tools.includes(t), t);
  assert.equal((byId.get(3) as { result: { isError: boolean } }).result.isError, false);
  assert.equal(received[0].path, '/api/agent/actions');
  assert.match(received[0].auth, /^Bearer acc_claude_/);
  assert.deepEqual(received[0].body, {
    action: 'request_review',
    to: 'gpt',
    task_id: '11111111-1111-1111-1111-111111111111',
    content: 'please audit',
  });
});


test('local agent child env strips secrets by default', () => {
  process.env.OPENAI_API_KEY = 'should-not-enter-child';
  const githubTokenName = ['GITHUB', 'TOKEN'].join('_');
  process.env[githubTokenName] = 'should-not-enter-child';
  process.env.NORMAL_TEST_VAR = 'safe';
  const child = sanitizedChildEnv({ CUSTOM_TEST_VAR: 'safe-too', CUSTOM_API_KEY: 'also-secret' });
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child[githubTokenName], undefined);
  assert.equal(child.CUSTOM_API_KEY, undefined);
  assert.equal(child.NORMAL_TEST_VAR, 'safe');
  assert.equal(child.CUSTOM_TEST_VAR, 'safe-too');
});
