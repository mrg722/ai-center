import 'server-only';
import type { Db } from '../db';
import { BadRequest, NotFound } from '../orchestrator/repo';
import { skillsForDefinition } from './skill-definitions';
import type { AgentDefinitionInput, AgentDefinitionRow, SkillDefinitionRow } from './types';

/**
 * Agent Registry — catalogue of reusable agent TEMPLATES (identity, mission,
 * instructions, division). Global, not project-scoped: a definition is a
 * blueprint an operator can turn into an executable `agents` row in any
 * project by picking a runtime/model for it (Model Router stays separate).
 */

export async function listAgentDefinitions(db: Db, filter: { division?: string; source?: string; enabled?: boolean } = {}): Promise<AgentDefinitionRow[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.division) {
    params.push(filter.division);
    conds.push(`division = $${params.length}`);
  }
  if (filter.source) {
    params.push(filter.source);
    conds.push(`source = $${params.length}`);
  }
  if (filter.enabled !== undefined) {
    params.push(filter.enabled);
    conds.push(`enabled = $${params.length}`);
  }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  const r = await db.query<AgentDefinitionRow>(`select * from agent_definitions ${where} order by division, slug`, params);
  return r.rows;
}

export async function getAgentDefinition(db: Db, id: string): Promise<AgentDefinitionRow> {
  const r = await db.query<AgentDefinitionRow>('select * from agent_definitions where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('agent definition not found');
  return r.rows[0];
}

export async function getAgentDefinitionBySlug(db: Db, slug: string): Promise<AgentDefinitionRow | null> {
  const r = await db.query<AgentDefinitionRow>('select * from agent_definitions where slug=$1', [slug]);
  return r.rows[0] ?? null;
}

/** Creates a definition. Use `upsertImported` for source='agency-agents' sync. */
export async function createAgentDefinition(db: Db, i: AgentDefinitionInput): Promise<AgentDefinitionRow> {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(i.slug)) throw new BadRequest('invalid slug');
  const r = await db.query<AgentDefinitionRow>(
    `insert into agent_definitions
      (slug, name, description, division, identity, mission, workflows, deliverables, instructions,
       source, source_repo, source_path, source_version, source_hash, enabled, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning *`,
    [
      i.slug,
      i.name,
      i.description ?? '',
      i.division ?? '',
      i.identity ?? '',
      i.mission ?? '',
      JSON.stringify(i.workflows ?? []),
      i.deliverables ?? '',
      i.instructions ?? '',
      i.source ?? 'custom',
      i.source_repo ?? null,
      i.source_path ?? null,
      i.source_version ?? null,
      i.source_hash ?? null,
      i.enabled ?? true,
      JSON.stringify(i.metadata ?? {}),
    ],
  );
  return r.rows[0];
}

export async function updateAgentDefinition(db: Db, id: string, patch: Partial<AgentDefinitionInput> & { customized?: boolean }): Promise<AgentDefinitionRow> {
  const existing = await getAgentDefinition(db, id);
  const next = { ...existing, ...patch, workflows: patch.workflows ?? existing.workflows, metadata: patch.metadata ?? existing.metadata };
  const r = await db.query<AgentDefinitionRow>(
    `update agent_definitions set name=$2, description=$3, division=$4, identity=$5, mission=$6, workflows=$7,
        deliverables=$8, instructions=$9, enabled=$10, metadata=$11, customized=$12,
        source_hash=coalesce($13, source_hash), source_version=coalesce($14, source_version)
      where id=$1 returning *`,
    [
      id,
      next.name,
      next.description,
      next.division,
      next.identity,
      next.mission,
      JSON.stringify(next.workflows),
      next.deliverables,
      next.instructions,
      next.enabled,
      JSON.stringify(next.metadata),
      // any manual edit (patch that isn't the importer) marks it customized so a
      // future re-sync never overwrites it silently.
      patch.customized ?? true,
      patch.source_hash ?? null,
      patch.source_version ?? null,
    ],
  );
  return r.rows[0];
}

export async function deleteAgentDefinition(db: Db, id: string): Promise<void> {
  await db.query('delete from agent_definitions where id=$1', [id]);
}

/**
 * Import/sync upsert used by the Agency Agents importer (and any future
 * source). Never overwrites a row a human has since customized — inserts a
 * fresh row only, and reports the conflict so the caller can surface a diff.
 */
export async function upsertImportedAgentDefinition(
  db: Db,
  i: AgentDefinitionInput & { source_hash: string },
): Promise<{ definition: AgentDefinitionRow; action: 'created' | 'updated' | 'skipped-customized' | 'unchanged' }> {
  const existing = await getAgentDefinitionBySlug(db, i.slug);
  if (!existing) {
    const definition = await createAgentDefinition(db, i);
    return { definition, action: 'created' };
  }
  if (existing.customized) {
    return { definition: existing, action: 'skipped-customized' };
  }
  if (existing.source_hash === i.source_hash) {
    return { definition: existing, action: 'unchanged' };
  }
  const definition = await updateAgentDefinition(db, existing.id, { ...i, customized: false });
  return { definition, action: 'updated' };
}

/** Skills attached to a definition, in author order. */
export async function definitionSkillSlugs(db: Db, definitionId: string): Promise<string[]> {
  const r = await db.query<{ slug: string }>(
    `select s.slug from agent_definition_skills ads
       join skill_definitions s on s.id = ads.skill_id
      where ads.agent_definition_id = $1
      order by ads.sort_order, s.slug`,
    [definitionId],
  );
  return r.rows.map((x) => x.slug);
}

/**
 * What the Context Engine actually needs for an executable agent that is
 * linked to a definition: identity/mission (who it is) + its SELECTED
 * skills' instructions (never the whole catalogue — see skillsForDefinition).
 * This is the real "Security Engineer + api-security + owasp + memory + LLM"
 * composition from docs/ARCHITECTURE_AI_PLATFORM.md § 1.
 */
export async function loadDefinitionForContext(
  db: Db,
  definitionId: string,
): Promise<{ definition: AgentDefinitionRow; skills: SkillDefinitionRow[] } | null> {
  const r = await db.query<AgentDefinitionRow>('select * from agent_definitions where id=$1 and enabled', [definitionId]);
  if (!r.rows[0]) return null;
  const skills = await skillsForDefinition(db, definitionId);
  return { definition: r.rows[0], skills };
}

export async function setDefinitionSkills(db: Db, definitionId: string, skillIds: { skillId: string; required?: boolean }[]): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query('delete from agent_definition_skills where agent_definition_id=$1', [definitionId]);
    for (let idx = 0; idx < skillIds.length; idx++) {
      const { skillId, required = true } = skillIds[idx];
      await tx.query(
        'insert into agent_definition_skills (agent_definition_id, skill_id, sort_order, required) values ($1,$2,$3,$4)',
        [definitionId, skillId, idx, required],
      );
    }
  });
}
