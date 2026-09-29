import { z } from 'zod';
import { userRoute, readJson } from '@/server/http/route';
import { listSkillDefinitions, createSkillDefinition } from '@/server/registry/skill-definitions';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ category: z.string().optional() });

/** Skill Registry catalogue. Instructions are included here (operator view);
 *  agent context building loads only the selected skills, never all of them. */
export const GET = userRoute(async ({ req, db }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const skills = await listSkillDefinitions(db, { category: q.category });
  return { skills, total: skills.length };
});

const createSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  instructions: z.string().max(60_000).optional(),
  required_tools: z.array(z.string().max(80)).max(50).optional(),
  security_level: z.enum(['standard', 'elevated', 'restricted']).optional(),
});

export const POST = userRoute(
  async ({ req, db }) => {
    const body = await readJson(req, createSchema);
    const skill = await createSkillDefinition(db, { ...body, source: 'custom' });
    return { skill };
  },
  { roles: ['owner', 'moderator'] },
);
