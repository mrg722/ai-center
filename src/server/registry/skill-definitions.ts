import 'server-only';
import type { Db } from '../db';
import { BadRequest, NotFound } from '../orchestrator/repo';
import type { SkillDefinitionInput, SkillDefinitionRow } from './types';

/**
 * Skill Registry — reusable procedures/knowledge, independent of any model
 * or agent. A skill is never loaded into a prompt just because it exists:
 * callers must go through `selectSkillsForAgent` (or their own explicit
 * slug list) so only what's relevant for the current agent/task is loaded.
 */

export async function listSkillDefinitions(db: Db, filter: { category?: string; enabled?: boolean } = {}): Promise<SkillDefinitionRow[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.category) {
    params.push(filter.category);
    conds.push(`category = $${params.length}`);
  }
  if (filter.enabled !== undefined) {
    params.push(filter.enabled);
    conds.push(`enabled = $${params.length}`);
  }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  const r = await db.query<SkillDefinitionRow>(`select * from skill_definitions ${where} order by category, slug`, params);
  return r.rows;
}

export async function getSkillDefinition(db: Db, id: string): Promise<SkillDefinitionRow> {
  const r = await db.query<SkillDefinitionRow>('select * from skill_definitions where id=$1', [id]);
  if (!r.rows[0]) throw new NotFound('skill not found');
  return r.rows[0];
}

export async function getSkillDefinitionBySlug(db: Db, slug: string): Promise<SkillDefinitionRow | null> {
  const r = await db.query<SkillDefinitionRow>('select * from skill_definitions where slug=$1', [slug]);
  return r.rows[0] ?? null;
}

export async function createSkillDefinition(db: Db, i: SkillDefinitionInput): Promise<SkillDefinitionRow> {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(i.slug)) throw new BadRequest('invalid slug');
  const r = await db.query<SkillDefinitionRow>(
    `insert into skill_definitions
      (slug, name, description, category, instructions, version, source, source_repo, source_path,
       required_tools, permissions, security_level, enabled, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning *`,
    [
      i.slug,
      i.name,
      i.description ?? '',
      i.category ?? '',
      i.instructions ?? '',
      i.version ?? '1.0.0',
      i.source ?? 'custom',
      i.source_repo ?? null,
      i.source_path ?? null,
      i.required_tools ?? [],
      JSON.stringify(i.permissions ?? {}),
      i.security_level ?? 'standard',
      i.enabled ?? true,
      JSON.stringify(i.metadata ?? {}),
    ],
  );
  return r.rows[0];
}

export async function setSkillEnabled(db: Db, id: string, enabled: boolean): Promise<SkillDefinitionRow> {
  const r = await db.query<SkillDefinitionRow>('update skill_definitions set enabled=$2 where id=$1 returning *', [id, enabled]);
  if (!r.rows[0]) throw new NotFound('skill not found');
  return r.rows[0];
}

export async function upsertSkillDefinition(db: Db, i: SkillDefinitionInput): Promise<{ skill: SkillDefinitionRow; action: 'created' | 'updated' }> {
  const existing = await getSkillDefinitionBySlug(db, i.slug);
  if (!existing) return { skill: await createSkillDefinition(db, i), action: 'created' };
  const r = await db.query<SkillDefinitionRow>(
    `update skill_definitions set name=$2, description=$3, category=$4, instructions=$5, version=$6,
        required_tools=$7, permissions=$8, security_level=$9, metadata=$10
      where id=$1 returning *`,
    [
      existing.id,
      i.name,
      i.description ?? existing.description,
      i.category ?? existing.category,
      i.instructions ?? existing.instructions,
      i.version ?? existing.version,
      i.required_tools ?? existing.required_tools,
      JSON.stringify(i.permissions ?? existing.permissions),
      i.security_level ?? existing.security_level,
      JSON.stringify(i.metadata ?? existing.metadata),
    ],
  );
  return { skill: r.rows[0], action: 'updated' };
}

/**
 * Skill selection: what a given agent definition (or explicit slug list)
 * should actually receive — never "all enabled skills". Keeps the context
 * small (Fase 2 / Fase 9 requirement: no cargar todas las skills en el prompt).
 */
export async function skillsForDefinition(db: Db, agentDefinitionId: string): Promise<SkillDefinitionRow[]> {
  const r = await db.query<SkillDefinitionRow>(
    `select s.* from agent_definition_skills ads
       join skill_definitions s on s.id = ads.skill_id
      where ads.agent_definition_id = $1 and s.enabled
      order by ads.sort_order`,
    [agentDefinitionId],
  );
  return r.rows;
}

export async function skillsBySlug(db: Db, slugs: string[]): Promise<SkillDefinitionRow[]> {
  if (!slugs.length) return [];
  const r = await db.query<SkillDefinitionRow>('select * from skill_definitions where slug = any($1) and enabled', [slugs]);
  return r.rows;
}

/** Renders only the selected skills' instructions, bounded, for the Context Engine. */
export function renderSkillInstructions(skills: SkillDefinitionRow[], maxCharsEach = 4000): string {
  return skills
    .map((s) => `### Skill: ${s.name} (${s.slug})\n${s.instructions.slice(0, maxCharsEach)}`)
    .join('\n\n');
}
