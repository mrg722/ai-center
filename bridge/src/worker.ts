import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeConfig } from './config.js';
import { OrchestratorClient, HttpError } from './client.js';
import { log } from './log.js';
import { workspaceState, commit as gitCommit, push as gitPush, installPushGuard, isGitRepo } from './git.js';
import type { Runner } from './runners/types.js';
import { claudeCodeRunner } from './runners/claude-code.js';
import { codexRunner } from './runners/codex.js';
import { antigravityRunner } from './runners/antigravity.js';
import { commandRunner } from './runners/command.js';
import { echoRunner } from './runners/echo.js';
import { PROTOCOL_VERSION } from '../../src/shared/protocol.js';
import type {
  AgentIdentity,
  BridgeCommand,
  HelloResponse,
  InboxItem,
  ToolServerConfig,
  WorkspaceState,
} from '../../src/shared/protocol';

export const BRIDGE_VERSION = '0.1.0';

type SessionStatus = 'ONLINE' | 'WORKING' | 'THINKING' | 'WAITING' | 'REVIEWING' | 'ERROR' | 'BLOCKED';

export function makeRunner(cfg: BridgeConfig): Runner {
  switch (cfg.runner) {
    case 'claude-code':
      return claudeCodeRunner(cfg.runnerBin ?? 'claude');
    case 'codex':
      return codexRunner(cfg.runnerBin ?? 'codex');
    case 'antigravity':
      return antigravityRunner(cfg.runnerBin ?? 'agy');
    case 'command':
      return commandRunner(cfg.command ?? []);
    default:
      return echoRunner();
  }
}

/**
 * Agent Bridge worker: authenticates, announces presence, heartbeats,
 * long-polls its inbox, runs the local agent CLI and reports back.
 * It never exposes local secrets: API keys of the CLI stay on this machine.
 */
export class BridgeWorker {
  private client: OrchestratorClient;
  private runner: Runner;
  private hello!: HelloResponse;
  private agent!: AgentIdentity;
  private status: SessionStatus = 'ONLINE';
  private activity = '';
  private currentTask: string | null = null;
  private currentDelivery: string | null = null;
  private abort: AbortController | null = null;
  private stopping = false;
  private halted = false;
  private paused = false;
  private hbTimer: NodeJS.Timeout | null = null;
  private workspace: WorkspaceState = {};
  private lastActivityPost = 0;

  constructor(private cfg: BridgeConfig) {
    this.client = new OrchestratorClient(cfg.url, cfg.token);
    this.runner = makeRunner(cfg);
  }

  async start(): Promise<void> {
    const problem = await this.runner.check();
    if (problem) throw new Error(problem);
    if (!(await isGitRepo(this.cfg.workspace))) {
      log.warn(`Workspace ${this.cfg.workspace} is not a git repository — git features disabled.`);
    } else if (this.cfg.installPushGuard) {
      log.info(`pre-push guard: ${installPushGuard(this.cfg.workspace)}`);
    }

    await this.connect();
    process.on('SIGINT', () => this.stop('SIGINT'));
    process.on('SIGTERM', () => this.stop('SIGTERM'));
    await this.loop();
  }

