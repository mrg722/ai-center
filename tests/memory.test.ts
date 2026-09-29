/**
 * Memory Store (Bloque 5) — lives in AI Center, independent of any model.
 * Includes the "model-switch-memory-persistence" demo (Fase 18): a memory
 * survives switching the runtime/model behind the agent that created it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject, getAgentBySlug } from '@/server/orchestrator/repo';
import { createTask } from '@/server/orchestrator/tasks';
import { executeAgentAction } from '@/server/orchestrator/actions';
import { buildContext } from '@/server/orchestrator/context';
import {
  archiveMemory,
  createMemory,
  deleteMemory,
  listMemories,
  pinMemory,
  relevantMemories,
  setMemoryEmbedding,
  updateMemory,
} from '@/server/memory/store';
import type { AgentRow, ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let claude: AgentRow;
let gpt: AgentRow;
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
  project = await requireProject(db, user.id);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
  gpt = (await getAgentBySlug(db, project.id, 'gpt'))!;
}

describe('memory store', () => {
  beforeEach(fresh, 30_000);

  it('requires the ref that matches its scope', async () => {
    await expect(createMemory(db, { scope: 'agent', type: 'fact', content: 'x' })).rejects.toThrow();
    await expect(createMemory(db, { scope: 'task', type: 'fact', content: 'x' })).rejects.toThrow();
    const m = await createMemory(db, { scope: 'project', project_id: project.id, type: 'fact', content: 'ok' });
    expect(m.scope).toBe('project');
  });

  it('never auto-captures every message — only explicit createMemory calls persist', async () => {
    // sanity: the router (postMessage) never touches `memories`; only this
    // module and the `remember` action do.
    expect((await listMemories(db, { projectId: project.id })).length).toBe(0);
  });

  it('lists, filters, pins, archives, edits and deletes memories', async () => {
    const a = await createMemory(db, { scope: 'project', project_id: project.id, type: 'lesson', content: 'Always redact tokens.', importance: 5 });
    const b = await createMemory(db, { scope: 'project', project_id: project.id, type: 'fact', content: 'Repo default branch is main.' });

    expect((await listMemories(db, { projectId: project.id })).map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(await listMemories(db, { projectId: project.id, type: 'lesson' })).toHaveLength(1);
    expect(await listMemories(db, { projectId: project.id, query: 'redact' })).toHaveLength(1);

    const pinned = await pinMemory(db, a.id, true);
    expect(pinned.pinned).toBe(true);

    const edited = await updateMemory(db, b.id, { content: 'Repo default branch is main (protected).' });
    expect(edited.content).toContain('protected');
    expect(edited.version).toBe(2);

    await archiveMemory(db, b.id, true);
    expect(await listMemories(db, { projectId: project.id, archived: false })).toHaveLength(1);
    expect(await listMemories(db, { projectId: project.id, archived: true })).toHaveLength(1);

    await deleteMemory(db, a.id);
    expect(await listMemories(db, { projectId: project.id, archived: false })).toHaveLength(0);
  });

  it('re-embedding never loses the original text', async () => {
    const m = await createMemory(db, { scope: 'project', project_id: project.id, type: 'fact', content: 'Keep this forever.' });
    await setMemoryEmbedding(db, m.id, [0.1, 0.2, 0.3], 'text-embedding-3-small');
    const first = await listMemories(db, { projectId: project.id });
    expect(first[0].embedding_model).toBe('text-embedding-3-small');
    expect(first[0].content).toBe('Keep this forever.');
    // switching embedding model re-embeds without touching content
    await setMemoryEmbedding(db, m.id, [0.9, 0.8], 'a-different-embedding-model');
    const second = await listMemories(db, { projectId: project.id });
    expect(second[0].embedding_model).toBe('a-different-embedding-model');
    expect(second[0].content).toBe('Keep this forever.');
  });

  it('relevantMemories is bounded and scoped (never dumps everything into context)', async () => {
    for (let i = 0; i < 20; i++) {
      await createMemory(db, { scope: 'project', project_id: project.id, type: 'fact', content: `fact ${i}` });
    }
    const selected = await relevantMemories(db, { projectId: project.id, limit: 5 });
    expect(selected).toHaveLength(5);
  });

  it('agent-scoped memories do not leak into another agent´s retrieval', async () => {
    await createMemory(db, { scope: 'agent', agent_id: claude.id, project_id: project.id, type: 'preference', content: 'Claude-specific note' });
    const forClaude = await relevantMemories(db, { projectId: project.id, agentId: claude.id });
    const forGpt = await relevantMemories(db, { projectId: project.id, agentId: gpt.id });
    expect(forClaude.map((m) => m.content)).toContain('Claude-specific note');
    expect(forGpt.map((m) => m.content)).not.toContain('Claude-specific note');
  });

  it('the `remember` agent action persists to the Memory Store (not automatic per-message)', async () => {
    const task = await createTask(db, { project, actor: user, title: 'Ship feature', assignedAgentId: claude.id });
    const result = await executeAgentAction(db, claude, {
      action: 'remember',
      task_id: task.id,
      type: 'decision',
      content: 'We decided to use Postgres for the queue, not Redis.',
      summary: 'DB choice: Postgres over Redis',
      importance: 4,
      scope: 'task',
    });
    expect(result.ok).toBe(true);
    const stored = await listMemories(db, { projectId: project.id, taskId: task.id });
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('decision');
    expect(stored[0].created_by_agent).toBe(claude.id);
    expect(stored[0].source).toBe('agent');
  });

  it('model-switch-memory-persistence: memory survives switching the model/runtime behind the agent', async () => {
    // 1. "Model A" (claude-code runtime) talks and stores a decision in memory.
    expect(claude.runtime).toBe('claude-code');
    await executeAgentAction(db, claude, {
      action: 'remember',
      type: 'decision',
      content: 'Use feature flags for the new checkout flow.',
      summary: 'Checkout flow behind a feature flag',
      importance: 5,
      scope: 'project',
    });

    const beforeSwitch = await buildContext(db, { project, agent: claude, task: null, incoming: null });
    expect(beforeSwitch.prompt).toContain('Checkout flow behind a feature flag');

    // 2. Switch the model/runtime behind the SAME agent (simulates moving from
    //    Ollama/Claude/GPT to another provider — never done through the DB
    //    directly in production, but this isolates "does memory survive a
    //    runtime change" from the provider-specific set_model API).
    await db.query(`update agents set runtime='local-command', model='qwen2.5-coder' where id=$1`, [claude.id]);
    const switched = (await getAgentBySlug(db, project.id, 'claude'))!;
    expect(switched.runtime).toBe('local-command');
    expect(switched.model).toBe('qwen2.5-coder');

    // 3. "Model B" (now behind the same agent) recovers the exact same memory.
    const afterSwitch = await buildContext(db, { project, agent: switched, task: null, incoming: null });
    expect(afterSwitch.prompt).toContain('Checkout flow behind a feature flag');

    // 4. And a different agent entirely (GPT) still sees the project-scope memory too.
    const gptContext = await buildContext(db, { project, agent: gpt, task: null, incoming: null });
    expect(gptContext.prompt).toContain('Checkout flow behind a feature flag');
  });
});

