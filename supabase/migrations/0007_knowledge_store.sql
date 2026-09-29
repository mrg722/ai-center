-- Knowledge Store (Bloque 6) — reference material, distinct from `memories`
-- (experience/state/decisions) and from `project_context` (moderator-edited
-- rules/docs). A knowledge document is chunked; retrieval works over chunks
-- with a structured/text fallback that needs no embedding provider (Fase 8).

create table if not exists knowledge_documents (
  id            uuid primary key default acc_gen_random_uuid(),
  scope         text not null default 'project' check (scope in ('global','project')),
  project_id    uuid references projects(id) on delete cascade,
  title         text not null,
  source        text not null default 'custom',   -- e.g. 'custom','upload','url','agency-agents','strix'
  path          text,                              -- original file path/URL, if any
  category      text not null default '',
  version       text not null default '1.0.0',
  checksum      text,                              -- sha256 of the full original content, for re-import diffing
  metadata      jsonb not null default '{}'::jsonb,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint knowledge_documents_scope_ref check ((scope = 'global') or (scope = 'project' and project_id is not null))
);
create index if not exists knowledge_documents_project_idx on knowledge_documents (project_id, enabled);
create index if not exists knowledge_documents_category_idx on knowledge_documents (category);

create table if not exists knowledge_chunks (
  id                uuid primary key default acc_gen_random_uuid(),
  document_id       uuid not null references knowledge_documents(id) on delete cascade,
  chunk_index       integer not null,
  content           text not null,
  embedding         double precision[],
  embedding_model   text,
  created_at        timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists knowledge_chunks_document_idx on knowledge_chunks (document_id, chunk_index);

do $$
begin
  execute 'drop trigger if exists knowledge_documents_touch on knowledge_documents';
  execute 'create trigger knowledge_documents_touch before update on knowledge_documents for each row execute function acc_touch_updated_at()';
end $$;

do $$
declare t text;
begin
  foreach t in array array['knowledge_documents','knowledge_chunks'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
