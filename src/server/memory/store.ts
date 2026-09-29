import 'server-only';
import type { Db } from '../db';
import { BadRequest, NotFound } from '../orchestrator/repo';
import type { CreateMemoryInput, MemoryRow, MemoryScope } from './types';

/**
 * Memory Store (Bloque 5) — lives in AI Center, independent of any model.
 * Switching provider/runtime never touches this table; only explicit calls
 * (agent `remember` action, moderator UI, extraction jobs) write to it —
 * never a bulk copy of the conversation (see docs/ARCHITECTURE_AI_PLATFORM.md).
 */

function assertScopeRef(i: Pick<CreateMemoryInput, 'scope' | 'project_id' | 'agent_id' | 'task_id' | 'conversation_id'>) {
  const need: Record<MemoryScope, keyof typeof i> = {
    global: 'scope', // no ref required
    project: 'project_id',
    agent: 'agent_id',
    task: 'task_id',
    conversation: 'conversation_id',
  };
  const key = need[i.scope];
  if (key !== 'scope' && !i[key]) throw new BadRequest(`scope "${i.scope}" requires ${key}`);
}

export async function createMemory(db: Db, i: CreateMemoryInput): Promise<MemoryRow> {
  assertScopeRef(i);
  if (!i.content.trim()) throw new BadRequest('memory content is empty');
  const r = await db.query<MemoryRow>(
    `insert into memories
      (scope, project_id, agent_id, task_id, conversation_id, type, content, summary, importance,
       source, created_by_user, created_by_agent, pinned, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning *`,
    [
      i.scope,
      i.project_id ?? null,
      i.agent_id ?? null,
      i.task_id ?? null,
      i.conversation_id ?? null,
      i.type,
      i.content.slice(0, 20_000),
      (i.summary ?? '').slice(0, 2000),
      Math.min(5, Math.max(1, i.importance ?? 3)),
      i.source ?? 'agent',
      i.created_by_user ?? null,
      i.created_by_agent ?? null,
      i.pinned ?? false,
      JSON.stringify(i.metadata ?? {}),
    ],
  );
  return r.rows[0];
}

export interface MemoryFilter {
  projectId?: string;
  agentId?: string;
  taskId?: string;
  conversationId?: string;
  scope?: MemoryScope;
  type?: string;
  pinned?: boolean;
  archived?: boolean;
  query?: string; // structured/text fallback retrieval (no embeddings required)
  limit?: number;
}

export async function listMemories(db: Db, f: MemoryFilter): Promise<MemoryRow[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  const eq = (col: string, v: unknown) => {
    if (v === undefined) return;
    params.push(v);
    conds.push(`${col} = $${params.length}`);
  };
  eq('project_id', f.projectId);
  eq('agent_id', f.agentId);
  eq('task_id', f.taskId);
  eq('conversation_id', f.conversationId);
  eq('scope', f.scope);
  eq('type', f.type);
  eq('pinned', f.pinned);
  conds.push(`archived = ${f.archived ? 'true' : 'false'}`);
  if (f.query) {
    params.push(`%${f.query.toLowerCase()}%`);
    conds.push(`(lower(content) like $${params.length} or lower(summary) like $${params.length})`);
  }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  params.push(Math.min(200, f.limit ?? 50));
  const r = await db.query<MemoryRow>(
    `select * from memories ${where} order by pinned desc, importance desc, created_at desc limit $${params.length}`,
    params,
  );
  return r.rows;
}

export async function getMemory(db: Db, id: string): Promise<MemoryRow> {
  const r = await db.query<MemoryRow>('select * from memories where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('memory not found');
  return r.rows[0];
}

export async function updateMemory(
  db: Db,
  id: string,
  patch: Partial<Pick<MemoryRow, 'content' | 'summary' | 'importance' | 'pinned' | 'archived' | 'metadata'>>,
): Promise<MemoryRow> {
  const existing = await getMemory(db, id);
  const next = { ...existing, ...patch };
  const r = await db.query<MemoryRow>(
    `update memories set content=$2, summary=$3, importance=$4, pinned=$5, archived=$6, metadata=$7, version=version+1
      where id=$1 returning *`,
    [id, next.content, next.summary, Math.min(5, Math.max(1, next.importance)), next.pinned, next.archived, JSON.stringify(next.metadata)],
  );
  return r.rows[0];
}

export async function pinMemory(db: Db, id: string, pinned: boolean): Promise<MemoryRow> {
  return updateMemory(db, id, { pinned });
}

export async function archiveMemory(db: Db, id: string, archived = true): Promise<MemoryRow> {
  return updateMemory(db, id, { archived });
}

export async function deleteMemory(db: Db, id: string): Promise<void> {
  await db.query('delete from memories where id=$1', [id]);
}

/**
 * Sets/replaces an embedding for a memory without touching its text — the
 * Fase 8 requirement: switching (or adding) an embedding model never loses
 * the original content, and re-embedding is always possible.
 */
export async function setMemoryEmbedding(db: Db, id: string, embedding: number[], embeddingModel: string): Promise<void> {
  await db.query('update memories set embedding=$2, embedding_model=$3 where id=$1', [id, embedding, embeddingModel]);
}

/**
 * Relevance selection for the Context Engine: never "all memories" — pinned
 * first, then most important/most recent, bounded. This is the structured
 * fallback (Fase 8): works with or without embeddings.
 */
export async function relevantMemories(
  db: Db,
  i: { projectId: string; agentId?: string; taskId?: string; limit?: number },
): Promise<MemoryRow[]> {
  const limit = Math.min(30, i.limit ?? 8);
  const params: unknown[] = [i.projectId];
  const scopeConds = ["scope = 'global'", `(scope = 'project' and project_id = $1)`];
  if (i.agentId) {
    params.push(i.agentId);
    scopeConds.push(`(scope = 'agent' and agent_id = $${params.length})`);
  }
  if (i.taskId) {
    params.push(i.taskId);
    scopeConds.push(`(scope = 'task' and task_id = $${params.length})`);
  }
  params.push(limit);
  const r = await db.query<MemoryRow>(
    `select * from memories where archived = false and (${scopeConds.join(' or ')})
      order by pinned desc, importance desc, created_at desc limit $${params.length}`,
    params,
  );
  return r.rows;
}
