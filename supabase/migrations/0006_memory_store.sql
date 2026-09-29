-- Memory Store (Bloque 5) — independent of any model/provider.
--
-- Distinct from `project_context` (pinned project docs: rules/architecture/
-- glossary, edited by the moderator) and `decisions` (formal accepted
-- decisions). `memories` is where agents explicitly persist relevant facts,
-- lessons, preferences and task state — NOT a transcript of every message.
-- Extraction is explicit (the `remember` agent action, or the moderator UI),
-- never automatic per-message capture.

create table if not exists memories (
  id                 uuid primary key default acc_gen_random_uuid(),
  scope              text not null check (scope in ('global','project','agent','task','conversation')),
  project_id         uuid references projects(id) on delete cascade,
  agent_id           uuid references agents(id) on delete cascade,
  task_id            uuid references tasks(id) on delete cascade,
  conversation_id    uuid references conversations(id) on delete cascade,
  type               text not null check (type in
                      ('episodic','semantic','project','decision','preference','fact','lesson','security_finding','task_state')),
  content            text not null,
  summary            text not null default '',
  importance         smallint not null default 3 check (importance between 1 and 5),
  source             text not null default 'agent' check (source in ('user','agent','system','extraction')),
  created_by_user    uuid references users(id) on delete set null,
  created_by_agent   uuid references agents(id) on delete set null,
  pinned             boolean not null default false,
  archived           boolean not null default false,
  metadata           jsonb not null default '{}'::jsonb,
  embedding          double precision[],   -- nullable: retrieval falls back to structured/text search
  embedding_model    text,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- a scope's matching id must be present; a memory is never orphaned from its scope
  constraint memories_scope_ref check (
    (scope = 'global') or
    (scope = 'project' and project_id is not null) or
    (scope = 'agent' and agent_id is not null) or
    (scope = 'task' and task_id is not null) or
    (scope = 'conversation' and conversation_id is not null)
  )
);
create index if not exists memories_project_idx on memories (project_id, archived, importance desc, created_at desc) where project_id is not null;
create index if not exists memories_agent_idx on memories (agent_id, archived, created_at desc) where agent_id is not null;
create index if not exists memories_task_idx on memories (task_id, archived, created_at desc) where task_id is not null;
create index if not exists memories_type_idx on memories (type);
create index if not exists memories_pinned_idx on memories (project_id, pinned) where pinned and not archived;

do $$
begin
  execute 'drop trigger if exists memories_touch on memories';
  execute 'create trigger memories_touch before update on memories for each row execute function acc_touch_updated_at()';
end $$;

alter table memories enable row level security;
