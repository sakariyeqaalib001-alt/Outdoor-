-- =====================================================================================
-- Sogasho Outdoor — database change 20261020150000_access
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261020150000_access.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261020150000') then
    raise exception 'Already applied: 20261020150000_access. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020090000') then
    raise exception 'Apply 20261020090000_auth first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- Phase 4 — Users, roles, permissions and teams (SDD §7, BRD §4, §6.2, D-22, D-29)
--
--  * roles / permissions / role_permissions: the permission matrix is DATA, editable by Super Admin
--    (roles.manage). Each grant has a data scope: own < team < city < all.
--  * user_roles: a user may hold several roles; the widest scope wins.
--  * teams / team_members: a Team Leader supervises the agents in the teams they lead (one team per agent).
--  * cities / branches (T-21): the 4 cities and 16 branches (BRD §6.2.1) are created here because every
--    user is assigned a city and branch; Phase 5 adds the screens to maintain them (and districts).
--  * app.has_permission() and app.in_scope() replace the Phase 2 deny-all stubs.
--  * All changes go through SECURITY DEFINER functions that check the caller's permission in the database;
--    every table records its before/after history (T-13); admin actions are logged in activity_log.

-- ---------------------------------------------------------------------------
-- Cities and branches (read-only reference data until Phase 5)
-- ---------------------------------------------------------------------------
create table public.cities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 2 and 60),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger cities_touch before update on public.cities for each row execute function app.touch_updated();

create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.cities (id),
  name       text not null check (length(btrim(name)) between 2 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (city_id, name)
);
create trigger branches_touch before update on public.branches for each row execute function app.touch_updated();

insert into public.cities (name) values ('Hargeisa'), ('Burco'), ('Borama'), ('Berbera');
insert into public.branches (city_id, name)
select c.id, b.name
from (values
  ('Hargeisa', 'HQ'), ('Hargeisa', 'JJ Yar'), ('Hargeisa', 'Idaacadda'), ('Hargeisa', 'MSG'),
  ('Hargeisa', 'Boqol Jire'), ('Hargeisa', 'Xero-Awr'), ('Hargeisa', 'Guuled'), ('Hargeisa', 'Adna'),
  ('Hargeisa', 'Isha Borama'), ('Hargeisa', 'Star'), ('Hargeisa', 'New Hargeisa'),
  ('Burco', 'Burco Deero'), ('Burco', 'Burco Plaza'),
  ('Borama', 'Shacabka'), ('Borama', 'Suuqa'),
  ('Berbera', 'Xarunta Dhexe')
) as b (city, name)
join public.cities c on c.name = b.city;

-- ---------------------------------------------------------------------------
-- Roles, permissions and the matrix
-- ---------------------------------------------------------------------------
create table public.roles (
  key         text primary key check (key ~ '^[a-z][a-z_]{2,40}$'),
  name        text not null,
  description text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  key         text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  module      text not null,
  description text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role_key       text not null references public.roles (key),
  permission_key text not null references public.permissions (key),
  scope          text not null check (scope in ('own', 'team', 'city', 'all')),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  primary key (role_key, permission_key)
);

