-- Security hardening: pin function search_path so callers cannot influence object resolution.
create or replace function public.acc_gen_random_uuid()
returns uuid
as 'select md5(random()::text || clock_timestamp()::text)::uuid'
language sql volatile
set search_path = pg_catalog;

create or replace function public.acc_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end $$;
