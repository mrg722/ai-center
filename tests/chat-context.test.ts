/**
 * General room (Chat General) context/memory (audit fix): buildContext()
 * only loaded history when a `task` was present — the general room has no
 * task, only a conversation_id (see generalConversation() in repo.ts), so
 * every message to an agent from the room was built with an EMPTY history,
 * as if it were the first message ever. Fixed by keying history on
 * conversation_id instead of task_id (task messages already carry their own
 * conversation_id, so this is a strict generalization, not a new concept).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import { runSetup } from '@/server/orchestrator/setup';
import { requireProject, getAgentBySlug } from '@/server/orchestrator/repo';
import { postMessage } from '@/server/orchestrator/router';
import { buildContext } from '@/server/orchestrator/context';
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
  project = await requireProject(db, s.userId);
  claude = (await getAgentBySlug(db, project.id, 'claude'))!;
}

describe('general room context/memory', () => {
  beforeEach(fresh, 30_000);

  it('buildContext includes prior general-room messages in history (was empty before the fix)', async () => {
    await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'NOTE', content: 'Estamos trabajando en AI Center.', deliver: false });
    const { message: incoming } = await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'REQUEST', content: '¿Qué estamos haciendo?' });

    const ctx = await buildContext(db, { project, agent: claude, task: null, incoming });
    expect(ctx.prompt).toContain('Estamos trabajando en AI Center');
  });

  it('a context preview with no incoming message (GET /api/agent/context style) still resolves the general conversation', async () => {
    await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'NOTE', content: 'Nota de contexto previo.', deliver: false });
    const ctx = await buildContext(db, { project, agent: claude, task: null, incoming: null });
    expect(ctx.prompt).toContain('Nota de contexto previo');
  });

  it('history respects the existing HISTORY_WINDOW (14): older messages are compacted into the "Earlier messages" summary, not dumped as raw history', async () => {
    for (let i = 0; i < 20; i++) {
      await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'NOTE', content: `mensaje-${i}`, deliver: false });
    }
    const { message: incoming } = await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'REQUEST', content: 'último' });
    const ctx = await buildContext(db, { project, agent: claude, task: null, incoming });
    expect(ctx.prompt).toContain('Earlier messages (summary)');
    // the 6 oldest (of 20) fall outside the 14-message window and are only reachable via the summary
    const summarySection = ctx.prompt.split('Earlier messages (summary):')[1].split('## Team')[0];
    expect(summarySection).toContain('mensaje-0');
    expect(ctx.prompt).toContain('mensaje-19');
  });

  it("clearing the chat starts a fresh conversation — new messages never inherit the old room's history", async () => {
    await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'NOTE', content: 'secreto-de-la-sala-vieja', deliver: false });

    const { startNewGeneralConversation } = await import('@/server/orchestrator/repo');
    await startNewGeneralConversation(db, project.id);

    const { message: incoming } = await postMessage(db, { project, task: null, from: user, to: { agentId: claude.id }, type: 'REQUEST', content: 'primer mensaje de la sala nueva' });
    const ctx = await buildContext(db, { project, agent: claude, task: null, incoming });
    expect(ctx.prompt).not.toContain('secreto-de-la-sala-vieja');
    expect(ctx.prompt).toContain('primer mensaje de la sala nueva');
  });
});
