create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repository_full_name text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default now()
);

create table if not exists agents (
  id text primary key,
  name text not null,
  role text not null,
  connection_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists permissions (
  agent_id text primary key references agents(id) on delete cascade,
  can_read boolean not null default true,
  can_write boolean not null default false,
  can_commit boolean not null default false,
  can_push boolean not null default false,
  can_merge boolean not null default false,
  dangerous_operations boolean not null default false
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  priority text not null default 'NORMAL',
  status text not null default 'OPEN',
  created_by uuid,
  assigned_agent text references agents(id),
  current_branch text,
  current_commit text,
  context_summary text,
  parent_task_id uuid references tasks(id),
  requires_human_approval boolean not null default false,
  next_agent text references agents(id),
  created_files jsonb not null default '[]'::jsonb,
  modified_files jsonb not null default '[]'::jsonb,
  related_commits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_project_status on tasks(project_id, status);
create index if not exists idx_tasks_assigned_agent on tasks(assigned_agent, status);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  from_agent text,
  to_agent text,
  message_type text not null,
  content text not null,
  reply_to uuid references messages(id),
  priority text not null default 'NORMAL',
  requires_action boolean not null default false,
  requires_approval boolean not null default false,
  git_branch text,
  git_commit text,
  files jsonb not null default '[]'::jsonb,
  status text not null default 'DELIVERED',
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_task_created on messages(task_id, created_at);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  action text not null,
  requested_by text,
  status text not null default 'PENDING',
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  session_key text not null unique,
  status text not null default 'ONLINE',
  last_heartbeat_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists project_context (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope text not null,
  key text not null,
  value text not null,
  importance integer not null default 50,
  updated_at timestamptz not null default now(),
  unique(project_id, scope, key)
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  decision text not null,
  rationale text not null default '',
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  reviewer_agent text not null references agents(id),
  result text not null,
  findings jsonb not null default '[]'::jsonb,
  approved boolean,
  created_at timestamptz not null default now()
);

create table if not exists git_refs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  branch text not null,
  commit_sha text,
  pr_number integer,
  status text,
  updated_at timestamptz not null default now(),
  unique(project_id, branch)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into agents (id, name, role, connection_type) values
('claude', 'Claude', 'PRIMARY_BUILDER', 'LOCAL'),
('codex', 'GPT / Codex', 'AUDITOR_INTEGRATOR', 'LOCAL'),
('gemini', 'Gemini', 'RESEARCHER_SECOND_OPINION', 'CLOUD_OR_LOCAL')
on conflict (id) do nothing;

insert into permissions (agent_id, can_read, can_write, can_commit, can_push, can_merge, dangerous_operations) values
('claude', true, true, true, false, false, false),
('codex', true, true, true, true, false, false),
('gemini', true, false, false, false, false, false)
on conflict (agent_id) do nothing;
