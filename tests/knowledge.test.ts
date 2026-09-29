/**
 * Knowledge Store (Bloque 6): chunking, retrieval fallback (no embeddings
 * required), and Context Engine integration — kept distinct from Memory.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject, getAgentBySlug } from '@/server/orchestrator/repo';
import { buildContext } from '@/server/orchestrator/context';
import { createTask } from '@/server/orchestrator/tasks';
import { chunkText } from '@/server/knowledge/chunk';
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeChunks,
  listKnowledgeDocuments,
  relevantKnowledge,
  setChunkEmbedding,
  setKnowledgeDocumentEnabled,
} from '@/server/knowledge/store';
import type { AgentRow, ProjectRow } from '@/server/types';

let db: Db;
let project: ProjectRow;
let claude: AgentRow;
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
}

describe('chunking', () => {
  it('packs paragraphs up to the limit and hard-splits an oversized one', () => {
    const small = chunkText('one\n\ntwo\n\nthree', 100);
    expect(small).toEqual(['one\n\ntwo\n\nthree']);

    const packed = chunkText(`${'a'.repeat(40)}\n\n${'b'.repeat(40)}\n\n${'c'.repeat(40)}`, 90);
    expect(packed.length).toBeGreaterThan(1);
    expect(packed.every((c) => c.length <= 90)).toBe(true);

    const huge = chunkText('x'.repeat(500), 200);
    expect(huge).toHaveLength(3);
    expect(huge.join('')).toBe('x'.repeat(500));
  });
});

describe('knowledge store', () => {
  beforeEach(fresh, 30_000);

  it('creates a document and chunks it deterministically', async () => {
    const { document, chunks } = await createKnowledgeDocument(db, {
      project_id: project.id,
      title: 'OWASP API Security Top 10',
      category: 'security',
      content: 'Broken object level authorization.\n\n'.repeat(3) + 'Excessive data exposure.\n\n'.repeat(3),
    });
    expect(document.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(chunks.length).toBeGreaterThan(0);
    expect(await getKnowledgeChunks(db, document.id)).toHaveLength(chunks.length);
  });

  it('lists project + global documents, filters by category, respects enabled', async () => {
    await createKnowledgeDocument(db, { project_id: project.id, title: 'A', category: 'security', content: 'IDOR testing notes.' });
    await createKnowledgeDocument(db, { project_id: project.id, title: 'B', category: 'design', content: 'Design tokens.' });
    await createKnowledgeDocument(db, { scope: 'global', title: 'Global doc', category: 'security', content: 'Shared across projects.' });

    expect(await listKnowledgeDocuments(db, { projectId: project.id })).toHaveLength(3);
    expect(await listKnowledgeDocuments(db, { projectId: project.id, category: 'security' })).toHaveLength(2);

    const [a] = await listKnowledgeDocuments(db, { projectId: project.id, category: 'design' });
    await setKnowledgeDocumentEnabled(db, a.id, false);
    expect(await listKnowledgeDocuments(db, { projectId: project.id, enabled: true })).toHaveLength(2);
  });

  it('retrieval is a bounded, relevance-ranked fallback that needs no embeddings', async () => {
    await createKnowledgeDocument(db, {
      project_id: project.id,
      title: 'IDOR Guide',
      category: 'security',
      content: 'Insecure direct object reference testing requires two accounts and one synthetic record.',
    });
    await createKnowledgeDocument(db, { project_id: project.id, title: 'Unrelated', category: 'design', content: 'Color tokens and spacing scale.' });

    const hits = await relevantKnowledge(db, { projectId: project.id, query: 'How do I test for IDOR vulnerabilities?', limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].document_title).toBe('IDOR Guide');
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });

  it('re-embedding a chunk never loses its text', async () => {
    const { chunks } = await createKnowledgeDocument(db, { project_id: project.id, title: 'Doc', content: 'Keep this text.' });
    await setChunkEmbedding(db, chunks[0].id, [0.1, 0.2], 'model-a');
    let stored = await getKnowledgeChunks(db, chunks[0].document_id);
    expect(stored[0].content).toBe('Keep this text.');
    await setChunkEmbedding(db, chunks[0].id, [0.9], 'model-b');
    stored = await getKnowledgeChunks(db, chunks[0].document_id);
    expect(stored[0].embedding_model).toBe('model-b');
    expect(stored[0].content).toBe('Keep this text.');
  });

  it('deleting a document cascades its chunks', async () => {
    const { document } = await createKnowledgeDocument(db, { project_id: project.id, title: 'Doc', content: 'x'.repeat(4000) });
    expect((await getKnowledgeChunks(db, document.id)).length).toBeGreaterThan(1);
    await deleteKnowledgeDocument(db, document.id);
    expect(await getKnowledgeChunks(db, document.id)).toHaveLength(0);
  });

  it('Context Engine pulls relevant knowledge for the task, separately from memory', async () => {
    await createKnowledgeDocument(db, {
      project_id: project.id,
      title: 'Checkout Flow Runbook',
      category: 'engineering',
      content: 'The checkout flow must validate the cart total server-side before charging the card.',
    });
    const task = await createTask(db, { project, actor: user, title: 'Fix checkout flow validation', description: 'Server-side cart total check', assignedAgentId: claude.id });
    const ctx = await buildContext(db, { project, agent: claude, task, incoming: null });
    expect(ctx.sections).toContain('knowledge');
    expect(ctx.prompt).toContain('Checkout Flow Runbook');
    expect(ctx.prompt).toContain('Relevant knowledge (reference material, not memory)');
  });
});
