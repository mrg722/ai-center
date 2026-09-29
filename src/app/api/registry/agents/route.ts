import { z } from 'zod';
import { userRoute, readJson } from '@/server/http/route';
import { listAgentDefinitions, createAgentDefinition, definitionSkillSlugs } from '@/server/registry/agent-definitions';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ division: z.string().optional(), source: z.string().optional() });

/** Agent Registry catalogue (templates), not the executable `agents` table. */
export const GET = userRoute(async ({ req, db }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const definitions = await listAgentDefinitions(db, { division: q.division, source: q.source });
  const withSkills = await Promise.all(
    definitions.map(async (d) => ({ ...d, skills: await definitionSkillSlugs(db, d.id) })),
  );
  return { definitions: withSkills, total: withSkills.length };
});

const createSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  division: z.string().max(80).optional(),
  identity: z.string().max(20_000).optional(),
  mission: z.string().max(20_000).optional(),
  workflows: z.array(z.string().max(2000)).max(50).optional(),
  deliverables: z.string().max(20_000).optional(),
  instructions: z.string().max(60_000).optional(),
});

export const POST = userRoute(
  async ({ req, db }) => {
    const body = await readJson(req, createSchema);
    const definition = await createAgentDefinition(db, { ...body, source: 'custom' });
    return { definition };
  },
  { roles: ['owner', 'moderator'] },
);
