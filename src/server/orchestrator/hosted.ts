import { getDb, type Db } from '../db';
import type { AgentRow, ProjectRow } from '../types';
import type { InboxItem } from '../../shared/protocol';
import { emit, emitEphemeral } from '../events/bus';
import { getRuntime, httpReadiness, resolveHttpConfig, resolveModel } from '../providers/registry';
import { resolveNvidiaModel } from '../providers/nvidia';
import { isHttpRuntime } from '../providers/types';
import { parseAgentReply } from './action-parser';
import { validateAgentAction } from '../validation';
import { executeAgentAction, agentActor, authorize } from './actions';
import { claimDeliveries, postMessage } from './router';
import { completeDelivery, toInboxItems } from './runs';
import { getProjectById, getTask } from './repo';
import { simulate } from './simulator';

/**
 * Runner for runtimes the ORCHESTRATOR executes itself:
 *  - http-api    (Gemini, OpenAI API, Anthropic API, Perplexity, Ollama, …)
 *  - in-process  (the DEMO simulator — and every agent while the project is in DEMO mode)
 * These runtimes never touch a workspace; they produce text + declarative
 * actions that go through the same policy engine as everything else.
 */
const g = globalThis as unknown as { __accRunning?: Set<string>; __accDrain?: Promise<void> | null };
const running = (g.__accRunning ??= new Set());

export async function drainHostedQueue(): Promise<void> {
  if (g.__accDrain) return g.__accDrain;
  g.__accDrain = (async () => {
    try {
      const db = await getDb();
      for (let round = 0; round < 20; round++) {
        const agents = (
          await db.query<AgentRow>(
            `select a.* from agents a join projects p on p.id=a.project_id
              where a.enabled and not a.paused and not p.halted
                and (a.transport <> 'local-bridge' or p.mode = 'DEMO')
                and exists (select 1 from deliveries d where d.agent_id=a.id and d.status='PENDING')`,
          )
        ).rows.filter((a) => !running.has(a.id));
        if (!agents.length) break;
        await Promise.all(agents.map((a) => runOne(db, a)));
      }
    } finally {
      g.__accDrain = null;
    }
  })();
  return g.__accDrain;
}