create table public.user_roles (
  user_id    uuid not null references public.user_profiles (id),
  role_key   text not null references public.roles (key),
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, role_key)
);
create index user_roles_role_idx on public.user_roles (role_key);

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (length(btrim(name)) between 2 and 80),
  city_id        uuid not null references public.cities (id),
  team_leader_id uuid references public.user_profiles (id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create trigger teams_touch before update on public.teams for each row execute function app.touch_updated();
create index teams_leader_idx on public.teams (team_leader_id);

create table public.team_members (
  user_id    uuid primary key references public.user_profiles (id), -- one team per person (SDD §8.3)
  team_id    uuid not null references public.teams (id),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index team_members_team_idx on public.team_members (team_id);

-- City and branch on every user (D-29).
alter table public.user_profiles
  add column city_id uuid references public.cities (id),
  add column branch_id uuid references public.branches (id);

-- ---------------------------------------------------------------------------
-- Seed: roles (BRD §4) and permissions (SDD §7.1)
-- ---------------------------------------------------------------------------
insert into public.roles (key, name, description, sort_order) values
  ('super_admin',   'Super Admin',            'Full administration; approves refunds and leave; manages users, settings and audit cases.', 1),
  ('team_leader',   'Team Leader / Supervisor','Approves Retention for their team; sees team performance.', 2),
  ('agent',         'Sales Agent',            'Registers sales and holds stock custody (temporary or permanent agent).', 3),
  ('follow_up',     'Follow-up Team',         'Records Active / Expire / Not Reached for customers due for follow-up.', 4),
  ('stock_officer', 'Stock Officer',          'Receives, transfers and returns stock.', 5),
  ('finance',       'Payroll / Finance',      'Calculates, reviews and finalizes payroll.', 6),
  ('auditor',       'Auditor / Management',   'Read-only reports and audit trail; manages audit cases assigned to them.', 7);

insert into public.permissions (key, module, description, sort_order) values
  ('dashboard.read',          'dashboard', 'View the dashboard', 10),
  ('performance.read',        'performance', 'View agent performance and recognition', 20),
  ('targets.read',            'targets', 'View targets and KPIs', 30),
  ('targets.manage',          'targets', 'Assign targets and KPIs', 31),
  ('sales.create',            'sales', 'Register sales', 40),
  ('sales.read',              'sales', 'View sales', 41),
  ('sales.override_city',     'sales', 'Change the city on a sale', 42),
  ('customers.read',          'customers', 'View customer phone and Index Number', 50),
  ('customers.change_identity','customers', 'Change a customer''s phone or Index Number', 51),
  ('retention.review',        'approvals', 'Approve or reject Retention sales', 60),
  ('switches.create',         'switches', 'Register product switches', 70),
  ('refunds.submit',          'refunds', 'Submit refund requests', 80),
  ('refunds.approve',         'refunds', 'Approve or reject refunds', 81),
  ('followup.read',           'followup', 'View the follow-up list', 90),
  ('followup.update',         'followup', 'Record follow-up outcomes', 91),
  ('stock.read',              'stock', 'View stock and custody', 100),
  ('stock.receive',           'stock', 'Record stock receipts', 101),
  ('stock.transfer',          'stock', 'Transfer stock', 102),
  ('stock.acknowledge',       'stock', 'Acknowledge stock transfers received', 103),
  ('stock.adjust.request',    'stock', 'Request stock adjustments', 104),
  ('stock.adjust.approve',    'stock', 'Approve stock adjustments', 105),
  ('audit.read',              'audit', 'View audit events, cases and change history', 110),
  ('audit.manage',            'audit', 'Manage audit cases', 111),
  ('reports.read',            'reports', 'View reports', 120),
  ('reports.export',          'reports', 'Export reports', 121),
  ('payroll.read',            'payroll', 'View payroll', 130),
  ('payroll.calculate',       'payroll', 'Calculate payroll', 131),
  ('payroll.finalize',        'payroll', 'Finalize payroll', 132),
  ('leave.request',           'leave', 'Request leave', 140),
  ('leave.review',            'leave', 'Approve or reject leave', 141),
  ('leave.assign',            'leave', 'Assign annual leave entitlement', 142),
  ('users.read',              'users', 'View users', 150),
  ('users.manage',            'users', 'Create and edit users, reset passwords', 151),
  ('users.disable',           'users', 'Deactivate and reactivate users', 152),
  ('teams.manage',            'users', 'Create teams and assign members', 153),
  ('roles.manage',            'users', 'Edit the role permission matrix', 154),
  ('settings.manage',         'settings', 'Manage settings and master data', 160),
  ('prices.manage',           'settings', 'Manage products and prices', 161),
  ('integrations.manage',     'settings', 'Manage integrations (KoboToolbox sync)', 162);

-- Default matrix (SDD §7.2, D-22). Super Admin: everything, all scopes.
insert into public.role_permissions (role_key, permission_key, scope)
select 'super_admin', key, 'all' from public.permissions;

insert into public.role_permissions (role_key, permission_key, scope) values
  -- Sales agent: own records only
  ('agent', 'dashboard.read', 'own'), ('agent', 'performance.read', 'own'), ('agent', 'targets.read', 'own'),
  ('agent', 'sales.create', 'own'), ('agent', 'sales.read', 'own'), ('agent', 'customers.read', 'own'),
  ('agent', 'switches.create', 'own'), ('agent', 'refunds.submit', 'own'), ('agent', 'stock.read', 'own'),
  ('agent', 'stock.acknowledge', 'own'), ('agent', 'payroll.read', 'own'), ('agent', 'leave.request', 'own'),
  -- Team Leader: own team (approval of own submissions is blocked separately in Phase 8)
  ('team_leader', 'dashboard.read', 'team'), ('team_leader', 'performance.read', 'team'), ('team_leader', 'targets.read', 'team'),
  ('team_leader', 'sales.create', 'own'), ('team_leader', 'sales.read', 'team'), ('team_leader', 'sales.override_city', 'team'),
  ('team_leader', 'customers.read', 'team'), ('team_leader', 'retention.review', 'team'), ('team_leader', 'switches.create', 'team'),
  ('team_leader', 'refunds.submit', 'team'), ('team_leader', 'stock.read', 'team'), ('team_leader', 'stock.acknowledge', 'own'),
  ('team_leader', 'reports.read', 'team'), ('team_leader', 'reports.export', 'team'), ('team_leader', 'users.read', 'team'),
  ('team_leader', 'leave.request', 'own'),
  -- Follow-up Team: the due list only (customer fields limited in Phase 13)
  ('follow_up', 'followup.read', 'all'), ('follow_up', 'followup.update', 'all'), ('follow_up', 'leave.request', 'own'),
  -- Stock Officer
  ('stock_officer', 'dashboard.read', 'all'), ('stock_officer', 'stock.read', 'all'), ('stock_officer', 'stock.receive', 'all'),
  ('stock_officer', 'stock.transfer', 'all'), ('stock_officer', 'stock.adjust.request', 'all'),
  ('stock_officer', 'reports.read', 'all'), ('stock_officer', 'reports.export', 'all'), ('stock_officer', 'leave.request', 'own'),
  -- Payroll / Finance
  ('finance', 'dashboard.read', 'all'), ('finance', 'sales.read', 'all'), ('finance', 'stock.read', 'all'),
  ('finance', 'payroll.read', 'all'), ('finance', 'payroll.calculate', 'all'), ('finance', 'payroll.finalize', 'all'),
  ('finance', 'reports.read', 'all'), ('finance', 'reports.export', 'all'), ('finance', 'leave.request', 'own'),
  -- Auditor / Management (audit.manage = cases assigned to them, Phase 9)
  ('auditor', 'dashboard.read', 'all'), ('auditor', 'performance.read', 'all'), ('auditor', 'targets.read', 'all'),
  ('auditor', 'sales.read', 'all'), ('auditor', 'customers.read', 'all'), ('auditor', 'stock.read', 'all'),
  ('auditor', 'audit.read', 'all'), ('auditor', 'audit.manage', 'own'), ('auditor', 'reports.read', 'all'),
  ('auditor', 'reports.export', 'all'), ('auditor', 'payroll.read', 'all'), ('auditor', 'users.read', 'all'),
  ('auditor', 'leave.request', 'own');

-- ---------------------------------------------------------------------------
-- Permission helpers — replace the Phase 2 stubs
-- ---------------------------------------------------------------------------
create or replace function app.scope_rank(p_scope text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_scope when 'own' then 1 when 'team' then 2 when 'city' then 3 when 'all' then 4 else 0 end
$$;

-- Widest scope the caller holds for a permission (null = none). Inactive users hold nothing.
create or replace function app.permission_scope(p_permission text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.is_active_user() then (
    select rp.scope
    from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = auth.uid() and rp.permission_key = p_permission
    order by app.scope_rank(rp.scope) desc
    limit 1)
  end
$$;

create or replace function app.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.permission_scope(permission_key) is not null
$$;
comment on function app.has_permission(text) is 'True when the active caller holds the permission at any scope (Phase 4).';

-- Is the record owned by p_owner inside the caller's scope for p_permission?
--   all: any record · city: owner in the caller's city · team: owner is the caller or in a team the caller leads
--   own: owner is the caller.
drop function if exists app.in_scope(uuid, uuid, uuid);
create or replace function app.in_scope(p_permission text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case app.permission_scope(p_permission)
    when 'all' then true
    when 'city' then p_owner = auth.uid() or exists (
      select 1 from public.user_profiles me, public.user_profiles o
      where me.id = auth.uid() and o.id = p_owner and me.city_id is not null and o.city_id = me.city_id)
    when 'team' then p_owner = auth.uid() or exists (
      select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
      where tm.user_id = p_owner and t.team_leader_id = auth.uid() and t.is_active)
    when 'own' then p_owner = auth.uid()
    else false
  end
$$;
comment on function app.in_scope(text, uuid) is 'True when a record owned by p_owner is within the caller''s scope for the permission.';

create or replace function app.is_super_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role_key = 'super_admin')
$$;

create or replace function app.active_super_admin_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active
$$;

revoke execute on function app.scope_rank(text) from public;
revoke execute on function app.permission_scope(text) from public;
revoke execute on function app.in_scope(text, uuid) from public;
revoke execute on function app.is_super_admin(uuid) from public;
revoke execute on function app.active_super_admin_count() from public;
grant execute on function app.scope_rank(text), app.permission_scope(text), app.in_scope(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: reads
-- ---------------------------------------------------------------------------
alter table public.cities enable row level security;
alter table public.branches enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

revoke all on public.cities, public.branches, public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.teams, public.team_members from anon, authenticated;
grant select on public.cities, public.branches, public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.teams, public.team_members to authenticated;

-- Reference data: every active user (forms need the lists).
create policy cities_read on public.cities for select to authenticated using (app.is_active_user());
create policy branches_read on public.branches for select to authenticated using (app.is_active_user());
create policy roles_read on public.roles for select to authenticated using (app.is_active_user());
create policy permissions_read on public.permissions for select to authenticated using (app.is_active_user());
create policy role_permissions_read on public.role_permissions for select to authenticated using (app.is_active_user());
create policy teams_read on public.teams for select to authenticated using (app.is_active_user());

-- Who has which role / team: yourself, or users within your users.read scope.
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.in_scope('users.read', user_id));
create policy team_members_read on public.team_members for select to authenticated
  using (user_id = auth.uid() or app.in_scope('users.read', user_id));

-- Profiles: replace "own only" with own + users.read scope.
drop policy user_profiles_read_own on public.user_profiles;
create policy user_profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or app.in_scope('users.read', id));

select app.enable_change_log('public.cities');
select app.enable_change_log('public.branches');
select app.enable_change_log('public.roles', 'key');
select app.enable_change_log('public.permissions', 'key');
select app.enable_change_log('public.role_permissions', 'role_key');
select app.enable_change_log('public.user_roles', 'user_id');
select app.enable_change_log('public.teams');
select app.enable_change_log('public.team_members', 'user_id');

-- ---------------------------------------------------------------------------
-- API functions (each checks the caller's permission inside the database)
-- ---------------------------------------------------------------------------

-- The caller's roles and permissions (for menus and screens; enforcement stays in the database).
create or replace function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                       from public.user_roles ur join public.roles r on r.key = ur.role_key
                       where ur.user_id = auth.uid() and app.is_active_user()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_object_agg(p.key, app.permission_scope(p.key))
                             from public.permissions p
                             where app.permission_scope(p.key) is not null), '{}'::jsonb))
$$;

-- Server-side check helper.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_permission(p_permission)
$$;

-- Edit a user's name, city, branch, start date, roles and team (users.manage).
create or replace function public.admin_update_user(
  p_user uuid,
  p_full_name text,
  p_city uuid,
  p_branch uuid,
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
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and city_id = p_city) then
    raise exception 'BRANCH_NOT_IN_CITY';
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
     set full_name = btrim(p_full_name), city_id = p_city, branch_id = p_branch,
         start_date = coalesce(p_start_date, start_date)
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

-- Deactivate / reactivate (users.disable). The server also bans / unbans the Supabase Auth user.
create or replace function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('users.disable') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() and not p_active then
    raise exception 'CANNOT_DEACTIVATE_SELF';
  end if;
  if not p_active and app.is_super_admin(p_user) and app.active_super_admin_count() <= 1 then
    raise exception 'LAST_SUPER_ADMIN';
  end if;
  update public.user_profiles
     set is_active = p_active,
         end_date = case when p_active then null else (now() at time zone 'Africa/Mogadishu')::date end
   where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  perform app.log_activity(case when p_active then 'users.reactivate' else 'users.deactivate' end, 'user_profiles', p_user);
end;
$$;

-- After a password reset by Super Admin: force a new password at next sign-in (users.manage).
create or replace function public.admin_require_password_change(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('users.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.user_profiles set must_change_password = true where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  perform app.log_activity('users.password_reset', 'user_profiles', p_user);
end;
$$;

-- Create or update a team (teams.manage). The Team Leader must hold the team_leader role.
create or replace function public.admin_save_team(p_id uuid, p_name text, p_city uuid, p_leader uuid, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('teams.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_leader is not null and not exists (select 1 from public.user_roles where user_id = p_leader and role_key = 'team_leader') then
    raise exception 'LEADER_NEEDS_TEAM_LEADER_ROLE';
  end if;
  if p_id is null then
    insert into public.teams (name, city_id, team_leader_id, is_active, created_by)
    values (btrim(p_name), p_city, p_leader, coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform app.log_activity('teams.create', 'teams', v_id);
  else
    update public.teams set name = btrim(p_name), city_id = p_city, team_leader_id = p_leader, is_active = coalesce(p_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'TEAM_NOT_FOUND'; end if;
    perform app.log_activity('teams.update', 'teams', v_id);
  end if;
  return v_id;
end;
$$;

-- Edit the permission matrix (roles.manage). p_scope null removes the grant. Super Admin's row is locked.
create or replace function public.admin_set_role_permission(p_role text, p_permission text, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('roles.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'super_admin' then
    raise exception 'SUPER_ADMIN_LOCKED';
  end if;
  if p_scope is null then
    delete from public.role_permissions where role_key = p_role and permission_key = p_permission;
  else
    insert into public.role_permissions (role_key, permission_key, scope, created_by)
    values (p_role, p_permission, p_scope, auth.uid())
    on conflict (role_key, permission_key) do update set scope = excluded.scope, created_by = excluded.created_by;
  end if;
  perform app.log_activity('roles.permission_set', null, null,
    jsonb_build_object('role', p_role, 'permission', p_permission, 'scope', p_scope));
end;
$$;

-- One-time bootstrap from the Supabase SQL Editor (table owner only): make the first Super Admin.
-- Refuses once any Super Admin exists. Not callable through the API.
create or replace function app.bootstrap_super_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.user_roles where role_key = 'super_admin') then
    raise exception 'A Super Admin already exists. Use the Users screen to grant the role.';
  end if;
  select id into v_user from public.user_profiles where email = lower(btrim(p_email)) and employment_type = 'permanent';
  if v_user is null then
    raise exception 'No permanent user with email %', p_email;
  end if;
  insert into public.user_roles (user_id, role_key) values (v_user, 'super_admin');
  perform app.log_security_event('users.bootstrap_super_admin', v_user);
  return 'Super Admin granted to ' || lower(btrim(p_email));
end;
$$;
revoke execute on function app.bootstrap_super_admin(text) from public, anon, authenticated, service_role;

revoke execute on function public.my_access() from public, anon, authenticated, service_role;
revoke execute on function public.has_permission(text) from public, anon, authenticated, service_role;
revoke execute on function public.admin_update_user(uuid, text, uuid, uuid, date, text[], uuid) from public, anon, authenticated, service_role;
revoke execute on function public.admin_set_user_active(uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_require_password_change(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_team(uuid, text, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_set_role_permission(text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.my_access() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, uuid, uuid, date, text[], uuid) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_require_password_change(uuid) to authenticated;
grant execute on function public.admin_save_team(uuid, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_set_role_permission(text, text, text) to authenticated;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261020150000', 'access');

commit;

select 'Applied 20261020150000_access successfully' as result;
