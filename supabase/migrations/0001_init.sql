-- AI Command Center — initial schema
-- Compatible with Supabase (Postgres 15+) and plain PostgreSQL 14+.
-- Operational state only. Code, assets and history live in Git/GitHub.
--
-- Security note (Supabase): every table has RLS enabled and NO policies,
-- so the auto-generated PostgREST API (anon / authenticated keys) cannot
-- read or write anything. The orchestrator connects server-side with a
-- direct Postgres connection string (DATABASE_URL), which bypasses RLS.

set client_min_messages = warning;

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────── helpers
create or replace function acc_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────── users
create table if not exists users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  display_name     text not null,
  password_hash    text not null,
  role             text not null default 'moderator'
                   check (role in ('owner','moderator','viewer')),
  session_version  integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_login_at    timestamptz
);
create unique index if not exists users_email_uq on users (lower(email));

-- ─────────────────────────────────────────────────────────────── projects
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  key             text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name            text not null,
  description     text not null default '',
  repo_owner      text,
  repo_name       text,
  default_branch  text not null default 'main',
  mode            text not null default 'MODERATED'
                  check (mode in ('DEMO','MODERATED','SUPERVISED','AUTONOMOUS')),
  halted          boolean not null default false,
  halted_at       timestamptz,
  halted_by       uuid references users(id) on delete set null,
  max_auto_hops   integer not null default 10 check (max_auto_hops between 1 and 200),
  task_seq        integer not null default 0,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists projects_key_uq on projects (key);

