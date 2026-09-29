/**
 * Agent Registry + Skill Registry + Agency Agents importer, against a real
 * (embedded) Postgres — same code paths the API routes use.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, __setDb, type Db } from '@/server/db';
import {
  createAgentDefinition,
  getAgentDefinitionBySlug,
  listAgentDefinitions,
  setDefinitionSkills,
  updateAgentDefinition,
  upsertImportedAgentDefinition,
} from '@/server/registry/agent-definitions';
import { createSkillDefinition, listSkillDefinitions, renderSkillInstructions, skillsForDefinition } from '@/server/registry/skill-definitions';
import { importAgencyAgentFiles, parseAgencyAgentFile } from '@/server/registry/import-agency';

let db: Db;

async function fresh() {
  __setDb(undefined);
  process.env.PGLITE_DIR = 'memory';
  delete process.env.DATABASE_URL;
  db = await getDb();
}

// A representative sample file matching the real Agency Agents frontmatter
// format (name/description/color/emoji/vibe + ## sections). Not copied from
// the upstream repo — written to exercise the parser against the documented
// shape without vendoring third-party content into this test.
const SAMPLE_MD = `---
name: Security Engineer
description: Reviews and hardens application security end to end.
color: "#dc2626"
emoji: 🛡️
vibe: Finds the hole before someone else does.
---

# Security Engineer

You are **Security Engineer**.

## 🧠 Your Identity & Memory

- **Role**: Senior application security engineer
- **Personality**: Methodical, skeptical of defaults

## 🎯 Your Core Mission

- Review authentication and authorization on every endpoint
- Track down injection and SSRF classes of bugs

## 📋 Your Technical Deliverables

- A findings report with severity and remediation
`;

describe('agent registry', () => {
  beforeEach(fresh, 30_000);

  it('creates, lists and filters agent definitions', async () => {
    await createAgentDefinition(db, { slug: 'security-engineer', name: 'Security Engineer', division: 'security' });
    await createAgentDefinition(db, { slug: 'frontend-dev', name: 'Frontend Developer', division: 'engineering' });
    const all = await listAgentDefinitions(db);
    expect(all.map((d) => d.slug).sort()).toEqual(['frontend-dev', 'security-engineer']);
    const security = await listAgentDefinitions(db, { division: 'security' });
    expect(security).toHaveLength(1);
    expect(security[0].source).toBe('custom');
  });

  it('rejects an invalid slug', async () => {
    await expect(createAgentDefinition(db, { slug: 'Not Valid', name: 'x' })).rejects.toThrow();
  });

  it('manual edits mark a definition customized, blocking silent re-import overwrites', async () => {
    const d = await createAgentDefinition(db, {
      slug: 'penetration-tester',
      name: 'Penetration Tester',
      division: 'security',
      source: 'agency-agents',
      source_repo: 'https://github.com/msitarzewski/agency-agents',
      source_path: 'security/security-penetration-tester.md',
      source_version: 'abc1234',
      source_hash: 'hash-v1',
    });
    expect(d.customized).toBe(false);

    await updateAgentDefinition(db, d.id, { mission: 'Edited by an operator' });
    const edited = await getAgentDefinitionBySlug(db, 'penetration-tester');
    expect(edited!.customized).toBe(true);

    const resync = await upsertImportedAgentDefinition(db, {
      slug: 'penetration-tester',
      name: 'Penetration Tester',
      division: 'security',
      source: 'agency-agents',
      source_repo: 'https://github.com/msitarzewski/agency-agents',
      source_path: 'security/security-penetration-tester.md',
      source_version: 'def5678',
      source_hash: 'hash-v2',
      mission: 'Upstream changed this',
    });
    expect(resync.action).toBe('skipped-customized');
    expect(resync.definition.mission).toBe('Edited by an operator');
  });

  it('re-import is idempotent (unchanged) when the source hash has not changed', async () => {
    const input = {
      slug: 'appsec-engineer',
      name: 'AppSec Engineer',
      division: 'security',
      source: 'agency-agents' as const,
      source_hash: 'stable-hash',
    };
    const first = await upsertImportedAgentDefinition(db, input);
    expect(first.action).toBe('created');
    const second = await upsertImportedAgentDefinition(db, input);
    expect(second.action).toBe('unchanged');
  });

  it('an upstream content change updates a non-customized imported definition', async () => {
    await upsertImportedAgentDefinition(db, { slug: 'appsec-engineer', name: 'AppSec Engineer', source: 'agency-agents', source_hash: 'v1' });
    const updated = await upsertImportedAgentDefinition(db, { slug: 'appsec-engineer', name: 'AppSec Engineer v2', source: 'agency-agents', source_hash: 'v2' });
    expect(updated.action).toBe('updated');
    expect(updated.definition.name).toBe('AppSec Engineer v2');
    expect(updated.definition.source_hash).toBe('v2');
  });
});

describe('skill registry', () => {
  beforeEach(fresh, 30_000);

  it('creates skills and links them to an agent definition (selection, not bulk load)', async () => {
    const idor = await createSkillDefinition(db, { slug: 'test-idor-check', name: 'IDOR Testing', category: 'security', instructions: 'Test object-level auth.' });
    const custom = await createSkillDefinition(db, { slug: 'test-custom-recon', name: 'Custom Recon', category: 'security', instructions: 'Walk the target.' });
    await createSkillDefinition(db, { slug: 'test-unrelated', name: 'Unrelated skill', category: 'design' });

    const agent = await createAgentDefinition(db, { slug: 'security-engineer', name: 'Security Engineer', division: 'security' });
    await setDefinitionSkills(db, agent.id, [{ skillId: idor.id }, { skillId: custom.id }]);

    const selected = await skillsForDefinition(db, agent.id);
    expect(selected.map((s) => s.slug)).toEqual(['test-idor-check', 'test-custom-recon']);
    expect(selected.map((s) => s.slug)).not.toContain('test-unrelated');

    const rendered = renderSkillInstructions(selected);
    expect(rendered).toContain('IDOR Testing');
    expect(rendered).toContain('Custom Recon');
    expect(rendered).not.toContain('Unrelated skill');
  });

  it('disabled skills never enter selection', async () => {
    const s = await createSkillDefinition(db, { slug: 'test-disabled-skill', name: 'Disabled', category: 'security' });
    const agent = await createAgentDefinition(db, { slug: 'sec-agent', name: 'Sec Agent' });
    await setDefinitionSkills(db, agent.id, [{ skillId: s.id }]);
    await db.query('update skill_definitions set enabled=false where id=$1', [s.id]);
    expect(await skillsForDefinition(db, agent.id)).toHaveLength(0);
    expect((await listSkillDefinitions(db, { enabled: true })).map((x) => x.slug)).not.toContain('test-disabled-skill');
  });

  it('never contains secrets or credentials in stored instructions', async () => {
    const s = await createSkillDefinition(db, {
      slug: 'no-secrets',
      name: 'No secrets',
      instructions: 'Use the configured provider API key from environment variables; never hardcode credentials.',
    });
    expect(s.instructions).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(s.instructions).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });
});

describe('agency-agent-import (Fase 19)', () => {
  beforeEach(fresh, 30_000);

  it('parses frontmatter + sections into a normalized AgentDefinition', () => {
    const parsed = parseAgencyAgentFile('security', 'security-engineer.md', SAMPLE_MD);
    expect(parsed.slug).toBe('engineer');
    expect(parsed.name).toBe('Security Engineer');
    expect(parsed.description).toContain('Reviews and hardens');
    expect(parsed.identity).toContain('Senior application security engineer');
    expect(parsed.mission).toContain('injection and SSRF');
    expect(parsed.deliverables).toContain('findings report');
    expect(parsed.instructions).toContain('You are **Security Engineer**');
    // no secret-shaped content leaks through parsing
    expect(parsed.instructions).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });

  it('imports a batch, recording source/version/hash, with no secrets stored', async () => {
    const results = await importAgencyAgentFiles(
      db,
      [{ division: 'security', filename: 'security-security-engineer.md', content: SAMPLE_MD }],
      { sourceRepo: 'https://github.com/msitarzewski/agency-agents', sourceVersion: 'abc1234' },
    );
    expect(results).toEqual([{ slug: 'security-engineer', division: 'security', action: 'created' }]);

    const stored = await getAgentDefinitionBySlug(db, 'security-engineer');
    expect(stored).not.toBeNull();
    expect(stored!.source).toBe('agency-agents');
    expect(stored!.source_repo).toBe('https://github.com/msitarzewski/agency-agents');
    expect(stored!.source_path).toBe('security/security-security-engineer.md');
    expect(stored!.source_version).toBe('abc1234');
    expect(stored!.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.customized).toBe(false);
    expect(JSON.stringify(stored)).not.toMatch(/sk-[a-zA-Z0-9]{20,}|Bearer [A-Za-z0-9._-]{10,}/);
  });

  it('re-importing the same content twice is a no-op the second time', async () => {
    const files = [{ division: 'security', filename: 'security-security-engineer.md', content: SAMPLE_MD }];
    const opts = { sourceRepo: 'https://github.com/msitarzewski/agency-agents', sourceVersion: 'abc1234' };
    await importAgencyAgentFiles(db, files, opts);
    const second = await importAgencyAgentFiles(db, files, opts);
    expect(second[0].action).toBe('unchanged');
  });
});
