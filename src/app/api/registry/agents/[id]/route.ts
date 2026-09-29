import { z } from 'zod';
import { userRoute, readJson, HttpError } from '@/server/http/route';
import { getAgentDefinition, updateAgentDefinition, definitionSkillSlugs, setDefinitionSkills, deleteAgentDefinition } from '@/server/registry/agent-definitions';
import { skillsBySlug } from '@/server/registry/skill-definitions';

export const dynamic = 'force-dynamic';

export const GET = userRoute<{ id: string }>(async ({ db, params }) => {
  const definition = await getAgentDefinition(db, params.id);
  const skills = await definitionSkillSlugs(db, definition.id);
  return { definition: { ...definition, skills } };
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  division: z.string().max(80).optional(),
  identity: z.string().max(20_000).optional(),
  mission: z.string().max(20_000).optional(),
  deliverables: z.string().max(20_000).optional(),
  instructions: z.string().max(60_000).optional(),
  enabled: z.boolean().optional(),
  /** Full replacement of the definition's skill set, by slug. */
  skills: z.array(z.string()).max(50).optional(),
});

export const PATCH = userRoute<{ id: string }>(
  async ({ req, db, params }) => {
    const body = await readJson(req, patchSchema);
    const existing = await getAgentDefinition(db, params.id);
    if (Object.keys(body).some((k) => k !== 'skills')) {
      await updateAgentDefinition(db, params.id, body);
    }
    if (body.skills) {
      const rows = await skillsBySlug(db, body.skills);
      if (rows.length !== body.skills.length) throw new HttpError(400, 'one or more skill slugs are unknown or disabled');
      await setDefinitionSkills(db, existing.id, rows.map((r) => ({ skillId: r.id })));
    }
    const definition = await getAgentDefinition(db, params.id);
    const skills = await definitionSkillSlugs(db, definition.id);
    return { definition: { ...definition, skills } };
  },
  { roles: ['owner', 'moderator'] },
);

export const DELETE = userRoute<{ id: string }>(
  async ({ db, params }) => {
    await getAgentDefinition(db, params.id); // 404s if missing
    await deleteAgentDefinition(db, params.id);
    return { ok: true };
  },
  { roles: ['owner', 'moderator'] },
);
