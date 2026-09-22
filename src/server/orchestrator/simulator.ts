import type { Db } from '../db';
import type { AgentRow, ProjectRow } from '../types';
import type { AgentAction, InboxItem } from '../../shared/protocol';

/**
 * DEMO simulator — an in-process runtime that plays the three default roles
 * with scripted, deterministic behaviour so the UI, approvals, handoffs and
 * the office can be exercised without connecting any real agent.
 *
 * It is NOT an AI and never pretends to be one: every message it produces is
 * prefixed with [SIMULADO] and the UI shows DEMO everywhere. Its state flows
 * through exactly the same path as real agents (sessions → orchestrator →
 * events → UI), and its actions go through the same policy engine.
 */
export interface SimStep {
  status: 'THINKING' | 'WORKING' | 'REVIEWING';
  activity: string;
  ms: number;
}
export interface SimResult {
  steps: SimStep[];
  text: string;
  actions: AgentAction[];
}

export async function simulate(db: Db, project: ProjectRow, agent: AgentRow, item: InboxItem): Promise<SimResult> {
  const msg = item.message;
  const task = item.task;
  const tag = '[SIMULADO]';
  const reviewer = project.settings.default_reviewer ?? 'gpt';

  if (!task) {
    return {
      steps: [{ status: 'THINKING', activity: 'leyendo el mensaje', ms: 900 }],
      text: `${tag} ${agent.name} recibió tu ${msg.message_type}: "${msg.content.slice(0, 120)}". En modo DEMO no hay un modelo real detrás.`,
      actions: [],
    };
  }

  const reviews = await db.query<{ n: number }>(`select count(*)::int n from reviews where task_id=$1`, [task.id]);
  const nReviews = reviews.rows[0].n;
  const slugBranch = `${task.key.toLowerCase()}-demo`;

  switch (agent.role) {
    case 'PRIMARY_BUILDER': {
      const fixing = msg.message_type === 'REVIEW';
      return {
        steps: [
          { status: 'THINKING', activity: fixing ? 'leyendo la revisión' : `analizando ${task.key}`, ms: 1500 },
          { status: 'WORKING', activity: fixing ? 'corrigiendo src/lib/auth.ts' : 'editando src/lib/auth.ts', ms: 2500 },
          { status: 'WORKING', activity: 'ejecutando tests (simulado)', ms: 1500 },
        ],
        text: fixing
          ? `${tag} Corregí los puntos de la revisión en src/lib/auth.ts y volví a ejecutar los tests (simulados). Pido nueva revisión.`
          : `${tag} Analicé ${task.key} e implementé un cambio de ejemplo en src/lib/auth.ts y tests/auth.test.ts. Solicito auditoría.`,
        actions: [
          { action: 'update_task', task_id: task.id, current_branch: slugBranch, modified_files: ['src/lib/auth.ts', 'tests/auth.test.ts'] },
          { action: 'git_request', op: 'commit', task_id: task.id, message: `${task.key}: ${fixing ? 'address review' : 'implement change'} (demo)` },
          { action: 'request_review', to: reviewer, task_id: task.id, content: `${tag} Revisa ${task.key}, por favor.`, files: ['src/lib/auth.ts'] },
        ],
      };
    }
    case 'AUDITOR_INTEGRATOR': {
      const approve = nReviews >= 1;
      return {
        steps: [
          { status: 'REVIEWING', activity: 'revisando el diff', ms: 2200 },
          { status: 'REVIEWING', activity: 'buscando regresiones', ms: 1600 },
        ],
        text: approve
          ? `${tag} Auditoría aprobada: los cambios cubren el caso y los tests pasan (simulados). Preparo el push.`
          : `${tag} Encontré dos problemas en la implementación. Devuelvo la tarea al autor.`,
        actions: approve
          ? [
              { action: 'record_review', task_id: task.id, verdict: 'APPROVED', summary: `${tag} Sin hallazgos bloqueantes.` },
              { action: 'git_request', op: 'push', task_id: task.id, branch: task.current_branch ?? slugBranch },
            ]
          : [
              {
                action: 'record_review',
                task_id: task.id,
                verdict: 'CHANGES_REQUESTED',
                summary: `${tag} Dos problemas encontrados.`,
                findings: [
                  { file: 'src/lib/auth.ts', line: 42, severity: 'high', note: 'Falta normalizar el email a minúsculas antes de comparar.' },
                  { file: 'tests/auth.test.ts', severity: 'medium', note: 'No hay test para emails con mayúsculas.' },
                ],
              },
            ],
      };
    }
    case 'RESEARCHER':
      return {
        steps: [
          { status: 'THINKING', activity: 'comparando alternativas', ms: 1800 },
          { status: 'WORKING', activity: 'redactando segunda opinión', ms: 1200 },
        ],
        text: `${tag} Segunda opinión sobre ${task.key}: la alternativa A es más simple; la B escala mejor. Recomiendo A para el MVP.`,
        actions: [{ action: 'propose_decision', task_id: task.id, title: `${task.key}: enfoque recomendado (demo)`, decision: 'Usar la alternativa A para el MVP.', rationale: `${tag} Menor complejidad.` }],
      };
    default:
      return {
        steps: [{ status: 'THINKING', activity: 'procesando', ms: 1200 }],
        text: `${tag} ${agent.name} procesó ${msg.message_type} en ${task.key}.`,
        actions: [],
      };
  }
}
