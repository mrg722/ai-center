-- Multi-project support (real, not cosmetic): each moderator has a
-- "current project" that every userRoute request resolves against, instead
-- of the previous hardcoded "first project ever created". Agent/bridge
-- routes are unaffected (an agent token already carries its own project_id).

alter table users add column if not exists current_project_id uuid references projects(id) on delete set null;

-- Existing installs: point every user at the (only, so far) project so
-- behaviour is identical immediately after this migration runs.
update users set current_project_id = (select id from projects order by created_at asc limit 1)
 where current_project_id is null;
