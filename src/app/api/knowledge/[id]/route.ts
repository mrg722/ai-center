import { userRoute, HttpError } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { requireProject } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';
import { deleteKnowledgeDocument, getKnowledgeChunks, getKnowledgeDocument, setKnowledgeDocumentEnabled } from '@/server/knowledge/store';

export const dynamic = 'force-dynamic';

export const GET = userRoute<{ id: string }>(async ({ db, user, params }) => {
  const project = await requireProject(db, user.id);
  const document = await getKnowledgeDocument(db, params.id);
  if (document.scope === 'project' && document.project_id !== project.id) throw new HttpError(404, 'document not found');
  const chunks = await getKnowledgeChunks(db, document.id);
  return { document, chunks };
});

export const PATCH = userRoute<{ id: string }>(
  async ({ req, db, user, params }) => {
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    const project = await requireProject(db, user.id);
    const document = await getKnowledgeDocument(db, params.id);
    if (document.scope === 'project' && document.project_id !== project.id) throw new HttpError(404, 'document not found');
    const updated = typeof body.enabled === 'boolean' ? await setKnowledgeDocumentEnabled(db, params.id, body.enabled) : document;
    await emit(db, { project_id: project.id, type: 'knowledge.updated', actor: userActor(user), payload: { document_id: params.id } });
    return { document: updated };
  },
  { roles: ['owner', 'moderator'] },
);

export const DELETE = userRoute<{ id: string }>(
  async ({ db, user, params }) => {
    const project = await requireProject(db, user.id);
    const document = await getKnowledgeDocument(db, params.id);
    if (document.scope === 'project' && document.project_id !== project.id) throw new HttpError(404, 'document not found');
    await deleteKnowledgeDocument(db, params.id);
    await emit(db, { project_id: project.id, type: 'knowledge.updated', actor: userActor(user), payload: { document_id: params.id, deleted: true } });
    return { ok: true };
  },
  { roles: ['owner', 'moderator'] },
);
