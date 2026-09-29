/**
 * Agent Registry / Skill Registry — catalogue types.
 *
 * These are TEMPLATES: identity, mission, skills. Never the executable
 * agent. The executable agent is `agents` (project-scoped: runtime, model,
 * permissions — see src/server/types.ts) optionally linked to one of these
 * via `agents.agent_definition_id`. Model Router / runtime selection is
 * untouched by this module (see src/server/providers/registry.ts).
 */

export type DefinitionSource = 'custom' | 'agency-agents';
export type SkillSource = 'custom' | 'agency-agents' | 'strix';
export type SecurityLevel = 'standard' | 'elevated' | 'restricted';

export interface AgentDefinitionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  division: string;
  identity: string;
  mission: string;
  workflows: string[];
  deliverables: string;
  instructions: string;
  source: DefinitionSource;
  source_repo: string | null;
  source_path: string | null;
  source_version: string | null;
  source_hash: string | null;
  customized: boolean;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SkillDefinitionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  version: string;
  source: SkillSource;
  source_repo: string | null;
  source_path: string | null;
  required_tools: string[];
  permissions: Record<string, unknown>;
  security_level: SecurityLevel;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentDefinitionSkillRow {
  agent_definition_id: string;
  skill_id: string;
  sort_order: number;
  required: boolean;
  created_at: string;
}

/** Input for upserting an agent definition (create, or update if not `customized`). */
export interface AgentDefinitionInput {
  slug: string;
  name: string;
  description?: string;
  division?: string;
  identity?: string;
  mission?: string;
  workflows?: string[];
  deliverables?: string;
  instructions?: string;
  source?: DefinitionSource;
  source_repo?: string | null;
  source_path?: string | null;
  source_version?: string | null;
  source_hash?: string | null;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SkillDefinitionInput {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  instructions?: string;
  version?: string;
  source?: SkillSource;
  source_repo?: string | null;
  source_path?: string | null;
  required_tools?: string[];
  permissions?: Record<string, unknown>;
  security_level?: SecurityLevel;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}