/** Session rows are how every runtime reports AgentState to the single source of truth. */
async function setSession(db: Db, agent: AgentRow, status: string, activity: string, taskId: string | null, client: string) {
  const r = await db.query(
    `update agent_sessions set status=$2, activity=$3, current_task_id=$4, last_heartbeat_at=now(), client_version=$5
      where agent_id=$1 and ended_at is null`,
    [agent.id, status, activity.slice(0, 200), taskId, client],
  );
  if (!r.rowCount) {
    await db.query(`insert into agent_sessions (agent_id, status, activity, current_task_id, client_version) values ($1,$2,$3,$4,$5)`, [
      agent.id,
      status,
      activity.slice(0, 200),
      taskId,
      client,
    ]);
  }
  await emit(db, { project_id: agent.project_id, type: 'agent.status', actor: agentActor(agent), agent_id: agent.id, task_id: taskId, payload: { status, activity } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stillActive(db: Db, deliveryId: string): Promise<boolean> {
  const r = await db.query<{ status: string }>('select status from deliveries where id=$1', [deliveryId]);
  return r.rows[0]?.status === 'DELIVERED';
}

async function runActions(db: Db, project: ProjectRow, agent: AgentRow, item: InboxItem, raw: unknown[], preErrors: string[] = []) {
  const taskId = item.task?.id;
  const notes = [...preErrors];
  for (const a of raw) {
    const isSub = typeof a === 'object' && a && (a as { action?: string }).action === 'create_subtask';
    const withTask = typeof a === 'object' && a ? { ...(isSub ? { parent_task_id: taskId } : { task_id: taskId }), ...(a as object) } : a;
    const v = validateAgentAction(withTask);
    if (!v.ok) {
      notes.push(`invalid action: ${v.error}`);
      continue;
    }
    const res = await executeAgentAction(db, agent, v.action);
    if (!res.ok || res.outcome === 'held_for_approval') notes.push(`${v.action.action}: ${res.outcome}${res.reason ? ` — ${res.reason}` : ''}`);
  }
  if (notes.length) {
    await postMessage(db, {
      project,
      task: taskId ? await getTask(db, taskId) : null,
      from: { kind: 'system' },
      to: { moderator: true },
      type: 'WARNING',
      content: `Actions from ${agent.name}:\n- ${notes.join('\n- ')}`,
    });
  }
}

async function runOne(db: Db, agent: AgentRow): Promise<void> {
  running.add(agent.id);
  try {
    const project = await getProjectById(db, agent.project_id);
    const simulated = project.mode === 'DEMO' || agent.transport === 'in-process';
    const [delivery] = await claimDeliveries(db, agent.id, 1);
    if (!delivery) return;
    const [item] = await toInboxItems(db, project, agent, [delivery]);
    if (!item) return; // failed a policy gate; already reported
    const taskId = item.task?.id ?? null;
    const actor = agentActor(agent);
    const post = async (content: string) =>
      postMessage(db, {
        project,
        task: taskId ? await getTask(db, taskId) : null,
        from: actor,
        to: { moderator: true },
        type: 'RESULT',
        content,
        replyTo: item.message.id,
        meta: simulated ? { simulated: true } : {},
      });

    /* ───────────── DEMO / simulator */
    if (simulated) {
      const client = 'simulator (DEMO)';
      if (item.message.message_type === 'COMMAND') {
        await completeDelivery(db, agent, delivery.id, { status: 'DONE' });
        return;
      }
      const sim = await simulate(db, project, agent, item);
      const factor = Number(process.env.ACC_SIM_DELAY_FACTOR ?? 1);
      let alive = true;
      for (const step of sim.steps) {
        await setSession(db, agent, step.status, step.activity, taskId, client);
        emitEphemeral({ project_id: project.id, type: 'agent.activity', actor_kind: 'agent', actor_id: agent.id, agent_id: agent.id, task_id: taskId, payload: { kind: 'tool', text: `[sim] ${step.activity}` } });
        await sleep(step.ms * factor);
        alive = await stillActive(db, delivery.id);
        if (!alive) break; // cancelled / STOP ALL
      }
      if (alive) {
        await post(sim.text);
        await runActions(db, project, agent, item, sim.actions);
        await completeDelivery(db, agent, delivery.id, { status: 'DONE', tokensIn: 0, tokensOut: 0, summary: sim.text.split('\n')[0] });
      } else {
        await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: 'cancelled' });
      }
      await setSession(db, agent, 'ONLINE', '', null, client);
      return;
    }

    /* ───────────── http-api runtimes */
    const runtime = getRuntime(agent.runtime);
    if (!runtime || !isHttpRuntime(runtime)) {
      await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: `runtime ${agent.runtime} cannot run in the orchestrator` });
      return;
    }
    const client = `${runtime.runtime} · ${runtime.provider.name}`;
    let effectiveModel = resolveModel(runtime, agent.model);
    try {
      if (runtime.id === 'nvidia-nim') {
        const resolved = await resolveNvidiaModel(effectiveModel);
        effectiveModel = resolved.model;
        if (resolved.repaired) {
          await db.query('update agents set model=$2 where id=$1', [agent.id, effectiveModel]);
          await emit(db, {
            project_id: project.id,
            type: 'agent.updated',
            actor: agentActor(agent),
            agent_id: agent.id,
            payload: { model_repaired: true, model: effectiveModel },
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'NVIDIA model catalogue unavailable';
      await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: msg });
      await setSession(db, agent, 'ERROR', msg, taskId, client);
      await emit(db, { project_id: project.id, type: 'agent.error', actor: agentActor(agent), agent_id: agent.id, task_id: taskId, payload: { error: msg.slice(0, 300) } });
      return;
    }
    const ready = httpReadiness(runtime, agent.config, effectiveModel);
    if (!ready.ready) {
      await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: `Agent not configured: ${ready.reason}` });
      return;
    }
    if (runtime.paid) {
      const used = await db.query<{ n: number }>(
        `select coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)),0)::int n from agent_runs
          where agent_id=$1 and started_at >= date_trunc('day', now())`,
        [agent.id],
      );
      const gate = await authorize(db, project, agent, 'paid_api_call', taskId ? await getTask(db, taskId) : null, false, {
        tokensToday: used.rows[0].n,
        dailyTokenBudget: project.settings.daily_token_budget,
      });
      if (gate.kind !== 'allow') {
        await emit(db, {
          project_id: project.id,
          type: 'policy.decision',
          actor: agentActor(agent),
          agent_id: agent.id,
          task_id: taskId ?? null,
          payload: { action: 'paid_api_call', decision: gate.kind, reason: gate.reason, tokens_today: used.rows[0].n, daily_token_budget: project.settings.daily_token_budget ?? null },
        });
        await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: `Policy: ${gate.kind === 'deny' ? gate.reason : 'requires approval'}` });
        return;
      }
    }
    await setSession(db, agent, item.message.message_type === 'REVIEW' ? 'REVIEWING' : 'THINKING', `answering ${item.message.message_type} from ${item.message.from}`, taskId, client);

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 180_000);
    try {
      const out = await runtime.generate(
        {
          system: `You are ${agent.name}, ${agent.role_label || agent.role}, a member of a multi-agent software team coordinated by the AI Command Center orchestrator. Follow the rules in the context.`,
          prompt: item.context.prompt,
          model: effectiveModel,
          maxTokens: agent.config.max_tokens ?? 4096,
          temperature: agent.config.temperature ?? 0.3,
          signal: ctrl.signal,
        },
        resolveHttpConfig(runtime, agent.config),
      );
      await setSession(db, agent, 'WORKING', 'posting result', taskId, client);
      const parsed = parseAgentReply(out.text);
      // 1) reply text to the room, 2) declared actions through policy, 3) finalize delivery
      await post(parsed.text || '(no text)');
      await runActions(db, project, agent, item, parsed.actions, parsed.errors);
      await completeDelivery(db, agent, delivery.id, {
        status: 'DONE',
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        outputChars: out.text.length,
        summary: parsed.text.split('\n')[0],
      });
      await setSession(db, agent, 'ONLINE', '', null, client);
    } catch (e) {
      const msg = ctrl.signal.aborted ? 'provider timeout (180 s)' : (e as Error).message;
      await completeDelivery(db, agent, delivery.id, { status: 'FAILED', error: msg });
      await setSession(db, agent, 'ERROR', msg, taskId, client);
      await emit(db, { project_id: project.id, type: 'agent.error', actor, agent_id: agent.id, task_id: taskId, payload: { error: msg.slice(0, 300) } });
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    running.delete(agent.id);
  }
}
