import 'server-only';
import type { Db } from '../db';
import type { AgentRow, ProjectRow } from '../types';
import { getAgentBySlug, listAgentRows } from '../orchestrator/repo';

/**
 * Model Router (Bloque 7) — thin layer on top of the existing runtime
 * registry (src/server/providers/registry.ts). It does NOT pick a provider:
 * an agent already fixes runtime+model+permissions. What this resolves is
 * "which already-configured agent should handle a task with capability X",
 * from operator configuration (project.settings.model_routing), never from
 * agent count or vendor names hardcoded in the core.
 *
 * Deterministic + configurable first (Fase 5): no scoring/ML routing yet —
 * this is the seam a future capability-scoring router replaces without
 * touching callers (they only ever ask for a capability, never a runtime).
 */
export const TASK_CAPABILITIES = ['simple', 'code', 'research', 'security', 'reasoning'] as const;
export type TaskCapability = (typeof TASK_CAPABILITIES)[number];

/** Built-in fallback when the operator has not configured model_routing for a capability. */
const DEFAULT_ROLE_FOR_CAPABILITY: Record<TaskCapability, string> = {
  simple: 'GENERIC',
  code: 'PRIMARY_BUILDER',
  research: 'RESEARCHER',
  security: 'AUDITOR_INTEGRATOR',
  reasoning: 'PRIMARY_BUILDER',
};

export async function resolveAgentForCapability(db: Db, project: ProjectRow, capability: string): Promise<AgentRow | null> {
  const configuredSlug = project.settings.model_routing?.[capability];
  if (configuredSlug) {
    const agent = await getAgentBySlug(db, project.id, configuredSlug);
    if (agent && agent.enabled) return agent;
  }
  // fallback: first enabled agent matching the capability's default role
  const role = DEFAULT_ROLE_FOR_CAPABILITY[capability as TaskCapability];
  if (!role) return null;
  const agents = await listAgentRows(db, project.id);
  return agents.find((a) => a.enabled && a.role === role) ?? agents.find((a) => a.enabled) ?? null;
}

/** Snapshot of the current routing table — configured + resolved fallback, for the UI/API. */
export async function describeRouting(db: Db, project: ProjectRow): Promise<{ capability: TaskCapability; configured_slug: string | null; resolved_agent: string | null }[]> {
  return Promise.all(
    TASK_CAPABILITIES.map(async (capability) => {
      const resolved = await resolveAgentForCapability(db, project, capability);
      return { capability, configured_slug: project.settings.model_routing?.[capability] ?? null, resolved_agent: resolved?.slug ?? null };
    }),
  );
}
