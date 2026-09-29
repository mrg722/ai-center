-- Security Lab (Bloque 9) — Strix pentesting via the Local Bridge only, never
-- from Vercel/hosted infra. An `engagement` is the authorization record for a
-- target (self-owned repo or a third party with attached evidence); a
-- `security_run` may only target something covered by an ACTIVE engagement —
-- that check happens in application code (src/server/security/store.ts), this
-- schema just stores the records it checks.

create table if not exists engagements (
  id                    uuid primary key default acc_gen_random_uuid(),
  project_id            uuid not null references projects(id) on delete cascade,
  target                text not null,                 -- repo (owner/name), URL, or host
  target_type           text not null default 'repo' check (target_type in ('repo','url','host')),
  scope_notes           text not null default '',       -- what's in/out of scope
  authorization_evidence text not null default '',      -- link/description of written authorization (self-owned targets may state so explicitly)
  authorized_by         text not null default '',       -- name/role of whoever authorized it
  status                text not null default 'draft' check (status in ('draft','active','expired','revoked')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  created_by            uuid references users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists engagements_project_idx on engagements (project_id, status);

create table if not exists security_runs (
  id                uuid primary key default acc_gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  engagement_id     uuid not null references engagements(id) on delete cascade,
  target            text not null,                     -- denormalized copy of engagements.target at run time
  scan_mode         text not null default 'standard' check (scan_mode in ('quick','standard','deep')),
  status            text not null default 'queued' check (status in ('queued','running','completed','failed','stopped')),
  bridge_run_name   text,                                -- Strix's own `strix_runs/<run-name>` identifier, once started
  summary           text not null default '',
  error             text not null default '',
  requested_by      uuid references users(id) on delete set null,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists security_runs_project_idx on security_runs (project_id, created_at desc);
create index if not exists security_runs_engagement_idx on security_runs (engagement_id);

create table if not exists findings (
  id                uuid primary key default acc_gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  security_run_id   uuid not null references security_runs(id) on delete cascade,
  title             text not null,
  severity          text not null default 'info' check (severity in ('info','low','medium','high','critical')),
  description       text not null default '',
  evidence          text not null default '',
  location          text not null default '',           -- file/endpoint/URL the finding applies to
  status            text not null default 'open' check (status in ('open','confirmed','false_positive','fixed')),
  raw               jsonb not null default '{}'::jsonb,  -- Strix's own finding payload, kept as-is (undocumented/best-effort schema)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists findings_project_idx on findings (project_id, status);
create index if not exists findings_run_idx on findings (security_run_id);

do $$
begin
  execute 'drop trigger if exists engagements_touch on engagements';
  execute 'create trigger engagements_touch before update on engagements for each row execute function acc_touch_updated_at()';
  execute 'drop trigger if exists security_runs_touch on security_runs';
  execute 'create trigger security_runs_touch before update on security_runs for each row execute function acc_touch_updated_at()';
  execute 'drop trigger if exists findings_touch on findings';
  execute 'create trigger findings_touch before update on findings for each row execute function acc_touch_updated_at()';
end $$;

do $$
declare t text;
begin
  foreach t in array array['engagements','security_runs','findings'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