-- ─────────────────────────────────────────────────────────────── agents
create table if not exists agents (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  slug              text not null check (slug ~ '^[a-z][a-z0-9-]{1,31}$'),
  name              text not null,
  -- Agent ≠ Provider ≠ Runtime ≠ Transport. `runtime` is the registry key
  -- (claude-code, codex, gemini, ollama, simulator…); the registry resolves
  -- its provider (vendor), transport and capabilities. `transport` is stored
  -- denormalised for queries: how the orchestrator reaches the runtime.
  runtime           text not null,
  transport         text not null check (transport in ('local-bridge','http-api','in-process')),
  model             text not null default '',
  role              text not null default 'GENERIC',
  role_label        text not null default '',
  description       text not null default '',
  color             text not null default '#94a3b8',
  config            jsonb not null default '{}'::jsonb,  -- never contains secrets (only env var NAMES)
  enabled           boolean not null default true,
  paused            boolean not null default false,
  token_hash        text,                    -- sha256 of the bridge token (bridge agents)
  token_prefix      text,
  token_created_at  timestamptz,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists agents_project_slug_uq on agents (project_id, slug);
create unique index if not exists agents_token_hash_uq on agents (token_hash) where token_hash is not null;

create table if not exists agent_capabilities (
  agent_id    uuid not null references agents(id) on delete cascade,
  capability  text not null,
  meta        jsonb not null default '{}'::jsonb,
  primary key (agent_id, capability)
);

-- base + temporary permission grants. Effective permission = most recent
-- non-revoked, non-expired row per (agent, action); temporary rows win.
create table if not exists permissions (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  action      text not null,
  allowed     boolean not null,
  scope       text not null default 'base' check (scope in ('base','temporary')),
  expires_at  timestamptz,
  granted_by  uuid references users(id) on delete set null,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists permissions_agent_action_idx
  on permissions (agent_id, action, created_at desc) where revoked_at is null;

-- presence / session memory (volatile, small, updated in place)
create table if not exists agent_sessions (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references agents(id) on delete cascade,
  started_at         timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now(),
  ended_at           timestamptz,
  status             text not null default 'ONLINE'
                     check (status in ('ONLINE','WORKING','THINKING','WAITING','REVIEWING','ERROR','BLOCKED')),
  activity           text not null default '',
  current_task_id    uuid,
  workspace          jsonb not null default '{}'::jsonb,  -- repo, branch, commit, dirty files (no secrets)
  tools              jsonb not null default '[]'::jsonb,
  client_version     text not null default ''
);
create index if not exists agent_sessions_open_idx
  on agent_sessions (agent_id, last_heartbeat_at desc) where ended_at is null;

-- ─────────────────────────────────────────────────────────────── conversations & tasks
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  task_id     uuid,
  kind        text not null default 'task' check (kind in ('task','general','direct')),
  title       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists conversations_project_idx on conversations (project_id, created_at desc);

create table if not exists tasks (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references projects(id) on delete cascade,
  key                      text not null,
  seq                      integer not null,
  title                    text not null,
  description              text not null default '',
  priority                 text not null default 'NORMAL'
                           check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status                   text not null default 'OPEN'
                           check (status in ('OPEN','PLANNING','IN_PROGRESS','WAITING_AGENT','WAITING_REVIEW',
                                             'WAITING_USER','APPROVED','REJECTED','BLOCKED','FAILED',
                                             'COMPLETED','CANCELLED')),
  created_by_user          uuid references users(id) on delete set null,
  created_by_agent         uuid references agents(id) on delete set null,
  assigned_agent           uuid references agents(id) on delete set null,
  next_agent               uuid references agents(id) on delete set null,
  conversation_id          uuid references conversations(id) on delete set null,
  parent_task_id           uuid references tasks(id) on delete set null,
  requires_human_approval  boolean not null default true,
  current_branch           text,
  current_commit           text,
  context_summary          text not null default '',
  created_files            text[] not null default '{}',
  modified_files           text[] not null default '{}',
  related_commits          text[] not null default '{}',
  auto_hops                integer not null default 0,
  paused                   boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz
);
create unique index if not exists tasks_project_seq_uq on tasks (project_id, seq);
create unique index if not exists tasks_project_key_uq on tasks (project_id, key);
create index if not exists tasks_project_status_idx on tasks (project_id, status, updated_at desc);
create index if not exists tasks_assigned_idx on tasks (assigned_agent, status);
create index if not exists tasks_parent_idx on tasks (parent_task_id) where parent_task_id is not null;

alter table conversations
  drop constraint if exists conversations_task_fk;
alter table conversations
  add constraint conversations_task_fk foreign key (task_id) references tasks(id) on delete cascade;

create table if not exists task_steps (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  agent_id    uuid references agents(id) on delete set null,
  user_id     uuid references users(id) on delete set null,
  kind        text not null,
  title       text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists task_steps_task_idx on task_steps (task_id, created_at);

-- ─────────────────────────────────────────────────────────────── messages
create table if not exists messages (
  id                 uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,
  project_id         uuid not null references projects(id) on delete cascade,
  task_id            uuid references tasks(id) on delete cascade,
  conversation_id    uuid not null references conversations(id) on delete cascade,
  from_kind          text not null check (from_kind in ('user','agent','system')),
  from_agent         uuid references agents(id) on delete set null,
  from_user          uuid references users(id) on delete set null,
  to_agent           uuid references agents(id) on delete set null,
  to_all             boolean not null default false,
  message_type       text not null check (message_type in (
                        'TASK','REQUEST','REVIEW','QUESTION','ANSWER','WARNING','ERROR','PROPOSAL',
                        'APPROVAL_REQUEST','STATUS','RESULT','HANDOFF','COMMAND','NOTE')),
  content            text not null,
  reply_to           uuid references messages(id) on delete set null,
  priority           text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  requires_action    boolean not null default false,
  requires_approval  boolean not null default false,
  git_branch         text,
  git_commit         text,
  files              text[] not null default '{}',
  attachments        jsonb not null default '[]'::jsonb,
  status             text not null default 'SENT'
                     check (status in ('SENT','HELD','DELIVERED','PROCESSED','FAILED','CANCELLED')),
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create unique index if not exists messages_seq_uq on messages (seq);
create index if not exists messages_conversation_idx on messages (conversation_id, seq);
create index if not exists messages_task_idx on messages (task_id, seq) where task_id is not null;
create index if not exists messages_project_idx on messages (project_id, seq desc);

-- one row per (message, recipient agent): the orchestrator's delivery queue
create table if not exists deliveries (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references messages(id) on delete cascade,
  agent_id      uuid not null references agents(id) on delete cascade,
  status        text not null default 'PENDING'
                check (status in ('PENDING','HELD','DELIVERED','DONE','FAILED','CANCELLED')),
  attempts      integer not null default 0,
  lease_until   timestamptz,
  delivered_at  timestamptz,
  completed_at  timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists deliveries_msg_agent_uq on deliveries (message_id, agent_id);
create index if not exists deliveries_queue_idx on deliveries (agent_id, created_at)
  where status in ('PENDING','DELIVERED');

-- ─────────────────────────────────────────────────────────────── approvals
create table if not exists approvals (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  task_id            uuid references tasks(id) on delete cascade,
  requested_by_agent uuid references agents(id) on delete set null,
  action             text not null,
  title              text not null,
  detail             text not null default '',
  payload            jsonb not null default '{}'::jsonb,
  status             text not null default 'PENDING'
                     check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  decided_by         uuid references users(id) on delete set null,
  decided_at         timestamptz,
  decision_note      text not null default '',
  created_at         timestamptz not null default now(),
  expires_at         timestamptz
);
create index if not exists approvals_pending_idx on approvals (project_id, created_at desc) where status = 'PENDING';
create index if not exists approvals_task_idx on approvals (task_id, created_at desc);

-- ─────────────────────────────────────────────────────────────── events (audit log)
create table if not exists events (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references projects(id) on delete cascade,
  type        text not null,
  actor_kind  text not null check (actor_kind in ('user','agent','system')),
  actor_id    uuid,
  task_id     uuid,
  agent_id    uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_project_idx on events (project_id, id);
create index if not exists events_task_idx on events (task_id, id) where task_id is not null;
create index if not exists events_created_idx on events (created_at);

create table if not exists agent_runs (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agents(id) on delete cascade,
  task_id      uuid references tasks(id) on delete set null,
  delivery_id  uuid references deliveries(id) on delete set null,
  status       text not null default 'RUNNING'
               check (status in ('RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer,
  input_chars  integer,
  output_chars integer,
  tokens_in    integer,
  tokens_out   integer,
  error        text,
  summary      text not null default ''
);
create index if not exists agent_runs_agent_idx on agent_runs (agent_id, started_at desc);
create index if not exists agent_runs_task_idx on agent_runs (task_id, started_at desc);

-- ─────────────────────────────────────────────────────────────── permanent memory
create table if not exists project_context (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null check (kind in ('rule','architecture','documentation','glossary','note','result')),
  title       text not null,
  content     text not null,
  pinned      boolean not null default false,
  updated_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists project_context_idx on project_context (project_id, pinned desc, updated_at desc);

create table if not exists decisions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  task_id            uuid references tasks(id) on delete set null,
  title              text not null,
  decision           text not null,
  rationale          text not null default '',
  status             text not null default 'accepted' check (status in ('proposed','accepted','superseded')),
  decided_by_user    uuid references users(id) on delete set null,
  proposed_by_agent  uuid references agents(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists decisions_project_idx on decisions (project_id, created_at desc);

create table if not exists reviews (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  task_id         uuid references tasks(id) on delete cascade,
  reviewer_agent  uuid references agents(id) on delete set null,
  author_agent    uuid references agents(id) on delete set null,
  verdict         text not null check (verdict in ('APPROVED','CHANGES_REQUESTED','COMMENTED')),
  summary         text not null default '',
  findings        jsonb not null default '[]'::jsonb,
  git_commit      text,
  created_at      timestamptz not null default now()
);
create index if not exists reviews_task_idx on reviews (task_id, created_at desc);

create table if not exists git_refs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  task_id      uuid references tasks(id) on delete cascade,
  kind         text not null check (kind in ('branch','commit','pr','issue')),
  ref          text not null,
  title        text not null default '',
  url          text,
  author_agent uuid references agents(id) on delete set null,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create unique index if not exists git_refs_uq on git_refs (project_id, kind, ref, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists git_refs_task_idx on git_refs (task_id, created_at desc);

-- ─────────────────────────────────────────────────────────────── triggers
do $$
declare t text;
begin
  foreach t in array array['users','projects','agents','tasks','project_context'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function acc_touch_updated_at()', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────── RLS lock-down
do $$
declare t text;
begin
  foreach t in array array['users','projects','agents','agent_capabilities','permissions','agent_sessions',
                           'conversations','tasks','task_steps','messages','deliveries','approvals','events',
                           'agent_runs','project_context','decisions','reviews','git_refs'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
