import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from '../db';
import { BadRequest, NotFound } from '../orchestrator/repo';
import { chunkText } from './chunk';
import type { CreateKnowledgeDocumentInput, KnowledgeChunkRow, KnowledgeDocumentRow } from './types';

/**
 * Knowledge Store (Bloque 6) — reference material, distinct from Memory
 * (experience/state/decisions, see src/server/memory/store.ts). Documents
 * are chunked on insert; retrieval never requires an embedding provider —
 * see relevantKnowledge() for the structured/text fallback.
 */

export async function createKnowledgeDocument(db: Db, i: CreateKnowledgeDocumentInput): Promise<{ document: KnowledgeDocumentRow; chunks: KnowledgeChunkRow[] }> {
  const scope = i.scope ?? 'project';
  if (scope === 'project' && !i.project_id) throw new BadRequest('project_id is required for scope="project"');
  if (!i.content.trim()) throw new BadRequest('document content is empty');
  const checksum = createHash('sha256').update(i.content).digest('hex');

  return db.tx(async (tx) => {
    const doc = await tx.query<KnowledgeDocumentRow>(
      `insert into knowledge_documents (scope, project_id, title, source, path, category, version, checksum, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        scope,
        scope === 'project' ? i.project_id : null,
        i.title.slice(0, 300),
        i.source ?? 'custom',
        i.path ?? null,
        i.category ?? '',
        i.version ?? '1.0.0',
        checksum,
        JSON.stringify(i.metadata ?? {}),
      ],
    );
    const pieces = chunkText(i.content);
    const chunks: KnowledgeChunkRow[] = [];
    for (let idx = 0; idx < pieces.length; idx++) {
      const c = await tx.query<KnowledgeChunkRow>(
        `insert into knowledge_chunks (document_id, chunk_index, content) values ($1,$2,$3) returning *`,
        [doc.rows[0].id, idx, pieces[idx]],
      );
      chunks.push(c.rows[0]);
    }
    return { document: doc.rows[0], chunks };
  });
}

/** Project-wide document/chunk counts — for a compact "N documents / M chunks" summary. */
export async function knowledgeStats(db: Db, projectId: string): Promise<{ documents: number; chunks: number }> {
  const r = await db.query<{ documents: string; chunks: string }>(
    `select count(distinct d.id)::text as documents, count(c.id)::text as chunks
       from knowledge_documents d
       left join knowledge_chunks c on c.document_id = d.id
      where d.scope = 'global' or d.project_id = $1`,
    [projectId],
  );
  return { documents: Number(r.rows[0]?.documents ?? 0), chunks: Number(r.rows[0]?.chunks ?? 0) };
}

export async function listKnowledgeDocuments(db: Db, f: { projectId?: string; category?: string; enabled?: boolean } = {}): Promise<KnowledgeDocumentRow[]> {
  const conds: string[] = [`(scope = 'global' or project_id = $1)`];
  const params: unknown[] = [f.projectId ?? null];
  if (f.category) {
    params.push(f.category);
    conds.push(`category = $${params.length}`);
  }
  if (f.enabled !== undefined) {
    params.push(f.enabled);
    conds.push(`enabled = $${params.length}`);
  }
  const r = await db.query<KnowledgeDocumentRow>(
    `select * from knowledge_documents where ${conds.join(' and ')} order by category, title`,
    params,
  );
  return r.rows;
}

export async function getKnowledgeDocument(db: Db, id: string): Promise<KnowledgeDocumentRow> {
  const r = await db.query<KnowledgeDocumentRow>('select * from knowledge_documents where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('knowledge document not found');
  return r.rows[0];
}

export async function getKnowledgeChunks(db: Db, documentId: string): Promise<KnowledgeChunkRow[]> {
  const r = await db.query<KnowledgeChunkRow>('select * from knowledge_chunks where document_id=$1 order by chunk_index', [documentId]);
  return r.rows;
}

export async function deleteKnowledgeDocument(db: Db, id: string): Promise<void> {
  await db.query('delete from knowledge_documents where id=$1', [id]);
}

export async function setKnowledgeDocumentEnabled(db: Db, id: string, enabled: boolean): Promise<KnowledgeDocumentRow> {
  const r = await db.query<KnowledgeDocumentRow>('update knowledge_documents set enabled=$2 where id=$1 returning *', [id, enabled]);
  if (!r.rows[0]) throw new NotFound('knowledge document not found');
  return r.rows[0];
}

export async function setChunkEmbedding(db: Db, chunkId: string, embedding: number[], embeddingModel: string): Promise<void> {
  await db.query('update knowledge_chunks set embedding=$2, embedding_model=$3 where id=$1', [chunkId, embedding, embeddingModel]);
}

export interface KnowledgeHit {
  document_id: string;
  document_title: string;
  category: string;
  chunk_index: number;
  content: string;
  score: number;
}

/**
 * Retrieval (Fase 7/8): embeddings when present (cosine similarity, computed
 * in-process — no vector extension dependency), otherwise a structured/text
 * fallback (term overlap). Never returns the whole library: bounded `limit`.
 */
export async function relevantKnowledge(
  db: Db,
  i: { projectId: string; query: string; category?: string; limit?: number },
): Promise<KnowledgeHit[]> {
  const limit = Math.min(20, i.limit ?? 5);
  const terms = i.query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2)
    .slice(0, 20);
  if (!terms.length) return [];

  const conds = [`d.enabled`, `(d.scope = 'global' or d.project_id = $1)`];
  const params: unknown[] = [i.projectId];
  if (i.category) {
    params.push(i.category);
    conds.push(`d.category = $${params.length}`);
  }
  const rows = await db.query<{ document_id: string; document_title: string; category: string; chunk_index: number; content: string }>(
    `select c.document_id, d.title as document_title, d.category, c.chunk_index, c.content
       from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
      where ${conds.join(' and ')}`,
    params,
  );

  const scored = rows.rows.map((r) => {
    const lower = r.content.toLowerCase();
    const score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    return { ...r, score };
  });
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