  private async connect(): Promise<void> {
    let delay = 1000;
    for (;;) {
      try {
        this.workspace = await workspaceState(this.cfg.workspace);
        this.hello = await this.client.hello({
          protocol: PROTOCOL_VERSION,
          client_version: `acc-bridge/${BRIDGE_VERSION} (${hostname().slice(0, 40)})`,
          runner: this.runner.name,
          tools: this.runner.tools(),
          workspace: this.workspace,
        });
        this.agent = this.hello.agent;
        this.halted = this.hello.halted;
        log.info(
          `Connected as ${this.agent.name} (${this.agent.slug}) · role ${this.agent.role} · runner ${this.runner.name} · mode ${this.hello.mode}`,
        );
        this.startHeartbeat();
        return;
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw e;
        log.warn(`Orchestrator unreachable (${(e as Error).message}). Retrying in ${delay / 1000}s`);
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.hbTimer) clearInterval(this.hbTimer);
    const beat = async () => {
      try {
        if (!this.currentDelivery) this.workspace = await workspaceState(this.cfg.workspace);
        const r = await this.client.heartbeat({
          session_id: this.hello.session_id,
          status: this.status,
          activity: this.activity.slice(0, 200),
          current_task_id: this.currentTask,
          workspace: this.workspace,
        });
        this.halted = r.halted;
        this.paused = r.paused;
        this.agent.permissions = r.permissions;
        if (this.abort && this.currentDelivery && (r.halted || r.cancel_delivery_ids.includes(this.currentDelivery))) {
          log.warn(r.halted ? 'STOP ALL received — aborting current run.' : 'Orchestrator cancelled the current run.');
          this.abort.abort();
        }
      } catch (e) {
        log.warn(`heartbeat failed: ${(e as Error).message}`);
        if (e instanceof HttpError && e.status === 401) this.stop('token revoked');
      }
    };
    void beat();
    this.hbTimer = setInterval(beat, this.hello.heartbeat_interval_s * 1000);
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        const res = await this.client.inbox(20);
        this.halted = res.halted;
        for (const item of res.items) {
          if (this.stopping) break;
          await this.handle(item);
        }
      } catch (e) {
        if (this.stopping) break;
        if (e instanceof HttpError && e.status === 401) {
          log.error('Agent token rejected (revoked or rotated). Stopping.');
          break;
        }
        log.warn(`inbox error: ${(e as Error).message}`);
        await sleep(3000);
      }
    }
  }

  private setStatus(status: SessionStatus, activity = this.activity): void {
    this.status = status;
    this.activity = activity;
  }

  private postActivity(kind: 'log' | 'thinking' | 'tool' | 'output', text: string): void {
    this.activity = text.split('\n')[0].slice(0, 200);
    const now = Date.now();
    if (now - this.lastActivityPost < 400 && kind !== 'tool') return; // throttle
    this.lastActivityPost = now;
    this.client.activity({ kind, text: text.slice(0, 500), task_id: this.currentTask }).catch(() => undefined);
  }

  private async handle(item: InboxItem): Promise<void> {
    const started = new Date();
    this.currentDelivery = item.delivery_id;
    this.currentTask = item.task?.id ?? null;
    log.info(`▶ ${item.message.message_type} from ${item.message.from}${item.task ? ` · ${item.task.key}` : ''}`);

    if (item.message.message_type === 'COMMAND') {
      await this.handleCommand(item);
      this.finish();
      return;
    }

    const tmp = mkdtempSync(join(tmpdir(), 'acc-run-'));
    this.abort = new AbortController();
    try {
      const { mcpConfigPath, mcpServer } = this.writeMcpConfig(tmp, item.task?.id ?? null);
      this.setStatus('THINKING', 'reading context');
      const out = await this.runner.run({
        item,
        agent: this.agent,
        workspace: this.cfg.workspace,
        mcpConfigPath,
        mcpServer,
        providerSessionId: this.hello.provider_session_id ?? null,
        signal: this.abort.signal,
        maxRunSeconds: this.cfg.maxRunSeconds,
        extraArgs: this.cfg.runnerArgs,
        bin: this.cfg.runnerBin,
        command: this.cfg.command,
        onActivity: (k, t) => this.postActivity(k, t),
        onStatus: (s) => this.setStatus(s),
        api: (a) => this.client.action(a),
      });
      this.workspace = await workspaceState(this.cfg.workspace);
      await this.client.ack(item.delivery_id, {
        status: 'DONE',
        result_text: out.text.slice(0, 60_000),
        provider_session_id: out.providerSessionId,
        workspace: this.workspace,
        run: {
          started_at: started.toISOString(),
          finished_at: new Date().toISOString(),
          output_chars: out.text.length,
          tokens_in: out.tokens_in,
          tokens_out: out.tokens_out,
          summary: out.text.split('\n')[0].slice(0, 200),
        },
      });
      log.info(`✔ done in ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
      this.finish();
    } catch (e) {
      const msg = (e as Error).message;
      log.error(`✖ run failed: ${msg}`);
      await this.client
        .ack(item.delivery_id, {
          status: 'FAILED',
          error: msg.slice(0, 4000),
          run: { started_at: started.toISOString(), finished_at: new Date().toISOString() },
        })
        .catch(() => undefined);
      this.finish('ERROR', msg.slice(0, 200));
      setTimeout(() => this.status === 'ERROR' && !this.currentDelivery && this.setStatus('ONLINE', ''), 60_000).unref();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      this.abort = null;
    }
  }

  private finish(status: SessionStatus = 'ONLINE', activity = ''): void {
    this.currentDelivery = null;
    this.currentTask = null;
    this.setStatus(status, activity);
  }

  /** Deterministic git operations, executed only after orchestrator policy/approval. */
  private async handleCommand(item: InboxItem): Promise<void> {
    const cmd = item.message.meta as unknown as BridgeCommand;
    const taskKey = item.task?.key ?? 'n/a';
    const report = (ok: boolean, output: string, extra: { commit?: string; branch?: string } = {}) =>
      this.client
        .commandResult({
          approval_id: 'approval_id' in cmd ? cmd.approval_id : undefined,
          task_id: 'task_id' in cmd ? cmd.task_id : '',
          command: cmd.command,
          ok,
          output: output.slice(0, 4000),
          ...extra,
        })
        .catch((e) => log.warn(`command-result failed: ${(e as Error).message}`));

    try {
      if (cmd.command === 'git_commit') {
        this.setStatus('WORKING', 'git commit');
        const r = await gitCommit(this.cfg.workspace, cmd.message, cmd.files, {
          'ACC-Task': taskKey,
          'ACC-Agent': this.agent.slug,
        });
        await report(r.ok, r.output, { commit: r.commit, branch: (await workspaceState(this.cfg.workspace)).branch });
      } else if (cmd.command === 'git_push') {
        if (!this.agent.permissions.push) {
          await report(false, 'Bridge refused: agent has no push permission.');
        } else {
          this.setStatus('WORKING', `git push ${cmd.branch}`);
          const r = await gitPush(this.cfg.workspace, cmd.branch, cmd.remote ?? 'origin', this.cfg.protectedBranches);
          await report(r.ok, r.output, { branch: cmd.branch });
        }
      } else {
        await report(false, `Unknown command ${(cmd as { command: string }).command}`);
      }
      await this.client.ack(item.delivery_id, { status: 'DONE', workspace: await workspaceState(this.cfg.workspace) });
    } catch (e) {
      await report(false, (e as Error).message);
      await this.client.ack(item.delivery_id, { status: 'FAILED', error: (e as Error).message }).catch(() => undefined);
    }
  }

  /**
   * Writes a 0600 MCP config for this run. Contains:
   *  - "acc": this bridge's MCP server (token passed as a FILE path)
   *  - tool servers configured in the Command Center (Firecrawl, Playwright,
   *    Perplexity, ...) whose env values are resolved from THIS machine's env.
   */
  private writeMcpConfig(dir: string, taskId: string | null) {
    const tokenFile = join(dir, 'token');
    writeFileSync(tokenFile, this.cfg.token, { mode: 0o600 });
    const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
    const mcpServer = {
      command: process.execPath,
      args: [cli, 'mcp', '--url', this.cfg.url, '--token-file', tokenFile, ...(taskId ? ['--task-id', taskId] : [])],
    };
    const servers: Record<string, unknown> = { acc: { type: 'stdio', ...mcpServer } };
    for (const ts of this.hello.tool_servers ?? []) {
      const resolved = resolveToolServer(ts);
      if (resolved) servers[ts.name] = resolved;
    }
    const mcpConfigPath = join(dir, 'mcp.json');
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
    return { mcpConfigPath, mcpServer };
  }

  stop(reason: string): void {
    if (this.stopping) return;
    this.stopping = true;
    log.info(`Stopping bridge (${reason})…`);
    this.abort?.abort();
    if (this.hbTimer) clearInterval(this.hbTimer);
    setTimeout(() => process.exit(0), 1500).unref();
  }
}

export function resolveToolServer(ts: ToolServerConfig): Record<string, unknown> | null {
  if (!ts.enabled || !/^[a-z][a-z0-9_-]{0,31}$/.test(ts.name) || ts.name === 'acc') return null;
  const env: Record<string, string> = {};
  for (const name of ts.env_vars ?? []) {
    const v = process.env[name];
    if (!v) {
      log.warn(`Tool server "${ts.name}" skipped: missing local env var ${name}`);
      return null;
    }
    env[name] = v;
  }
  if (ts.transport === 'http' && ts.url) return { type: 'http', url: ts.url };
  if (ts.transport === 'stdio' && ts.command) return { type: 'stdio', command: ts.command, args: ts.args ?? [], env };
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
