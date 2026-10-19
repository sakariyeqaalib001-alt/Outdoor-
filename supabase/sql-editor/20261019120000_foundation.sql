-- =====================================================================================
-- Sogasho Outdoor — database change 20261019120000_foundation
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261019120000_foundation.sql — do not edit; run "npm run db:sql-editor".
-- =====================================================================================
begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);

do $sogasho_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261019120000') then
    raise exception 'Already applied: 20261019120000_foundation. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- Phase 2 — Database foundation (SDD §8.1, §7.3, §8.3, §20)
-- Conventions, the private `app` schema with RLS helper functions, `app_settings`,
-- and the two insert-only logs (`activity_log`, `audit_events`).
-- No business tables here: users arrive in Phase 3/4, master data in Phase 5, stock in 6, sales in 7.

-- ---------------------------------------------------------------------------
-- Private helper schema (not exposed through the Data API; config.toml exposes only `public`)
-- ---------------------------------------------------------------------------
create schema if not exists app;
comment on schema app is 'Private helpers for RLS policies and business rules. Never exposed through the API.';

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Functions are executable by PUBLIC by default; remove that for everything this project creates.
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Business time (D-24, D-30): East Africa Time, UTC+3, no daylight saving.
-- Declared IMMUTABLE so later phases can use it in generated columns (e.g. sales.sale_month);
-- safe because EAT has a fixed offset.
-- ---------------------------------------------------------------------------
create or replace function app.business_month(ts timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select date_trunc('month', ts at time zone 'Africa/Mogadishu')::date
$$;
comment on function app.business_month(timestamptz) is
  'First day of the business month (EAT, UTC+3) containing ts. Sale month is always derived from server time (D-30).';

-- ---------------------------------------------------------------------------
-- Session helpers for RLS
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;
comment on function app.current_user_id() is 'Authenticated user id from the JWT (null for anonymous requests).';

-- Phase 2 stub: any authenticated session counts as active.
-- Phase 3/4 replaces the body to also require user_profiles.is_active (SDD §6.3).
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
$$;
comment on function app.is_active_user() is
  'True when the caller is signed in and active. STUB until Phase 4: checks only that a user is signed in.';

-- Phase 2 stub: deny every permission until the permission model exists (Phase 4, SDD §7).
create or replace function app.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;
comment on function app.has_permission(text) is
  'True when the caller holds the permission key. STUB until Phase 4: always false (deny by default).';

-- Phase 2 stub: deny every data scope until users, teams and cities exist (Phase 4, SDD §7.3).
create or replace function app.in_scope(owner_id uuid, team_id uuid default null, city_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;
comment on function app.in_scope(uuid, uuid, uuid) is
  'True when the record (owner/team/city) is inside the caller''s data scope. STUB until Phase 4: always false.';

grant execute on function app.business_month(timestamptz) to authenticated, service_role;
grant execute on function app.current_user_id() to authenticated, service_role;
grant execute on function app.is_active_user() to authenticated, service_role;
grant execute on function app.has_permission(text) to authenticated, service_role;
grant execute on function app.in_scope(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at / updated_by current on mutable tables
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared trigger: append-only tables (SDD §8.1, §8.4). Blocks UPDATE, DELETE and TRUNCATE
-- for every role, including the table owner and service_role.
-- ---------------------------------------------------------------------------
create or replace function app.prevent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- app_settings — configurable business values (values are added in Phase 5)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value       jsonb not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on table public.app_settings is
  'Business settings edited by Super Admin (payroll cutoff, incentive, base salary, bands, free-month amount…). Values arrive in Phase 5.';

create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function app.touch_updated();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;

create policy app_settings_read on public.app_settings
  for select to authenticated
  using (app.is_active_user());
-- No insert/update/delete policies yet: settings management arrives in Phase 5 (settings.manage).

-- ---------------------------------------------------------------------------
-- activity_log — who did what and when, for sensitive actions (SDD §20). Insert-only.
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  action      text not null check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  entity_type text check (entity_type is null or entity_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
comment on table public.activity_log is
  'Append-only history of sensitive actions. details holds a safe subset only — never passwords, OTPs, tokens or secrets.';

create index activity_log_occurred_at_idx on public.activity_log (occurred_at desc);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id);
create index activity_log_actor_idx on public.activity_log (actor_id, occurred_at desc);

create trigger activity_log_no_update_delete
  before update or delete on public.activity_log
  for each row execute function app.prevent_change();
create trigger activity_log_no_truncate
  before truncate on public.activity_log
  for each statement execute function app.prevent_change();

alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated, service_role;
grant select, insert on public.activity_log to service_role;
grant select on public.activity_log to authenticated;

create policy activity_log_read on public.activity_log
  for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
-- No insert policy for authenticated: rows are written only through app.log_activity().

-- ---------------------------------------------------------------------------
-- audit_events — durable rule hits such as duplicate attempts (SDD §11.1). Insert-only.
-- Written through app.record_audit_event() so the event commits even when the business
-- operation that triggered it is rejected (the caller returns a result instead of raising).
-- Cases and links arrive in Phase 9 as separate tables; events are never edited.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id                  uuid primary key default gen_random_uuid(),
  occurred_at         timestamptz not null default now(),
  rule_code           text not null check (rule_code ~ '^[A-Z][A-Z0-9_]{2,62}$'),
  severity            text not null default 'medium' check (severity in ('info', 'low', 'medium', 'high')),
  actor_id            uuid,
  attempted_values    jsonb not null default '{}'::jsonb check (jsonb_typeof(attempted_values) = 'object'),
  matched_entity_type text check (matched_entity_type is null or matched_entity_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  matched_entity_id   uuid,
  context             jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object')
);
comment on table public.audit_events is
  'Append-only rule hits (e.g. DUP_PHONE). A risk indicator, not proof of fraud (FR-AUD-06).';

create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc);
create index audit_events_rule_idx on public.audit_events (rule_code, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index audit_events_matched_idx on public.audit_events (matched_entity_type, matched_entity_id);

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function app.prevent_change();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app.prevent_change();

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated, service_role;
grant select, insert on public.audit_events to service_role;
grant select on public.audit_events to authenticated;

create policy audit_events_read on public.audit_events
  for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
-- No insert policy for authenticated: rows are written only through app.record_audit_event().

-- ---------------------------------------------------------------------------
-- Writers (SECURITY DEFINER): the actor is always taken from the session, never from the caller.
-- ---------------------------------------------------------------------------
create or replace function app.log_activity(
  p_action      text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_details     jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_active_user() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function app.log_activity(text, text, uuid, jsonb) is
  'Append an activity_log row for the current user. Never pass secrets in p_details.';

create or replace function app.record_audit_event(
  p_rule_code           text,
  p_severity            text default 'medium',
  p_attempted_values    jsonb default '{}'::jsonb,
  p_matched_entity_type text default null,
  p_matched_entity_id   uuid default null,
  p_context             jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_active_user() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_events
    (rule_code, severity, actor_id, attempted_values, matched_entity_type, matched_entity_id, context)
  values
    (p_rule_code, coalesce(p_severity, 'medium'), auth.uid(), coalesce(p_attempted_values, '{}'::jsonb),
     p_matched_entity_type, p_matched_entity_id, coalesce(p_context, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function app.record_audit_event(text, text, jsonb, text, uuid, jsonb) is
  'Append an audit_events row for the current user. Call it and RETURN (do not RAISE) so the event commits (SDD §11.1).';

revoke execute on function app.touch_updated() from public;
revoke execute on function app.prevent_change() from public;
revoke execute on function app.log_activity(text, text, uuid, jsonb) from public;
revoke execute on function app.record_audit_event(text, text, jsonb, text, uuid, jsonb) from public;
grant execute on function app.log_activity(text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function app.record_audit_event(text, text, jsonb, text, uuid, jsonb) to authenticated, service_role;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261019120000', 'foundation');

commit;

select 'Applied 20261019120000_foundation successfully' as result;
