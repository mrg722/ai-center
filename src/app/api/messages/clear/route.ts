import { userRoute } from '@/server/http/route';
import { userActor } from '@/server/auth/session';
import { requireProject, startNewGeneralConversation } from '@/server/orchestrator/repo';
import { emit } from '@/server/events/bus';

export const dynamic = 'force-dynamic';

/** "Limpiar chat" for the general room. Never deletes messages — starts a fresh conversation (see startNewGeneralConversation). */
export const POST = userRoute(async ({ db, user }) => {
  const project = await requireProject(db, user.id);
  const conversation_id = await startNewGeneralConversation(db, project.id);
  await emit(db, { project_id: project.id, type: 'conversation.cleared', actor: userActor(user), payload: { conversation_id } });
  return { conversation_id };
});
