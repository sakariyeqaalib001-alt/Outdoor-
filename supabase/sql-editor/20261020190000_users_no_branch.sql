-- =====================================================================================
-- Sogasho Outdoor — database change 20261020190000_users_no_branch
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261020190000_users_no_branch.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261020190000') then
    raise exception 'Already applied: 20261020190000_users_no_branch. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020150000') then
    raise exception 'Apply 20261020150000_access first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- Phase 4 correction (D-31, owner clarification 20 Oct 2026):
-- Outdoor agents belong to the Outdoor Department, not to a branch. Branches are where the money
-- collected from customers is handed in, chosen on each sale (Phase 7). So a user has a city and a
-- team, but no branch. Branch records themselves stay (they are used by sales).

drop function if exists public.admin_update_user(uuid, text, uuid, uuid, date, text[], uuid);

alter table public.user_profiles drop column if exists branch_id;

-- Edit a user's name, city, start date, roles and team (users.manage).
create or replace function public.admin_update_user(
  p_user uuid,
  p_full_name text,
  p_city uuid,
  p_start_date date,
  p_roles text[],
  p_team uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if not app.has_permission('users.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_user) then
    raise exception 'USER_NOT_FOUND';
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and city_id = p_city) then
    raise exception 'TEAM_NOT_IN_CITY';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'ROLE_REQUIRED';
  end if;
  if exists (select 1 from unnest(p_roles) r where r not in (select key from public.roles)) then
    raise exception 'UNKNOWN_ROLE';
  end if;
  -- Never leave the system without an active Super Admin, and never remove your own Super Admin role.
  if app.is_super_admin(p_user) and not ('super_admin' = any (p_roles)) then
    if p_user = auth.uid() then raise exception 'CANNOT_REMOVE_OWN_SUPER_ADMIN'; end if;
    if app.active_super_admin_count() <= 1 then raise exception 'LAST_SUPER_ADMIN'; end if;
  end if;

  v_before := jsonb_build_object('roles', (select coalesce(jsonb_agg(role_key order by role_key), '[]') from public.user_roles where user_id = p_user));

  update public.user_profiles
     set full_name = btrim(p_full_name), city_id = p_city, start_date = coalesce(p_start_date, start_date)
   where id = p_user;

  delete from public.user_roles where user_id = p_user and not (role_key = any (p_roles));
  insert into public.user_roles (user_id, role_key, created_by)
  select p_user, r, auth.uid() from unnest(p_roles) r
  on conflict do nothing;

  if p_team is null then
    delete from public.team_members where user_id = p_user;
  else
    insert into public.team_members (user_id, team_id, created_by) values (p_user, p_team, auth.uid())
    on conflict (user_id) do update set team_id = excluded.team_id, created_by = excluded.created_by, created_at = now();
  end if;

  perform app.log_activity('users.update', 'user_profiles', p_user,
    jsonb_build_object('roles_before', v_before -> 'roles', 'roles_after', to_jsonb(p_roles), 'team', p_team));
end;
$$;

revoke execute on function public.admin_update_user(uuid, text, uuid, date, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_user(uuid, text, uuid, date, text[], uuid) to authenticated;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261020190000', 'users_no_branch');

commit;

select 'Applied 20261020190000_users_no_branch successfully' as result;
