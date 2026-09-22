-- ACC finalization migration
-- Safe for existing production databases. Keeps provider sessions across bridge reconnects
-- and moves the seeded Gemini agent to account-authenticated Google Antigravity.

alter table agent_sessions add column if not exists provider_session_id text;
create index if not exists agent_sessions_provider_session_idx
  on agent_sessions (agent_id, provider_session_id)
  where provider_session_id is not null;

update agents
   set runtime='antigravity', transport='local-bridge'
 where slug='gemini'
   and runtime='gemini'
   and transport='http-api';
