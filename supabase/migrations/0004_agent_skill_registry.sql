-- Agent Registry + Skill Registry — catalogue layer, independent of any
-- particular model/provider and independent of a specific project.
--
-- These tables are a TEMPLATE catalogue, not the executable agent. The
-- existing `agents` table (project-scoped: runtime, model, config, permissions)
-- is untouched and keeps deciding what actually runs. An `agents` row may
-- optionally point at an `agent_definition` for identity/mission/skills.

-- ─────────────────────────────────────────────────────────── agent_definitions
create table if not exists agent_definitions (
  id               uuid primary key default acc_gen_random_uuid(),
  slug             text not null check (slug ~ '^[a-z][a-z0-9-]{1,63}$'),
  name             text not null,
  description      text not null default '',
  division         text not null default '',      -- category, e.g. "security", "engineering"
  identity         text not null default '',       -- role/personality/experience
  mission          text not null default '',       -- what the agent is responsible for
  workflows        jsonb not null default '[]'::jsonb,
  deliverables     text not null default '',
  instructions     text not null default '',        -- full normalized prompt body
  source           text not null default 'custom' check (source in ('custom','agency-agents')),
  source_repo      text,
  source_path      text,
  source_version   text,                             -- upstream commit (short hash)
  source_hash      text,                             -- sha256 of the imported file, for diffing
  customized       boolean not null default false,   -- true once a human edits an imported row
  enabled          boolean not null default true,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists agent_definitions_slug_uq on agent_definitions (slug);
create index if not exists agent_definitions_division_idx on agent_definitions (division, enabled);
create index if not exists agent_definitions_source_idx on agent_definitions (source, source_path);

-- ─────────────────────────────────────────────────────────── skill_definitions
create table if not exists skill_definitions (
  id                  uuid primary key default acc_gen_random_uuid(),
  slug                text not null check (slug ~ '^[a-z][a-z0-9-]{1,63}$'),
  name                text not null,
  description         text not null default '',
  category            text not null default '',
  instructions        text not null default '',       -- loaded on demand, never injected in bulk
  version             text not null default '1.0.0',
  source              text not null default 'custom' check (source in ('custom','agency-agents','strix')),
  source_repo         text,
  source_path         text,
  required_tools      text[] not null default '{}',
  permissions         jsonb not null default '{}'::jsonb,   -- capability requirements, checked by Permission Engine
  security_level      text not null default 'standard' check (security_level in ('standard','elevated','restricted')),
  enabled             boolean not null default true,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists skill_definitions_slug_uq on skill_definitions (slug);
create index if not exists skill_definitions_category_idx on skill_definitions (category, enabled);

-- ─────────────────────────────────────────────────────────── agent ⟷ skill (N:M)
create table if not exists agent_definition_skills (
  agent_definition_id  uuid not null references agent_definitions(id) on delete cascade,
  skill_id             uuid not null references skill_definitions(id) on delete cascade,
  sort_order           integer not null default 0,
  required              boolean not null default true,
  created_at           timestamptz not null default now(),
  primary key (agent_definition_id, skill_id)
);
create index if not exists agent_definition_skills_skill_idx on agent_definition_skills (skill_id);

-- ─────────────────────────────────────────────────────────── link: project agent → catalogue definition
alter table agents add column if not exists agent_definition_id uuid references agent_definitions(id) on delete set null;
create index if not exists agents_definition_idx on agents (agent_definition_id) where agent_definition_id is not null;

do $$
begin
  execute 'drop trigger if exists agent_definitions_touch on agent_definitions';
  execute 'create trigger agent_definitions_touch before update on agent_definitions for each row execute function acc_touch_updated_at()';
  execute 'drop trigger if exists skill_definitions_touch on skill_definitions';
  execute 'create trigger skill_definitions_touch before update on skill_definitions for each row execute function acc_touch_updated_at()';
end $$;

do $$
declare t text;
begin
  foreach t in array array['agent_definitions','skill_definitions','agent_definition_skills'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
