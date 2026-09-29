import { z } from 'zod';
import { userRoute, readJson } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { knowledgeCreateSchema } from '@/server/validation';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { createKnowledgeDocument, listKnowledgeDocuments } from '@/server/knowledge/store';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ category: z.string().optional() });

/** Knowledge library: documents, sources, categories, chunking/embedding status. */
export const GET = userRoute(async ({ req, db }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const project = await requireProject(db);
  const documents = await listKnowledgeDocuments(db, { projectId: project.id, category: q.category });
  return { documents, total: documents.length };
});

export const POST = userRoute(
  async ({ req, db, user }) => {
    const body = await readJson(req, knowledgeCreateSchema);
    const project = await requireProject(db);
    const { document, chunks } = await createKnowledgeDocument(db, { ...body, scope: 'project', project_id: project.id });
    await emit(db, { project_id: project.id, type: 'knowledge.created', actor: userActor(user), payload: { document_id: document.id, chunks: chunks.length } });
    return { document, chunks: chunks.length };
  },
  { roles: ['owner', 'moderator'] },
);
