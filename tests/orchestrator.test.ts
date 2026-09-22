/**
 * Orchestrator integration tests against a real (embedded) Postgres: every
 * scenario goes through the same code paths the API routes use.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { createTask } from '@/server/orchestrator/tasks';
import { claimDeliveries, postMessage } from '@/server/orchestrator/router';
import { completeDelivery, toInboxItems } from '@/server/orchestrator/runs';
import { executeAgentAction } from '@/server/orchestrator/actions';
import { decideApproval, setPermission, stopAll, resumeAll, setMode, issueToken, seedPermissions } from '@/server/orchestrator/moderator';
import { agentViews, getAgentBySlug, getAgentByTokenHash, getTask, requireProject, effectivePermissions } from '@/server/orchestrator/repo';
import { bridgeHeartbeat, bridgeHello, bridgeCommandResult } from '@/server/orchestrator/bridge';
import { drainHostedQueue } from '@/server/orchestrator/hosted';
import { snapshot } from '@/server/orchestrator/state';
import { sha256 } from '@/server/security/crypto';
import type { AgentRow, ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let claude: AgentRow;
let gpt: AgentRow;
let gemini: AgentRow;
const user = { kind: 'user' as const, id: '', name: 'Mar' };

async function fresh() {
  __setDb(undefined);
  process.env.PGLITE_DIR = 'memory';
  delete process.env.DATABASE_URL;
  db = await getDb();
  const s = await runSetup(db, {
    email: 'mod@example.com',
    display_name: 'Mar',
    password: 'a-very-long-password',
    project_name: 'Demo',
    project_key: 'DF',
    repo: 'acme/web',
    default_branch: 'main',
  });
  user.id = s.userId;
  project = await requireProject(db);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
  gpt = (await getAgentBySlug(db, project.id, 'gpt'))!;
  gemini = (await getAgentBySlug(db, project.id, 'gemini'))!;
}

const reload = async () => {
  project = await requireProject(db);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
  gpt = (await getAgentBySlug(db, project.id, 'gpt'))!;
};

const pendingFor = async (agentId: string) =>
  (await db.query<{ n: number }>(`select count(*)::int n from deliveries where agent_id=$1 and status='PENDING'`, [agentId])).rows[0].n;

describe('orchestrator', () => {
  beforeEach(fresh, 30_000);

  it('setup seeds project, three agents and role-based permissions', async () => {
    expect(project.key).toBe('DF');
    expect(await effectivePermissions(db, claude.id)).toMatchObject({ read: true, write: true, commit: true, push: false, merge: false });
    expect(await effectivePermissions(db, gpt.id)).toMatchObject({ push: true, merge: false });
    expect(await effectivePermissions(db, gemini.id)).toMatchObject({ write: false, commit: false });
    const views = await agentViews(db, project);
    // no bridge connected / no API key → honest OFFLINE, never faked
    expect(views.find((v) => v.slug === 'claude')!.status).toBe('OFFLINE');
    expect(views.find((v) => v.slug === 'gemini')!.status_reason).toMatch(/GEMINI_API_KEY/);
  });

  it('task → delivery → bridge claim builds a budgeted context and starts the task', async () => {
    const t = await createTask(db, { project, actor: user, title: 'Fix login', description: 'Users cannot log in', assignedAgentId: claude.id });
    expect(t.key).toBe('DF-001');
    expect(t.status).toBe('PLANNING');
    expect(await pendingFor(claude.id)).toBe(1);
    const [d] = await claimDeliveries(db, claude.id);
    const [item] = await toInboxItems(db, project, claude, [d]);
    expect(item.message.message_type).toBe('TASK');
    expect(item.context.prompt).toContain('DF-001: Fix login');
    expect(item.context.prompt).toContain('Git safety');
    expect((await getTask(db, t.id)).status).toBe('IN_PROGRESS');
    // a second claim gets nothing (lease held)
    expect(await claimDeliveries(db, claude.id)).toHaveLength(0);
    await completeDelivery(db, claude, d.id, { status: 'DONE', resultText: 'Implemented the fix.' });
    const after = await getTask(db, t.id);
    expect(after.status).toBe('WAITING_USER'); // turn ended with no handoff → moderator decides
    const msgs = await db.query<{ message_type: string; content: string }>(`select message_type, content from messages where task_id=$1 order by seq`, [t.id]);
    expect(msgs.rows.map((m) => m.message_type)).toEqual(['TASK', 'RESULT']);
  });

  it('MODERATED: review request is held for approval, then delivered to the auditor', async () => {
    const t = await createTask(db, { project, actor: user, title: 'Feature', assignedAgentId: claude.id });
    const r = await executeAgentAction(db, claude, { action: 'request_review', task_id: t.id, content: 'Please audit' });
    expect(r.outcome).toBe('held_for_approval');
    expect(await pendingFor(gpt.id)).toBe(0);
    const approval = (await db.query<{ id: string }>(`select * from approvals where id=$1`, [r.approval_id])).rows[0] as never;
    await decideApproval(db, project, approval, user, true, '');
    expect(await pendingFor(gpt.id)).toBe(1);
    const task = await getTask(db, t.id);
    expect(task.status).toBe('WAITING_REVIEW');
    expect(task.next_agent).toBe(gpt.id);
  });

  it('SUPERVISED: agents hand off directly; reviewer verdict CHANGES_REQUESTED returns work to the author', async () => {
    await setMode(db, project, user, 'SUPERVISED');
    await reload();
    const t = await createTask(db, { project, actor: user, title: 'Feature', assignedAgentId: claude.id });
    expect((await executeAgentAction(db, claude, { action: 'request_review', to: 'gpt', task_id: t.id, content: 'audit pls' })).outcome).toBe('delivered');
    const v = await executeAgentAction(db, gpt, {
      action: 'record_review',
      task_id: t.id,
      verdict: 'CHANGES_REQUESTED',
      summary: 'Two problems',
      findings: [{ file: 'src/a.ts', note: 'null check' }],
    });
    expect(v.ok).toBe(true);
    const task = await getTask(db, t.id);
    expect(task.assigned_agent).toBe(claude.id);
    expect(task.status).toBe('IN_PROGRESS');
    const toClaude = await db.query<{ message_type: string }>(`select m.message_type from deliveries d join messages m on m.id=d.message_id where d.agent_id=$1 order by m.seq desc limit 1`, [claude.id]);
    expect(toClaude.rows[0].message_type).toBe('REVIEW');
  });

  it('permissions: builder cannot push; researcher cannot commit; temporary grant works and expires', async () => {
    const t = await createTask(db, { project, actor: user, title: 'x', assignedAgentId: claude.id });
    expect((await executeAgentAction(db, claude, { action: 'git_request', op: 'push', task_id: t.id, branch: 'df-1' })).outcome).toBe('denied');
    expect((await executeAgentAction(db, gemini, { action: 'git_request', op: 'commit', task_id: t.id, message: 'x' })).outcome).toBe('denied');
    await setPermission(db, claude, user, { action: 'push', allowed: true, temporaryMinutes: 5, reason: 'test' });
    expect((await effectivePermissions(db, claude.id)).push).toBe(true);
    // still needs approval in MODERATED
    expect((await executeAgentAction(db, claude, { action: 'git_request', op: 'push', task_id: t.id, branch: 'df-1' })).outcome).toBe('held_for_approval');
    await db.query(`update permissions set expires_at = now() - interval '1 minute' where agent_id=$1 and scope='temporary'`, [claude.id]);
    expect((await effectivePermissions(db, claude.id)).push).toBe(false);
  });

  it('AUTONOMOUS: auditor push becomes a COMMAND for its bridge; bridge result updates task + git refs', async () => {
    await setMode(db, project, user, 'AUTONOMOUS');
    await reload();
    const t = await createTask(db, { project, actor: user, title: 'ship it', assignedAgentId: gpt.id });
    const r = await executeAgentAction(db, gpt, { action: 'git_request', op: 'push', task_id: t.id, branch: 'df-001-ship' });
    expect(r.outcome).toBe('delivered');
    const cmd = await db.query<{ meta: { command: string; branch: string } }>(`select meta from messages where message_type='COMMAND' and task_id=$1`, [t.id]);
    expect(cmd.rows[0].meta).toMatchObject({ command: 'git_push', branch: 'df-001-ship' });
    await bridgeCommandResult(db, gpt, { task_id: t.id, command: 'git_push', ok: true, output: 'pushed', branch: 'df-001-ship' });
    const task = await getTask(db, t.id);
    expect(task.current_branch).toBe('df-001-ship');
    const refs = await db.query(`select kind, ref from git_refs where task_id=$1`, [t.id]);
    expect(refs.rows).toContainEqual({ kind: 'branch', ref: 'df-001-ship' });
    // merge is never automatic
    expect((await executeAgentAction(db, gpt, { action: 'git_request', op: 'merge', task_id: t.id })).outcome).toBe('denied'); // no merge permission
  });

  it('hop limit pauses runaway agent-to-agent chains until the moderator continues', async () => {
    await setMode(db, project, user, 'AUTONOMOUS');
    await db.query('update projects set max_auto_hops=2 where id=$1', [project.id]);
    await reload();
    const t = await createTask(db, { project, actor: user, title: 'chat', assignedAgentId: claude.id });
    const say = (from: AgentRow, to: string) => executeAgentAction(db, from, { action: 'send_message', to, type: 'QUESTION', content: 'ping', task_id: t.id });
    expect((await say(claude, 'gpt')).outcome).toBe('delivered');
    expect((await say(gpt, 'claude')).outcome).toBe('delivered');
    const third = await say(claude, 'gpt');
    expect(third.outcome).toBe('held_for_approval');
    // moderator speaking resets the counter
    await postMessage(db, { project, task: await getTask(db, t.id), from: user, to: { agentId: claude.id }, type: 'REQUEST', content: 'go on' });
    expect((await say(claude, 'gpt')).outcome).toBe('delivered');
  });

  it('STOP ALL holds queued work, cancels in-flight runs and resumes cleanly', async () => {
    const t = await createTask(db, { project, actor: user, title: 'x', assignedAgentId: claude.id });
    const [inflight] = await claimDeliveries(db, claude.id);
    await postMessage(db, { project, task: await getTask(db, t.id), from: user, to: { agentId: gpt.id }, type: 'REQUEST', content: 'queued' });
    await stopAll(db, project, user, 'test');
    await reload();
    expect(project.halted).toBe(true);
    expect(await pendingFor(gpt.id)).toBe(0);
    expect(await claimDeliveries(db, gpt.id)).toHaveLength(0); // held
    const token = await issueToken(db, claude, user);
    claude = (await getAgentByTokenHash(db, sha256(token)))!;
    const hello = await bridgeHello(db, claude, { protocol: 1, client_version: 't', runner: 'echo', tools: [], workspace: {} });
    const hb = await bridgeHeartbeat(db, claude, { session_id: hello.session_id, status: 'WORKING' });
    expect(hb.halted).toBe(true);
    expect(hb.cancel_delivery_ids).toContain(inflight.id);
    // agents cannot act while halted
    expect((await executeAgentAction(db, gpt, { action: 'send_message', to: 'claude', type: 'QUESTION', content: 'x', task_id: t.id })).outcome).toBe('denied');
    await resumeAll(db, project, user);
    expect(await pendingFor(gpt.id)).toBe(1);
  });

  it('agents cannot author moderator-only message types or talk to unknown agents', async () => {
    const r1 = await executeAgentAction(db, claude, { action: 'send_message', to: 'gpt', type: 'COMMAND', content: 'git push --force' });
    expect(r1.outcome).toBe('denied');
    await expect(executeAgentAction(db, claude, { action: 'send_message', to: 'mallory', type: 'QUESTION', content: 'hi' })).rejects.toThrow(/Unknown agent/);
  });

  it('bridge presence drives the displayed status (real heartbeats only)', async () => {
    const token = await issueToken(db, claude, user);
    const a = (await getAgentByTokenHash(db, sha256(token)))!;
    const hello = await bridgeHello(db, a, { protocol: 1, client_version: 'test', runner: 'claude-code', tools: ['claude-code'], workspace: { branch: 'main', commit: 'a'.repeat(40) } });
    let v = (await agentViews(db, project)).find((x) => x.slug === 'claude')!;
    expect(v.status).toBe('ONLINE');
    await bridgeHeartbeat(db, a, { session_id: hello.session_id, status: 'THINKING', activity: 'reading files' });
    v = (await agentViews(db, project)).find((x) => x.slug === 'claude')!;
    expect(v.status).toBe('THINKING');
    expect(v.activity).toBe('reading files');
    await db.query(`update agent_sessions set last_heartbeat_at = now() - interval '5 minutes' where agent_id=$1`, [a.id]);
    v = (await agentViews(db, project)).find((x) => x.slug === 'claude')!;
    expect(v.status).toBe('OFFLINE');
  });

  it('hosted agent without API key fails the delivery with a clear reason (no fake answer)', async () => {
    delete process.env.GEMINI_API_KEY;
    const t = await createTask(db, { project, actor: user, title: 'research', assignedAgentId: gemini.id });
    await drainHostedQueue();
    const err = await db.query<{ content: string }>(`select content from messages where task_id=$1 and message_type='ERROR'`, [t.id]);
    expect(err.rows[0].content).toMatch(/not configured|GEMINI_API_KEY/);
  });

  it('paid API budget is enforced by policy before calling the provider', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-used';
    await db.query(`update projects set settings = settings || '{"daily_token_budget": 10}'::jsonb where id=$1`, [project.id]);
    await db.query(`insert into agent_runs (agent_id, status, tokens_in, tokens_out, started_at) values ($1,'SUCCEEDED',8,5,now())`, [gemini.id]);
    const t = await createTask(db, { project, actor: user, title: 'research', assignedAgentId: gemini.id });
    await drainHostedQueue();
    const err = await db.query<{ content: string }>(`select content from messages where task_id=$1 and message_type='ERROR'`, [t.id]);
    expect(err.rows[0].content).toMatch(/Daily token budget reached/);
    const audit = await db.query(`select payload from events where type='policy.decision' and payload->>'action'='paid_api_call' and payload->>'decision'='deny'`);
    expect(audit.rowCount).toBeGreaterThan(0);
    delete process.env.GEMINI_API_KEY;
  });

  it('deploy always needs approval and needs the deploy permission', async () => {
    await setMode(db, project, user, 'AUTONOMOUS');
    await reload();
    const t = await createTask(db, { project, actor: user, title: 'ship', assignedAgentId: gpt.id });
    expect((await executeAgentAction(db, gpt, { action: 'git_request', op: 'deploy', task_id: t.id })).outcome).toBe('denied');
    await setPermission(db, gpt, user, { action: 'deploy', allowed: true, reason: 'test' });
    expect((await executeAgentAction(db, gpt, { action: 'git_request', op: 'deploy', task_id: t.id })).outcome).toBe('held_for_approval');
  });

  it('DEMO mode: simulated agents run the whole flow through the same state + policy path, without touching git', async () => {
    process.env.ACC_SIM_DELAY_FACTOR = '0';
    await setMode(db, project, user, 'DEMO');
    await reload();
    // every agent is available (simulated) even with no bridge / API key — and says so
    const views = await agentViews(db, project);
    expect(views.every((v) => v.status !== 'OFFLINE' && v.simulated)).toBe(true);
    const t = await createTask(db, { project, actor: user, title: 'Fix login', assignedAgentId: claude.id });
    for (let i = 0; i < 6; i++) await drainHostedQueue();
    const types = (await db.query<{ message_type: string; content: string }>(`select message_type, content from messages where task_id=$1 order by seq`, [t.id])).rows;
    // builder → review request → auditor CHANGES_REQUESTED → builder fixes → auditor APPROVED → push needs approval (SUPERVISED rules)
    expect(types.filter((m) => m.message_type === 'REVIEW').length).toBeGreaterThanOrEqual(3);
    expect(types.some((m) => m.content.startsWith('[SIMULADO]'))).toBe(true);
    const pending = await db.query<{ action: string }>(`select action from approvals where task_id=$1 and status='PENDING'`, [t.id]);
    expect(pending.rows.map((r) => r.action)).toContain('push');
    // no COMMAND ever reaches a bridge in DEMO
    expect((await db.query(`select 1 from messages where message_type='COMMAND' and task_id=$1`, [t.id])).rowCount).toBe(0);
    const approval = (await db.query(`select * from approvals where task_id=$1 and status='PENDING' and action='push'`, [t.id])).rows[0] as never;
    const decision = await decideApproval(db, project, approval, user, true, '');
    expect((decision.result as { outcome?: string } | undefined)?.outcome).toBe('done');
    const sim = await db.query<{ content: string }>(`select content from messages where task_id=$1 and content like '[SIMULADO] git push%'`, [t.id]);
    expect(sim.rowCount).toBe(1);
  });

  it('snapshot exposes no secrets and carries the server-computed system state', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await issueToken(db, claude, user);
    const snap = await snapshot(db, project);
    expect(snap.system.state).toBe('NO_AGENTS');
    const s = JSON.stringify(snap);
    expect(s).not.toMatch(/token_hash|password_hash/);
  });
});

describe('hosted provider round-trip (OpenAI-compatible mock server)', () => {
  let server: Server;
  let url = '';
  const seen: { auth?: string; body: { model: string; messages: { role: string; content: string }[] } }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body: JSON.parse(b) });
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Second opinion: approach B is safer.\n```acc-actions\n[{"action":"send_message","to":"claude","type":"PROPOSAL","content":"Use approach B"}]\n```',
                },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 30 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  afterAll(() => server.close());

  it('runs the model, posts its answer and executes its declared actions through policy', async () => {
    await fresh();
    process.env.LOCALTEST_API_KEY = 'sk-local-test';
    const r = await db.query<{ id: string }>(
      `insert into agents (project_id, slug, name, runtime, transport, model, role, role_label, config)
       values ($1,'qwen','Qwen','openai-compatible','http-api','qwen-test','RESEARCHER','Researcher',$2) returning id`,
      [project.id, JSON.stringify({ base_url: url, api_key_env: 'LOCALTEST_API_KEY' })],
    );
    await seedPermissions(db, r.rows[0].id, 'RESEARCHER', user.id);
    const t = await createTask(db, { project, actor: user, title: 'Compare A vs B', assignedAgentId: r.rows[0].id });
    await drainHostedQueue();
    expect(seen).toHaveLength(1);
    expect(seen[0].auth).toBe('Bearer sk-local-test');
    expect(seen[0].body.model).toBe('qwen-test');
    expect(seen[0].body.messages[1].content).toContain('Compare A vs B');
    const msgs = await db.query<{ message_type: string; content: string; to_agent: string | null }>(`select message_type, content, to_agent from messages where task_id=$1 order by seq`, [t.id]);
    expect(msgs.rows.map((m) => m.message_type)).toEqual(['TASK', 'RESULT', 'PROPOSAL']);
    expect(msgs.rows[1].content).toBe('Second opinion: approach B is safer.');
    expect(msgs.rows[2].to_agent).toBe(claude.id);
    const run = await db.query<{ status: string; tokens_in: number }>(`select status, tokens_in from agent_runs where task_id=$1`, [t.id]);
    expect(run.rows[0]).toMatchObject({ status: 'SUCCEEDED', tokens_in: 120 });
  });
});
