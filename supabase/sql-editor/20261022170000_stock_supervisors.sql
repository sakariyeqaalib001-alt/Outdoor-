-- =====================================================================================
-- Sogasho Outdoor — database change 20261022170000_stock_supervisors
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261022170000_stock_supervisors.sql — do not edit; run "npm run db:sql-editor".
-- =====================================================================================
begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
-- Bookkeeping table only; not exposed by the API. RLS on, no policies: API roles see nothing,
-- the Supabase CLI (table owner) is unaffected. Also avoids the SQL Editor RLS warning.
alter table supabase_migrations.schema_migrations enable row level security;

do $sogasho_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022170000') then
    raise exception 'Already applied: 20261022170000_stock_supervisors. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022150000') then
    raise exception 'Apply 20261022150000_stock first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- Phase 6 addition (owner, 22 Oct 2026): stock is issued to an Outdoor Supervisor (the Team Leader of a
-- team), not to "a team". The Stock Officer has no right to read the user list, so this function returns
-- only what stock work needs: each active team with its Supervisor's name.

create or replace function public.stock_supervisors()
returns table (team_id uuid, team_name text, location_id uuid, supervisor_id uuid, supervisor_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, l.id, t.team_leader_id, p.full_name
  from public.teams t
  join public.stock_locations l on l.team_id = t.id
  left join public.user_profiles p on p.id = t.team_leader_id
  where t.is_active
    -- Stock Officers see every Supervisor; others only the teams whose stock they may read.
    and (app.has_permission('stock.receive') or app.has_permission('stock.transfer') or app.can_read_location(l.id))
  order by p.full_name nulls last, t.name
$$;

revoke execute on function public.stock_supervisors() from public, anon, authenticated, service_role;
grant execute on function public.stock_supervisors() to authenticated;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261022170000', 'stock_supervisors');

commit;

select 'Applied 20261022170000_stock_supervisors successfully' as result;
