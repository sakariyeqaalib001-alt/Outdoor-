-- =====================================================================================
-- Sogasho Outdoor — ALL database changes in order (19), for a NEW empty Supabase project
-- Up to 20261107090000_refunds.
-- HOW TO APPLY: new project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: one transaction (everything or nothing); refuses if the project already has any change.
-- For an existing project use the single files in supabase/sql-editor instead.
-- Generated from supabase/migrations — do not edit; run "npm run db:sql-editor".
-- =====================================================================================
begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
alter table supabase_migrations.schema_migrations enable row level security;

do $sogasho_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations) then
    raise exception 'This project already has database changes. Use the single files in supabase/sql-editor. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ================================ 20261019120000_foundation ================================
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261019120000', 'foundation');

-- ================================ 20261019130000_change_log ================================
-- Phase 2 — Automatic before/after change history for every table (T-13).
-- Like `audit_logs` in the Sogasho stock system, but applied to EVERY business table, not only
-- sensitive ones: each INSERT / UPDATE / DELETE stores who, when, which table and record, and the
-- old and new values. Nobody has to remember to log a change — the database does it.
--
-- Three logs, three purposes:
--   activity_log  — what a person did in the app (e.g. "approved retention"), written by the app
--   audit_events  — rule hits such as duplicate attempts (fraud signals), written by the app
--   change_log    — every data change with before/after values, written automatically by triggers

create table public.change_log (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_role      text not null,
  table_name      text not null,
  record_key      text,
  operation       text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_data        jsonb,
  new_data        jsonb,
  changed_columns text[] not null default '{}'
);
comment on table public.change_log is
  'Append-only before/after history of every change to business tables, written automatically by app.record_change().';

create index change_log_record_idx on public.change_log (table_name, record_key, occurred_at desc);
create index change_log_occurred_at_idx on public.change_log (occurred_at desc);
create index change_log_actor_idx on public.change_log (actor_id, occurred_at desc);

create trigger change_log_no_update_delete
  before update or delete on public.change_log
  for each row execute function app.prevent_change();
create trigger change_log_no_truncate
  before truncate on public.change_log
  for each statement execute function app.prevent_change();

alter table public.change_log enable row level security;
revoke all on public.change_log from anon, authenticated, service_role;
grant select on public.change_log to authenticated, service_role;

create policy change_log_read on public.change_log
  for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
-- No insert policy or grant for any API role: rows are written only by the trigger below.

-- ---------------------------------------------------------------------------
-- Trigger function. Argument 0 = name of the key column (default 'id').
-- Columns listed after it are masked (stored as '***') — for any field that must never be copied.
-- ---------------------------------------------------------------------------
create or replace function app.record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_column text := coalesce(tg_argv[0], 'id');
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed text[] := '{}';
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  i int;
begin
  -- Mask sensitive columns (trigger arguments after the first).
  if tg_nargs > 1 then
    for i in 1 .. tg_nargs - 1 loop
      if v_old ? tg_argv[i] then v_old := jsonb_set(v_old, array[tg_argv[i]], '"***"'); end if;
      if v_new ? tg_argv[i] then v_new := jsonb_set(v_new, array[tg_argv[i]], '"***"'); end if;
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return null; -- nothing actually changed; nothing to record
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(k order by k), '{}') into v_changed from jsonb_object_keys(v_new) k;
  end if;

  insert into public.change_log
    (actor_id, actor_role, table_name, record_key, operation, old_data, new_data, changed_columns)
  values (
    nullif(v_claims ->> 'sub', '')::uuid,
    coalesce(nullif(v_claims ->> 'role', ''), current_user::text),
    tg_table_name,
    coalesce(v_new, v_old) ->> v_key_column,
    tg_op,
    v_old,
    v_new,
    v_changed
  );
  return null;
end;
$$;
comment on function app.record_change() is
  'AFTER row trigger writing before/after values to change_log. Arg 0: key column (default id); further args: columns to mask.';
revoke execute on function app.record_change() from public;

-- ---------------------------------------------------------------------------
-- Helper every later migration calls for each new table:
--   select app.enable_change_log('public.sales');               -- key column "id"
--   select app.enable_change_log('public.app_settings', 'key');  -- other key column
-- tests/db fails if any public table (other than the three logs) is missing this trigger.
-- ---------------------------------------------------------------------------
create or replace function app.enable_change_log(p_table regclass, p_key_column text default 'id', variadic p_masked text[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_args text := array_to_string(
    array(select quote_literal(a) from unnest(array[p_key_column] || p_masked) a), ', ');
begin
  execute format('drop trigger if exists zz_change_log on %s', p_table);
  execute format(
    'create trigger zz_change_log after insert or update or delete on %s for each row execute function app.record_change(%s)',
    p_table, v_args);
end;
$$;
comment on function app.enable_change_log(regclass, text, text[]) is
  'Attach the automatic before/after history trigger (zz_change_log) to a table.';
revoke execute on function app.enable_change_log(regclass, text, text[]) from public;

-- Existing business table from the foundation migration.
select app.enable_change_log('public.app_settings', 'key');

insert into supabase_migrations.schema_migrations (version, name) values ('20261019130000', 'change_log');

-- ================================ 20261020090000_auth ================================
-- Phase 3 — Authentication: user profiles, sign-in lockout, SMS one-time passwords (SDD §6, BRD §6.1)
--
-- Design (DECISIONS T-15..T-18):
--  * Supabase Auth stores passwords. Permanent users sign in with email; temporary agents with phone,
--    which the server maps to an internal address (T-16) — no phone provider needed in Supabase.
--  * OTP is generated and checked in this database (app OTP, T-15); the server only delivers it by SMS.
--    Codes are stored hashed, valid 5 minutes, single use, max 5 tries; max 3 sends per 15 minutes.
--  * A temporary agent's session counts only after OTP is verified for that session (JWT session_id).
--  * app.is_active_user() now requires: profile exists, active, password changed, and OTP done
--    (temporary agents, when OTP is enabled). Every RLS policy built on it inherits these rules.
--  * Lockout: 5 failed sign-ins within 15 minutes lock the identifier for 15 minutes (FR-AUTH-08).
--  * Security events go to activity_log (FR-AUTH-07); every table records before/after history (T-13).

-- ---------------------------------------------------------------------------
-- user_profiles — one row per Supabase Auth user
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id                   uuid primary key references auth.users (id),
  full_name            text not null check (length(btrim(full_name)) between 2 and 120),
  employment_type      text not null check (employment_type in ('temporary', 'permanent')),
  login_phone_e164     text unique check (login_phone_e164 is null or login_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email                text unique check (email is null or email = lower(email)),
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  password_changed_at  timestamptz,
  start_date           date not null default (now() at time zone 'Africa/Mogadishu')::date,
  end_date             date,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  constraint temporary_agents_sign_in_by_phone check (employment_type <> 'temporary' or login_phone_e164 is not null),
  constraint permanent_users_sign_in_by_email check (employment_type <> 'permanent' or email is not null),
  constraint end_after_start check (end_date is null or end_date >= start_date)
);
comment on table public.user_profiles is 'Application profile for each Supabase Auth user (SDD §8.3). Roles, teams and locations arrive in Phase 4.';

create trigger user_profiles_touch
  before update on public.user_profiles
  for each row execute function app.touch_updated();

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;

-- Everyone may read their own profile (needed to show "who am I" even before OTP / password change).
-- Phase 4 adds team / city / all scopes for managers.
create policy user_profiles_read_own on public.user_profiles
  for select to authenticated
  using (id = auth.uid());

select app.enable_change_log('public.user_profiles');

-- Create the profile automatically when an Auth user is created (by the create-user script now,
-- by the Users screen in Phase 4). Metadata: full_name, employment_type, phone_e164.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type text := coalesce(nullif(v_meta ->> 'employment_type', ''), 'permanent');
begin
  insert into public.user_profiles (id, full_name, employment_type, login_phone_e164, email)
  values (
    new.id,
    coalesce(nullif(btrim(v_meta ->> 'full_name'), ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    v_type,
    nullif(v_meta ->> 'phone_e164', ''),
    case when v_type = 'permanent' then lower(new.email) end
  );
  return new;
end;
$$;
revoke execute on function app.handle_new_auth_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Settings helper: OTP for temporary agents is on unless Super Admin turns it off (Phase 5 setting).
-- ---------------------------------------------------------------------------
create or replace function app.otp_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value)::text::boolean from public.app_settings where key = 'otp_enabled'), true)
$$;
revoke execute on function app.otp_required() from public;
grant execute on function app.otp_required() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- OTP challenges and verified sessions
-- ---------------------------------------------------------------------------
create table public.otp_challenges (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_profiles (id),
  session_id          uuid not null,
  code_hash           bytea not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  attempts            int not null default 0 check (attempts between 0 and 5),
  consumed_at         timestamptz,
  delivery_status     text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  provider_message_id text
);
comment on table public.otp_challenges is 'SMS one-time passwords for temporary agents. Codes are stored hashed only (FR-NOT-04).';
create index otp_challenges_user_idx on public.otp_challenges (user_id, created_at desc);

alter table public.otp_challenges enable row level security;
revoke all on public.otp_challenges from anon, authenticated, service_role;
-- No policies: only the SECURITY DEFINER functions below read or write this table.
select app.enable_change_log('public.otp_challenges', 'id', 'code_hash');

create table public.otp_verified_sessions (
  session_id  uuid primary key,
  user_id     uuid not null references public.user_profiles (id),
  verified_at timestamptz not null default now()
);
comment on table public.otp_verified_sessions is 'Sign-in sessions (JWT session_id) that completed SMS OTP.';
alter table public.otp_verified_sessions enable row level security;
revoke all on public.otp_verified_sessions from anon, authenticated, service_role;
select app.enable_change_log('public.otp_verified_sessions', 'session_id');

-- ---------------------------------------------------------------------------
-- Sign-in lockout (identifier stored as a hash, never in plain text)
-- ---------------------------------------------------------------------------
create table public.auth_lockouts (
  identifier_hash text primary key,
  failed_count    int not null default 0,
  window_started  timestamptz not null default now(),
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
comment on table public.auth_lockouts is 'Failed sign-in counters: 5 failures in 15 minutes lock the identifier for 15 minutes (FR-AUTH-08).';
alter table public.auth_lockouts enable row level security;
revoke all on public.auth_lockouts from anon, authenticated, service_role;
select app.enable_change_log('public.auth_lockouts', 'identifier_hash');

create or replace function app.identifier_hash(p_identifier text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(btrim(coalesce(p_identifier, ''))), 'UTF8')), 'hex')
$$;
revoke execute on function app.identifier_hash(text) from public;

-- Internal security-event writer (works for anonymous requests too, unlike app.log_activity).
create or replace function app.log_security_event(p_action text, p_actor uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, case when p_actor is null then null else 'user_profiles' end, p_actor, coalesce(p_details, '{}'::jsonb))
$$;
revoke execute on function app.log_security_event(text, uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- app.is_active_user — replaces the Phase 2 stub (T-12): the single gate every RLS policy uses.
-- ---------------------------------------------------------------------------
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.is_active
      and not p.must_change_password
      and (
        p.employment_type <> 'temporary'
        or not app.otp_required()
        or exists (
          select 1 from public.otp_verified_sessions s
          where s.user_id = p.id
            and s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        )
      )
  )
$$;
comment on function app.is_active_user() is
  'True when the caller is signed in, active, has changed the first-login password and (temporary agents) passed OTP for this session.';

-- ---------------------------------------------------------------------------
-- API functions (public schema = callable through Supabase; each checks its own caller)
-- ---------------------------------------------------------------------------

-- Is this identifier locked? Returns the unlock time, or null. Callable before sign-in.
create or replace function public.auth_lockout_until(p_identifier text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select l.locked_until
  from public.auth_lockouts l
  where l.identifier_hash = app.identifier_hash(p_identifier)
    and l.locked_until > now()
$$;

-- Record a failed sign-in. Returns the unlock time when this failure triggers (or continues) a lock.
create or replace function public.auth_record_failure(p_identifier text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := app.identifier_hash(p_identifier);
  v_row public.auth_lockouts;
begin
  insert into public.auth_lockouts as l (identifier_hash, failed_count, window_started)
  values (v_hash, 1, now())
  on conflict (identifier_hash) do update
    set failed_count   = case when l.window_started < now() - interval '15 minutes' then 1 else l.failed_count + 1 end,
        window_started = case when l.window_started < now() - interval '15 minutes' then now() else l.window_started end,
        updated_at     = now()
  returning * into v_row;

  if v_row.failed_count >= 5 and (v_row.locked_until is null or v_row.locked_until <= now()) then
    update public.auth_lockouts
       set locked_until = now() + interval '15 minutes', failed_count = 0, window_started = now()
     where identifier_hash = v_hash
     returning * into v_row;
    perform app.log_security_event('auth.locked', null, jsonb_build_object('identifier_hash', left(v_hash, 12)));
  end if;

  perform app.log_security_event('auth.sign_in_failed', null, jsonb_build_object('identifier_hash', left(v_hash, 12)));
  return case when v_row.locked_until > now() then v_row.locked_until end;
end;
$$;

-- Record a successful sign-in for the CALLER only: clears their counter and logs the event.
create or replace function public.auth_record_success()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
begin
  select * into v_profile from public.user_profiles where id = auth.uid();
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.auth_lockouts
   where identifier_hash in (app.identifier_hash(v_profile.email), app.identifier_hash(v_profile.login_phone_e164));
  perform app.log_security_event('auth.sign_in', v_profile.id, jsonb_build_object('employment_type', v_profile.employment_type));
end;
$$;

-- Where must the signed-in caller go next? ok | inactive | change_password | otp_required | no_profile
create or replace function public.my_session_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'status', case
         when not p.is_active then 'inactive'
         when p.must_change_password then 'change_password'
         when p.employment_type = 'temporary' and app.otp_required() and not exists (
           select 1 from public.otp_verified_sessions s
           where s.user_id = p.id and s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid)
           then 'otp_required'
         else 'ok' end,
       'full_name', p.full_name,
       'employment_type', p.employment_type,
       'phone_hint', case when p.login_phone_e164 is not null then '••••' || right(p.login_phone_e164, 3) end)
     from public.user_profiles p where p.id = auth.uid()),
    jsonb_build_object('status', 'no_profile'))
$$;

-- First-login password change done (the password itself is changed in Supabase Auth by the caller).
create or replace function public.mark_password_changed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles
     set must_change_password = false, password_changed_at = now()
   where id = auth.uid() and is_active;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform app.log_security_event('auth.password_changed', auth.uid());
end;
$$;

-- Issue an OTP. SERVER ONLY (service_role): the plain code is returned once so the server can send
-- the SMS; it is never stored. Signed-in users cannot call this, so they can never see their own code.
create or replace function public.issue_otp_challenge(p_user_id uuid, p_session_id uuid)
returns table (challenge_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
  v_code text;
  v_id uuid := gen_random_uuid();
begin
  select * into v_profile from public.user_profiles where id = p_user_id;
  if not found or not v_profile.is_active or v_profile.employment_type <> 'temporary' then
    raise exception 'OTP_NOT_ALLOWED' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.otp_challenges c
       where c.user_id = p_user_id and c.created_at > now() - interval '15 minutes') >= 3 then
    perform app.log_security_event('auth.otp_rate_limited', p_user_id);
    raise exception 'OTP_RATE_LIMIT' using errcode = 'P0001';
  end if;

  -- 6 digits from cryptographically strong randomness (gen_random_uuid).
  v_code := lpad((abs(('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 1000000)::text, 6, '0');

  -- Older open challenges for this session stop working.
  update public.otp_challenges set consumed_at = now()
   where user_id = p_user_id and session_id = p_session_id and consumed_at is null;

  insert into public.otp_challenges (id, user_id, session_id, code_hash, expires_at)
  values (v_id, p_user_id, p_session_id, sha256(convert_to(v_id::text || ':' || v_code, 'UTF8')), now() + interval '5 minutes');

  perform app.log_security_event('auth.otp_issued', p_user_id);
  return query select v_id, v_code, now() + interval '5 minutes';
end;
$$;

-- Record whether the SMS went out (SERVER ONLY). Never receives the code.
create or replace function public.record_otp_delivery(p_challenge_id uuid, p_sent boolean, p_provider_message_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  update public.otp_challenges
     set delivery_status = case when p_sent then 'sent' else 'failed' end,
         provider_message_id = left(p_provider_message_id, 120)
   where id = p_challenge_id
   returning user_id into v_user;
  perform app.log_security_event(case when p_sent then 'auth.otp_sent' else 'auth.otp_send_failed' end, v_user);
end;
$$;

-- Verify the caller's latest OTP for THIS session. Returns: ok | invalid | expired | too_many_attempts | no_challenge
create or replace function public.verify_otp(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_challenge public.otp_challenges;
begin
  if auth.uid() is null or v_session is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  select * into v_challenge from public.otp_challenges c
   where c.user_id = auth.uid() and c.session_id = v_session and c.consumed_at is null
   order by c.created_at desc limit 1
   for update;

  if not found then
    return 'no_challenge';
  end if;
  if v_challenge.expires_at <= now() then
    update public.otp_challenges set consumed_at = now() where id = v_challenge.id;
    perform app.log_security_event('auth.otp_expired', auth.uid());
    return 'expired';
  end if;
  if v_challenge.attempts >= 5 then
    update public.otp_challenges set consumed_at = now() where id = v_challenge.id;
    return 'too_many_attempts';
  end if;

  if v_challenge.code_hash = sha256(convert_to(v_challenge.id::text || ':' || coalesce(btrim(p_code), ''), 'UTF8')) then
    update public.otp_challenges set consumed_at = now() where id = v_challenge.id;
    insert into public.otp_verified_sessions (session_id, user_id) values (v_session, auth.uid())
      on conflict (session_id) do nothing;
    perform app.log_security_event('auth.otp_verified', auth.uid());
    return 'ok';
  end if;

  update public.otp_challenges set attempts = attempts + 1 where id = v_challenge.id;
  perform app.log_security_event('auth.otp_failed', auth.uid());
  if v_challenge.attempts + 1 >= 5 then
    update public.otp_challenges set consumed_at = now() where id = v_challenge.id;
    return 'too_many_attempts';
  end if;
  return 'invalid';
end;
$$;

-- Grants: nothing is callable by PUBLIC; each role gets exactly what it needs.
revoke execute on function public.auth_lockout_until(text) from public, anon, authenticated, service_role;
revoke execute on function public.auth_record_failure(text) from public, anon, authenticated, service_role;
revoke execute on function public.auth_record_success() from public, anon, authenticated, service_role;
revoke execute on function public.my_session_status() from public, anon, authenticated, service_role;
revoke execute on function public.mark_password_changed() from public, anon, authenticated, service_role;
revoke execute on function public.issue_otp_challenge(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.record_otp_delivery(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function public.verify_otp(text) from public, anon, authenticated, service_role;

grant execute on function public.auth_lockout_until(text) to anon, authenticated;
grant execute on function public.auth_record_failure(text) to anon, authenticated;
grant execute on function public.auth_record_success() to authenticated;
grant execute on function public.my_session_status() to authenticated;
grant execute on function public.mark_password_changed() to authenticated;
grant execute on function public.verify_otp(text) to authenticated;
grant execute on function public.issue_otp_challenge(uuid, uuid) to service_role;
grant execute on function public.record_otp_delivery(uuid, boolean, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261020090000', 'auth');

-- ================================ 20261020150000_access ================================
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261020150000', 'access');

-- ================================ 20261020190000_users_no_branch ================================
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261020190000', 'users_no_branch');

-- ================================ 20261021090000_otp_for_everyone ================================
-- Phase 4 addition (D-32, owner decision 21 Oct 2026): every user — temporary agents, permanent agents
-- and all staff — receives an SMS code at sign-in. Staff still sign in with email + password; the code
-- goes to the mobile number on their profile. Temporary agents keep signing in with their phone.
--
--  * user_profiles.login_phone_e164 is now "the user's mobile number": the sign-in identifier for
--    temporary agents, and the SMS number for everyone. Unique within each account type, so no two
--    agents share a sign-in number and no two staff share an SMS number.
--  * app.is_active_user() / my_session_status(): OTP for this session is required for everyone
--    (unless Super Admin turns OTP off, Phase 5 setting). A user without a mobile number cannot
--    finish sign-in until one is added.
--  * public.admin_set_user_phone: Users screen (users.manage). app.set_user_phone: SQL Editor only,
--    so the first Super Admin can add their own number once.

-- ---------------------------------------------------------------------------
-- Mobile number: unique per account type
-- ---------------------------------------------------------------------------
alter table public.user_profiles drop constraint if exists user_profiles_login_phone_e164_key;
create unique index user_profiles_phone_per_type on public.user_profiles (employment_type, login_phone_e164);
comment on column public.user_profiles.login_phone_e164 is
  'Mobile number (E.164). Temporary agents sign in with it; every user receives the sign-in SMS code on it (D-32).';

-- ---------------------------------------------------------------------------
-- The gate: OTP for every user
-- ---------------------------------------------------------------------------
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.is_active
      and not p.must_change_password
      and (
        not app.otp_required()
        or exists (
          select 1 from public.otp_verified_sessions s
          where s.user_id = p.id
            and s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        )
      )
  )
$$;
comment on function app.is_active_user() is
  'True when the caller is signed in, active, has changed the first-login password and passed the SMS code for this session (D-32).';

create or replace function public.my_session_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'status', case
         when not p.is_active then 'inactive'
         when p.must_change_password then 'change_password'
         when app.otp_required() and not exists (
           select 1 from public.otp_verified_sessions s
           where s.user_id = p.id and s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid)
           then 'otp_required'
         else 'ok' end,
       'full_name', p.full_name,
       'employment_type', p.employment_type,
       'phone_hint', case when p.login_phone_e164 is not null then '••••' || right(p.login_phone_e164, 3) end)
     from public.user_profiles p where p.id = auth.uid()),
    jsonb_build_object('status', 'no_profile'))
$$;

-- Issue an OTP (SERVER ONLY, unchanged otherwise): now for any active user with a mobile number.
create or replace function public.issue_otp_challenge(p_user_id uuid, p_session_id uuid)
returns table (challenge_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
  v_code text;
  v_id uuid := gen_random_uuid();
begin
  select * into v_profile from public.user_profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    raise exception 'OTP_NOT_ALLOWED' using errcode = 'insufficient_privilege';
  end if;
  if v_profile.login_phone_e164 is null then
    raise exception 'NO_PHONE' using errcode = 'P0001';
  end if;
  if (select count(*) from public.otp_challenges c
       where c.user_id = p_user_id and c.created_at > now() - interval '15 minutes') >= 3 then
    perform app.log_security_event('auth.otp_rate_limited', p_user_id);
    raise exception 'OTP_RATE_LIMIT' using errcode = 'P0001';
  end if;

  -- 6 digits from cryptographically strong randomness (gen_random_uuid).
  v_code := lpad((abs(('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 1000000)::text, 6, '0');

  -- Older open challenges for this session stop working.
  update public.otp_challenges set consumed_at = now()
   where user_id = p_user_id and session_id = p_session_id and consumed_at is null;

  insert into public.otp_challenges (id, user_id, session_id, code_hash, expires_at)
  values (v_id, p_user_id, p_session_id, sha256(convert_to(v_id::text || ':' || v_code, 'UTF8')), now() + interval '5 minutes');

  perform app.log_security_event('auth.otp_issued', p_user_id);
  return query select v_id, v_code, now() + interval '5 minutes';
end;
$$;

comment on table public.otp_challenges is 'SMS one-time passwords for every user at sign-in (D-32). Codes are stored hashed only (FR-NOT-04).';

-- ---------------------------------------------------------------------------
-- Setting a user's mobile number
-- ---------------------------------------------------------------------------
-- "063 412 3456", "0634123456", "252634123456" or "+252634123456" → "+252634123456"; null if not valid.
create or replace function app.normalize_phone(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~ '^\+252[1-9][0-9]{6,8}$' then v
    when v ~ '^00252[1-9][0-9]{6,8}$' then '+' || substr(v, 3)
    when v ~ '^252[1-9][0-9]{6,8}$' then '+' || v
    when v ~ '^0[1-9][0-9]{6,8}$' then '+252' || substr(v, 2)
    when v ~ '^[1-9][0-9]{6,8}$' then '+252' || v
  end
  from (select regexp_replace(coalesce(p_input, ''), '[\s\-().]', '', 'g') as v) s
$$;
revoke execute on function app.normalize_phone(text) from public;

-- Users screen (users.manage). Returns the previous number so the server can undo the database change
-- if updating a temporary agent's sign-in account fails. The number itself is never written to the
-- activity log.
create or replace function public.admin_set_user_phone(p_user uuid, p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := app.normalize_phone(p_phone);
  v_old text;
  v_type text;
begin
  if not app.has_permission('users.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select login_phone_e164, employment_type into v_old, v_type from public.user_profiles where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_phone is null then raise exception 'PHONE_REQUIRED'; end if;
  if v_phone is not distinct from v_old then return v_old; end if;
  if exists (select 1 from public.user_profiles where employment_type = v_type and login_phone_e164 = v_phone and id <> p_user) then
    raise exception 'PHONE_TAKEN';
  end if;
  update public.user_profiles set login_phone_e164 = v_phone where id = p_user;
  perform app.log_activity('users.phone_changed', 'user_profiles', p_user);
  return v_old;
end;
$$;

-- SQL Editor only (no API role may call it): add a staff member's mobile number by email — needed once
-- for the first Super Admin, who must receive a code before they can use the Users screen.
create or replace function app.set_user_phone(p_email text, p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_phone text := app.normalize_phone(p_phone);
begin
  select id into v_user from public.user_profiles where email = lower(btrim(p_email)) and employment_type = 'permanent';
  if v_user is null then
    raise exception 'No permanent user with email %', p_email;
  end if;
  if v_phone is null then
    raise exception 'Not a valid Somaliland mobile number. Example: 063 412 3456';
  end if;
  if exists (select 1 from public.user_profiles where employment_type = 'permanent' and login_phone_e164 = v_phone and id <> v_user) then
    raise exception 'Another staff member already has this mobile number';
  end if;
  update public.user_profiles set login_phone_e164 = v_phone where id = v_user;
  perform app.log_security_event('users.phone_changed', v_user);
  return 'Mobile number saved for ' || lower(btrim(p_email)) || ' (ends ' || right(v_phone, 3) || ')';
end;
$$;

revoke execute on function public.admin_set_user_phone(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_user_phone(uuid, text) to authenticated;
revoke execute on function app.set_user_phone(text, text) from public, anon, authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261021090000', 'otp_for_everyone');

-- ================================ 20261022090000_master_data ================================
-- Phase 5 — Master data and settings (SDD §9, BRD §6.2 FR-USER-04, 09, 10; §6.3 FR-CONF-01, 03, 05, 07)
--
--  * Branches (seeded in Phase 4) become editable; districts per city (no seed; Area stays free text).
--  * Customer types New / Retention (fixed codes, editable names).
--  * Products FTTA, FTTH, FTTB, LTE seeded; prices entered by Super Admin (none seeded, D-04), with
--    effective dates and optional city; overlapping ranges for the same product and city are refused.
--    public.price_for() returns the price for a product, city and date (city price wins over "all cities").
--  * Stock items WiFi Router, PDCOM, CALIX (serialized; editable display names).
--  * app_settings values (SDD §8.3 list) with validation; public holidays.
--  * Every write goes through a SECURITY DEFINER function that checks settings.manage / prices.manage,
--    validates, and writes activity_log; change_log keeps before/after history (T-13).
--  * Deactivated values stay readable for history; later phases refuse them on new records.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.districts (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.cities (id),
  name       text not null check (length(btrim(name)) between 2 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index districts_city_name on public.districts (city_id, lower(name));
create trigger districts_touch before update on public.districts for each row execute function app.touch_updated();
comment on table public.districts is 'Districts per city, entered by Super Admin (FR-USER-10). Area is free text on the sales form.';

create unique index branches_city_name_ci on public.branches (city_id, lower(name));

create table public.customer_types (
  code       text primary key check (code in ('new', 'retention')),
  name       text not null check (length(btrim(name)) between 2 and 40),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger customer_types_touch before update on public.customer_types for each row execute function app.touch_updated();
comment on table public.customer_types is 'New / Retention. Codes are fixed (business rules depend on them); names are editable (FR-USER-04).';
insert into public.customer_types (code, name, sort_order) values ('new', 'New', 1), ('retention', 'Retention', 2);

create table public.products (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name       text not null check (length(btrim(name)) between 2 and 60),
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger products_touch before update on public.products for each row execute function app.touch_updated();
comment on table public.products is 'Products sold (FR-CONF-01, D-04). The code never changes after creation.';
insert into public.products (code, name, sort_order) values ('FTTA', 'FTTA', 1), ('FTTH', 'FTTH', 2), ('FTTB', 'FTTB', 3), ('LTE', 'LTE', 4);

create table public.product_prices (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id),
  city_id        uuid references public.cities (id), -- null = all cities
  monthly_price  numeric(10, 2) not null check (monthly_price > 0),
  effective_from date not null,
  effective_to   date,                               -- null = open-ended
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint price_dates_in_order check (effective_to is null or effective_to >= effective_from)
);
create index product_prices_lookup on public.product_prices (product_id, city_id, effective_from);
create trigger product_prices_touch before update on public.product_prices for each row execute function app.touch_updated();
comment on table public.product_prices is 'Monthly price per product (USD), optionally per city, with effective dates (FR-CONF-05). Sales keep a price snapshot (FR-CONF-03).';

-- No two prices for the same product and city may cover the same day (SDD §8.3).
create or replace function app.check_price_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('product_prices:' || new.product_id::text));
  if exists (
    select 1 from public.product_prices p
    where p.id <> new.id
      and p.product_id = new.product_id
      and p.city_id is not distinct from new.city_id
      and daterange(p.effective_from, p.effective_to, '[]') && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'PRICE_OVERLAP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_price_overlap() from public;
create trigger product_prices_no_overlap
  before insert or update on public.product_prices
  for each row execute function app.check_price_overlap();

create table public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  display_name  text not null check (length(btrim(display_name)) between 2 and 60),
  is_serialized boolean not null default true,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create trigger stock_items_touch before update on public.stock_items for each row execute function app.touch_updated();
comment on table public.stock_items is 'Equipment tracked by serial number (D-10: spelling PDCOM). Codes are fixed; display names are editable.';
insert into public.stock_items (code, display_name, sort_order) values ('WIFI_ROUTER', 'WiFi Router', 1), ('PDCOM', 'PDCOM', 2), ('CALIX', 'CALIX', 3);

create table public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (length(btrim(name)) between 2 and 80),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create trigger public_holidays_touch before update on public.public_holidays for each row execute function app.touch_updated();
comment on table public.public_holidays is 'Public holidays excluded from leave working days (FR-LEAVE-07, D-18).';

-- ---------------------------------------------------------------------------
-- Settings values (SDD §8.3; D-08, D-18, D-33). Edited only through admin_set_setting (validated).
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('payroll_cutoff_day',         '3',                'Day of the following month after which the payroll month can be finalized'),
  ('incentive_threshold',        '15',               'Eligible units per month before the incentive starts'),
  ('incentive_rate',             '5',                'Incentive per eligible unit above the threshold (USD)'),
  ('temp_base_salary',           '100',              'Flat monthly base salary for temporary agents (USD, D-08)'),
  ('performance_target_units',   '20',               'Eligible units per month for "Target met"'),
  ('performance_baseline_units', '15',               'Eligible units per month for "Baseline" (below this = underperforming)'),
  ('free_month_amount',          '50',               'Free-month amount (USD)'),
  ('allowed_phone_prefixes',     '["63", "65"]',     'Customer mobile prefixes after +252 (D-33). Empty = any Somaliland mobile'),
  ('week_start_day',             '"saturday"',       'First day of the business week (D-33)'),
  ('weekend_days',               '["friday"]',       'Non-working days for leave (D-18)'),
  ('otp_enabled',                'true',             'SMS code at sign-in for every user (D-32)')
on conflict (key) do nothing;

create or replace function app.is_whole_number(p_value jsonb, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'number'
     and (p_value::text)::numeric = trunc((p_value::text)::numeric)
     and (p_value::text)::numeric between p_min and p_max
$$;

create or replace function app.is_amount(p_value jsonb, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'number'
     and (p_value::text)::numeric = round((p_value::text)::numeric, 2)
     and (p_value::text)::numeric between p_min and p_max
$$;
revoke execute on function app.is_whole_number(jsonb, numeric, numeric), app.is_amount(jsonb, numeric, numeric) from public;

-- Change one setting (settings.manage). Only known keys; each value is checked.
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days constant text[] := array['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  v_old jsonb;
  v_ok boolean;
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select value into v_old from public.app_settings where key = p_key;
  if not found then raise exception 'UNKNOWN_SETTING'; end if;

  v_ok := case p_key
    when 'payroll_cutoff_day' then app.is_whole_number(p_value, 1, 28)
    when 'incentive_threshold' then app.is_whole_number(p_value, 0, 1000)
    when 'incentive_rate' then app.is_amount(p_value, 0, 1000)
    when 'temp_base_salary' then app.is_amount(p_value, 0, 100000)
    when 'performance_target_units' then app.is_whole_number(p_value, 1, 1000)
    when 'performance_baseline_units' then app.is_whole_number(p_value, 0, 1000)
    when 'free_month_amount' then app.is_amount(p_value, 0, 10000)
    when 'allowed_phone_prefixes' then jsonb_typeof(p_value) = 'array'
      and jsonb_array_length(p_value) <= 20
      and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or not (e #>> '{}') ~ '^[1-9][0-9]$')
      and (select count(distinct e) from jsonb_array_elements(p_value) e) = jsonb_array_length(p_value)
    when 'week_start_day' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') = any (v_days)
    when 'weekend_days' then jsonb_typeof(p_value) = 'array'
      and jsonb_array_length(p_value) <= 3
      and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (v_days)))
      and (select count(distinct e) from jsonb_array_elements(p_value) e) = jsonb_array_length(p_value)
    when 'otp_enabled' then jsonb_typeof(p_value) = 'boolean'
    else false
  end;
  if not coalesce(v_ok, false) then raise exception 'INVALID_SETTING'; end if;

  -- Bands must stay in order: baseline < target (FR-CONF-07).
  if p_key = 'performance_target_units'
     and (select (value::text)::int from public.app_settings where key = 'performance_baseline_units') >= (p_value::text)::int then
    raise exception 'BAND_ORDER';
  end if;
  if p_key = 'performance_baseline_units'
     and (p_value::text)::int >= (select (value::text)::int from public.app_settings where key = 'performance_target_units') then
    raise exception 'BAND_ORDER';
  end if;

  update public.app_settings set value = p_value where key = p_key;
  perform app.log_activity('settings.update', 'app_settings', null,
    jsonb_build_object('key', p_key, 'before', v_old, 'after', p_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- Save functions for the lists
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_branch(p_id uuid, p_city uuid, p_name text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    if p_id is null then
      insert into public.branches (city_id, name, is_active, created_by)
      values (p_city, btrim(p_name), coalesce(p_active, true), auth.uid()) returning id into v_id;
      perform app.log_activity('branches.create', 'branches', v_id);
    else
      update public.branches set city_id = p_city, name = btrim(p_name), is_active = coalesce(p_active, true)
       where id = p_id returning id into v_id;
      if v_id is null then raise exception 'NOT_FOUND'; end if;
      perform app.log_activity('branches.update', 'branches', v_id);
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  return v_id;
end;
$$;

create or replace function public.admin_save_district(p_id uuid, p_city uuid, p_name text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    if p_id is null then
      insert into public.districts (city_id, name, is_active, created_by)
      values (p_city, btrim(p_name), coalesce(p_active, true), auth.uid()) returning id into v_id;
      perform app.log_activity('districts.create', 'districts', v_id);
    else
      update public.districts set city_id = p_city, name = btrim(p_name), is_active = coalesce(p_active, true)
       where id = p_id returning id into v_id;
      if v_id is null then raise exception 'NOT_FOUND'; end if;
      perform app.log_activity('districts.update', 'districts', v_id);
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  return v_id;
end;
$$;

create or replace function public.admin_rename_customer_type(p_code text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.customer_types set name = btrim(p_name) where code = p_code;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.log_activity('customer_types.update', 'customer_types', null, jsonb_build_object('code', p_code));
end;
$$;

-- Products (prices.manage). The code is set once on creation.
create or replace function public.admin_save_product(p_id uuid, p_code text, p_name text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('prices.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    if p_id is null then
      insert into public.products (code, name, is_active, sort_order, created_by)
      values (upper(btrim(p_code)), btrim(p_name), coalesce(p_active, true),
              (select coalesce(max(sort_order), 0) + 1 from public.products), auth.uid())
      returning id into v_id;
      perform app.log_activity('products.create', 'products', v_id);
    else
      update public.products set name = btrim(p_name), is_active = coalesce(p_active, true)
       where id = p_id returning id into v_id;
      if v_id is null then raise exception 'NOT_FOUND'; end if;
      perform app.log_activity('products.update', 'products', v_id);
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  return v_id;
end;
$$;

-- Prices (prices.manage). Refused when the product is inactive (new price) or the dates overlap.
create or replace function public.admin_save_price(
  p_id uuid,
  p_product uuid,
  p_city uuid,
  p_monthly_price numeric,
  p_effective_from date,
  p_effective_to date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('prices.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null and not exists (select 1 from public.products where id = p_product and is_active) then
    raise exception 'PRODUCT_INACTIVE';
  end if;
  if p_city is not null and not exists (select 1 from public.cities where id = p_city and is_active) then
    raise exception 'NOT_FOUND';
  end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price <> round(p_monthly_price, 2) then
    raise exception 'INVALID_PRICE';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'INVALID_DATES';
  end if;
  if p_id is null then
    insert into public.product_prices (product_id, city_id, monthly_price, effective_from, effective_to, created_by)
    values (p_product, p_city, p_monthly_price, p_effective_from, p_effective_to, auth.uid())
    returning id into v_id;
    perform app.log_activity('prices.create', 'product_prices', v_id);
  else
    update public.product_prices
       set product_id = p_product, city_id = p_city, monthly_price = p_monthly_price,
           effective_from = p_effective_from, effective_to = p_effective_to
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
    perform app.log_activity('prices.update', 'product_prices', v_id);
  end if;
  return v_id;
end;
$$;

-- Stock items: display name and active flag only (codes are fixed; settings.manage).
create or replace function public.admin_save_stock_item(p_id uuid, p_display_name text, p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.stock_items set display_name = btrim(p_display_name), is_active = coalesce(p_active, true) where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.log_activity('stock_items.update', 'stock_items', p_id);
end;
$$;

create or replace function public.admin_save_holiday(p_id uuid, p_date date, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    if p_id is null then
      insert into public.public_holidays (holiday_date, name, created_by) values (p_date, btrim(p_name), auth.uid()) returning id into v_id;
      perform app.log_activity('holidays.create', 'public_holidays', v_id);
    else
      update public.public_holidays set holiday_date = p_date, name = btrim(p_name) where id = p_id returning id into v_id;
      if v_id is null then raise exception 'NOT_FOUND'; end if;
      perform app.log_activity('holidays.update', 'public_holidays', v_id);
    end if;
  exception when unique_violation then
    raise exception 'DATE_TAKEN';
  end;
  return v_id;
end;
$$;

create or replace function public.admin_delete_holiday(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.public_holidays where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.log_activity('holidays.delete', 'public_holidays', p_id);
end;
$$;

-- Price for a product in a city on a date: the city's own price wins over the all-cities price.
-- SECURITY INVOKER: RLS on product_prices applies (active users only). Null when no price applies.
create or replace function public.price_for(p_product uuid, p_city uuid, p_on date default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select p.monthly_price
  from public.product_prices p
  where p.product_id = p_product
    and (p.city_id = p_city or p.city_id is null)
    and daterange(p.effective_from, p.effective_to, '[]') @> coalesce(p_on, (now() at time zone 'Africa/Mogadishu')::date)
  order by (p.city_id is null)
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- RLS: every active user may read the lists (forms need them); writes only through the functions above.
-- ---------------------------------------------------------------------------
alter table public.districts enable row level security;
alter table public.customer_types enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.stock_items enable row level security;
alter table public.public_holidays enable row level security;

revoke all on public.districts, public.customer_types, public.products, public.product_prices,
  public.stock_items, public.public_holidays from anon, authenticated;
grant select on public.districts, public.customer_types, public.products, public.product_prices,
  public.stock_items, public.public_holidays to authenticated;

create policy districts_read on public.districts for select to authenticated using (app.is_active_user());
create policy customer_types_read on public.customer_types for select to authenticated using (app.is_active_user());
create policy products_read on public.products for select to authenticated using (app.is_active_user());
create policy product_prices_read on public.product_prices for select to authenticated using (app.is_active_user());
create policy stock_items_read on public.stock_items for select to authenticated using (app.is_active_user());
create policy public_holidays_read on public.public_holidays for select to authenticated using (app.is_active_user());

select app.enable_change_log('public.districts');
select app.enable_change_log('public.customer_types', 'code');
select app.enable_change_log('public.products');
select app.enable_change_log('public.product_prices');
select app.enable_change_log('public.stock_items');
select app.enable_change_log('public.public_holidays');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_set_setting(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_branch(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_district(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_rename_customer_type(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_product(uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_price(uuid, uuid, uuid, numeric, date, date) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_stock_item(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_holiday(uuid, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.admin_delete_holiday(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.price_for(uuid, uuid, date) from public, anon, authenticated, service_role;

grant execute on function public.admin_set_setting(text, jsonb) to authenticated;
grant execute on function public.admin_save_branch(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.admin_save_district(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.admin_rename_customer_type(text, text) to authenticated;
grant execute on function public.admin_save_product(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_save_price(uuid, uuid, uuid, numeric, date, date) to authenticated;
grant execute on function public.admin_save_stock_item(uuid, text, boolean) to authenticated;
grant execute on function public.admin_save_holiday(uuid, date, text) to authenticated;
grant execute on function public.admin_delete_holiday(uuid) to authenticated;
grant execute on function public.price_for(uuid, uuid, date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261022090000', 'master_data');

-- ================================ 20261022120000_plans ================================
-- Phase 5 addition (D-34, owner input 22 Oct 2026): each product (FTTA, FTTH, FTTB, LTE) has PLANS,
-- and the price belongs to the plan: monthly recharge + installation fee, with effective dates.
-- One price for all cities (owner). Replaces the product-level price list of 20261022090000_master_data
-- (no sale has used it yet). The 18 plans of the owner's price sheets are loaded, effective 22 Oct 2026.

-- ---------------------------------------------------------------------------
-- Remove the product-level price list
-- ---------------------------------------------------------------------------
drop function if exists public.price_for(uuid, uuid, date);
drop function if exists public.admin_save_price(uuid, uuid, uuid, numeric, date, date);
drop table if exists public.product_prices;
drop function if exists app.check_price_overlap();

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id),
  name           text not null check (length(btrim(name)) between 2 and 60),
  download_mbps  int not null check (download_mbps between 1 and 100000),
  upload_mbps    int not null check (upload_mbps between 1 and 100000),
  data_allowance text not null default 'Unlimited' check (length(btrim(data_allowance)) between 1 and 40),
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create unique index plans_product_name on public.plans (product_id, lower(name));
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated();
comment on table public.plans is 'Plans (packages) of each product, e.g. FTTH → SO-Home (D-34). A sale records product and plan.';

create table public.plan_prices (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.plans (id),
  recharge_amount   numeric(10, 2) not null check (recharge_amount > 0),
  installation_fee  numeric(10, 2) not null default 0 check (installation_fee >= 0),
  effective_from    date not null,
  effective_to      date,   -- null = open-ended
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint plan_price_dates_in_order check (effective_to is null or effective_to >= effective_from)
);
create index plan_prices_lookup on public.plan_prices (plan_id, effective_from);
create trigger plan_prices_touch before update on public.plan_prices for each row execute function app.touch_updated();
comment on table public.plan_prices is
  'Monthly recharge and installation fee per plan (USD), same in all cities, with effective dates (FR-CONF-05, D-34). Sales keep a snapshot (FR-CONF-03).';

-- No two prices for the same plan may cover the same day.
create or replace function app.check_plan_price_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('plan_prices:' || new.plan_id::text));
  if exists (
    select 1 from public.plan_prices p
    where p.id <> new.id
      and p.plan_id = new.plan_id
      and daterange(p.effective_from, p.effective_to, '[]') && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'PRICE_OVERLAP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_plan_price_overlap() from public;
create trigger plan_prices_no_overlap
  before insert or update on public.plan_prices
  for each row execute function app.check_plan_price_overlap();

-- ---------------------------------------------------------------------------
-- The owner's price sheets (22 Oct 2026). Names tidied with the owner's approval.
-- ---------------------------------------------------------------------------
with sheet (product, plan, recharge, download, upload, sort) as (
  values
    ('FTTA', 'SO-Premium',       150, 50, 50, 1),
    ('FTTA', 'SO-Seven Premium', 100, 40, 35, 2),
    ('FTTA', 'SO-Family',         60, 30, 30, 3),
    ('FTTA', 'SO-Lite',           35, 16, 16, 4),
    ('FTTA', 'SO-Ultra',          25,  9,  9, 5),
    ('FTTA', 'SO-Basic',          20,  6,  6, 6),
    ('FTTH', 'SO-Prime',          60, 40, 40, 1),
    ('FTTH', 'SO-Basic',          35, 35, 35, 2),
    ('FTTH', 'SO-Home',           25, 25, 25, 3),
    ('FTTH', 'SO-Home Basic',     20,  6,  6, 4),
    ('FTTB', 'FTTB-210',         210, 60, 60, 1),
    ('FTTB', 'FTTB-140',         140, 40, 40, 2),
    ('FTTB', 'FTTB-70',           70, 30, 30, 3),
    ('FTTB', 'FTTB-40',           40, 20, 20, 4),
    ('FTTB', 'FTTB-25',           25, 15, 15, 5),
    ('LTE',  'SO!-Premium',       40, 20, 20, 1),
    ('LTE',  'SO!-Family',        25, 15, 15, 2),
    ('LTE',  'SO!-Lite',          15,  8,  8, 3)
),
new_plans as (
  insert into public.plans (product_id, name, download_mbps, upload_mbps, sort_order)
  select p.id, s.plan, s.download, s.upload, s.sort
  from sheet s join public.products p on p.code = s.product
  returning id, product_id, name
)
insert into public.plan_prices (plan_id, recharge_amount, installation_fee, effective_from)
select n.id, s.recharge, 0, date '2026-10-22'
from new_plans n
join public.products p on p.id = n.product_id
join sheet s on s.product = p.code and s.plan = n.name;

-- ---------------------------------------------------------------------------
-- Functions (prices.manage)
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_plan(
  p_id uuid,
  p_product uuid,
  p_name text,
  p_download_mbps int,
  p_upload_mbps int,
  p_data_allowance text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('prices.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null and not exists (select 1 from public.products where id = p_product and is_active) then
    raise exception 'PRODUCT_INACTIVE';
  end if;
  begin
    if p_id is null then
      insert into public.plans (product_id, name, download_mbps, upload_mbps, data_allowance, is_active, sort_order, created_by)
      values (p_product, btrim(p_name), p_download_mbps, p_upload_mbps, coalesce(nullif(btrim(p_data_allowance), ''), 'Unlimited'),
              coalesce(p_active, true), (select coalesce(max(sort_order), 0) + 1 from public.plans where product_id = p_product), auth.uid())
      returning id into v_id;
      perform app.log_activity('plans.create', 'plans', v_id);
    else
      -- The product of an existing plan never changes (sales point to the plan).
      update public.plans
         set name = btrim(p_name), download_mbps = p_download_mbps, upload_mbps = p_upload_mbps,
             data_allowance = coalesce(nullif(btrim(p_data_allowance), ''), 'Unlimited'), is_active = coalesce(p_active, true)
       where id = p_id returning id into v_id;
      if v_id is null then raise exception 'NOT_FOUND'; end if;
      perform app.log_activity('plans.update', 'plans', v_id);
    end if;
  exception
    when unique_violation then raise exception 'NAME_TAKEN';
    when check_violation then raise exception 'INVALID_PLAN';
  end;
  return v_id;
end;
$$;

create or replace function public.admin_save_plan_price(
  p_id uuid,
  p_plan uuid,
  p_recharge numeric,
  p_installation numeric,
  p_effective_from date,
  p_effective_to date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('prices.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null and not exists (
    select 1 from public.plans pl join public.products pr on pr.id = pl.product_id
    where pl.id = p_plan and pl.is_active and pr.is_active
  ) then
    raise exception 'PLAN_INACTIVE';
  end if;
  if p_recharge is null or p_recharge <= 0 or p_recharge <> round(p_recharge, 2)
     or p_installation is null or p_installation < 0 or p_installation <> round(p_installation, 2) then
    raise exception 'INVALID_PRICE';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'INVALID_DATES';
  end if;
  if p_id is null then
    insert into public.plan_prices (plan_id, recharge_amount, installation_fee, effective_from, effective_to, created_by)
    values (p_plan, p_recharge, p_installation, p_effective_from, p_effective_to, auth.uid())
    returning id into v_id;
    perform app.log_activity('plan_prices.create', 'plan_prices', v_id);
  else
    update public.plan_prices
       set plan_id = p_plan, recharge_amount = p_recharge, installation_fee = p_installation,
           effective_from = p_effective_from, effective_to = p_effective_to
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
    perform app.log_activity('plan_prices.update', 'plan_prices', v_id);
  end if;
  return v_id;
end;
$$;

-- Price of a plan on a date (default: today in EAT). SECURITY INVOKER: RLS applies (active users only).
-- No row when no price applies. Used by sales in Phase 7 for the price snapshot.
create or replace function public.plan_price(p_plan uuid, p_on date default null)
returns table (recharge_amount numeric, installation_fee numeric)
language sql
stable
set search_path = ''
as $$
  select p.recharge_amount, p.installation_fee
  from public.plan_prices p
  where p.plan_id = p_plan
    and daterange(p.effective_from, p.effective_to, '[]') @> coalesce(p_on, (now() at time zone 'Africa/Mogadishu')::date)
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- RLS, history, grants
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
revoke all on public.plans, public.plan_prices from anon, authenticated;
grant select on public.plans, public.plan_prices to authenticated;
create policy plans_read on public.plans for select to authenticated using (app.is_active_user());
create policy plan_prices_read on public.plan_prices for select to authenticated using (app.is_active_user());

select app.enable_change_log('public.plans');
select app.enable_change_log('public.plan_prices');

revoke execute on function public.admin_save_plan(uuid, uuid, text, int, int, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.admin_save_plan_price(uuid, uuid, numeric, numeric, date, date) from public, anon, authenticated, service_role;
revoke execute on function public.plan_price(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_plan(uuid, uuid, text, int, int, text, boolean) to authenticated;
grant execute on function public.admin_save_plan_price(uuid, uuid, numeric, numeric, date, date) to authenticated;
grant execute on function public.plan_price(uuid, date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261022120000', 'plans');

-- ================================ 20261022150000_stock ================================
-- Phase 6 — Stock ledger and team custody (SDD §12, BRD §6.12; owner decision D-35, 22 Oct 2026)
--
-- D-35 replaces serial tracking (D-12): stock is counted by QUANTITY per item (WiFi Router, PDCOM, CALIX).
--  * Locations: Central Store, Central Store — faulty, and one stock per TEAM (held by its Team Leader /
--    Supervisor). Agents hold no stock of their own; branches hold none (D-31).
--  * Receive (Stock Officer) → Central. Send (Stock Officer) Central → team: the stock is in transit until
--    the team's Team Leader / Supervisor (or Super Admin) accepts it.
--  * Each sale by a member of the team deducts the items the agent picked from the team's accepted stock
--    (app.issue_stock, called by sales in Phase 7). Never below zero.
--  * Returns are recorded by the Stock Officer only (team or customer → Central, or the faulty store).
--  * Adjustments: requested by the Stock Officer, approved by Super Admin (never by the requester).
--  * stock_movements is the append-only ledger; balances are always computed from it (no balance column).
--  * Every decrease takes a transaction lock on (location, item), so two deductions cannot overdraw.

update public.stock_items set is_serialized = false;
comment on column public.stock_items.is_serialized is 'Always false since D-35: stock is counted by quantity, no serial numbers.';

update public.permissions set description = 'Send stock to teams and record returns' where key = 'stock.transfer';
update public.permissions set description = 'Accept stock delivered to your team' where key = 'stock.acknowledge';

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create table public.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('central', 'faulty', 'team')),
  team_id    uuid unique references public.teams (id),
  created_at timestamptz not null default now(),
  constraint team_location_has_team check ((kind = 'team') = (team_id is not null))
);
create unique index stock_locations_one_central on public.stock_locations (kind) where kind in ('central', 'faulty');
comment on table public.stock_locations is 'Central Store, its faulty store, and one stock per team (D-35). Names come from the team.';

insert into public.stock_locations (kind) values ('central'), ('faulty');
insert into public.stock_locations (kind, team_id) select 'team', id from public.teams;

create or replace function app.create_team_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_locations (kind, team_id) values ('team', new.id) on conflict (team_id) do nothing;
  return new;
end;
$$;
revoke execute on function app.create_team_stock_location() from public;
create trigger teams_stock_location after insert on public.teams for each row execute function app.create_team_stock_location();

create or replace function app.location_of(p_kind text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.stock_locations where kind = p_kind and kind in ('central', 'faulty')
$$;

-- ---------------------------------------------------------------------------
-- The ledger (append-only)
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  movement_type    text not null check (movement_type in ('receipt', 'transfer_out', 'transfer_in', 'issue', 'return', 'adjustment')),
  item_id          uuid not null references public.stock_items (id),
  quantity         int not null check (quantity > 0),
  from_location_id uuid references public.stock_locations (id),
  to_location_id   uuid references public.stock_locations (id),
  ref_type         text check (ref_type in ('receipt', 'transfer', 'sale', 'switch', 'refund', 'return', 'adjustment')),
  ref_id           uuid,
  reason           text check (reason is null or length(reason) <= 500),
  actor_id         uuid,
  approved_by      uuid,
  occurred_at      timestamptz not null default now(),
  constraint movement_has_location check (from_location_id is not null or to_location_id is not null)
);
create index stock_movements_from_idx on public.stock_movements (from_location_id, item_id);
create index stock_movements_to_idx on public.stock_movements (to_location_id, item_id);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);
create index stock_movements_time_idx on public.stock_movements (occurred_at);
comment on table public.stock_movements is
  'Append-only stock ledger (FR-STK-06). A transfer_out leaves the sender at once; the receiver counts it only at transfer_in (acceptance).';

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function app.prevent_change();

-- Quantity that counts at a location: in = receipt / transfer_in / return / adjustment (to);
-- out = transfer_out / issue / return / adjustment (from). transfer_out's destination is "in transit".
create or replace function app.location_balance(p_location uuid, p_item uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
           when m.to_location_id = p_location and m.movement_type <> 'transfer_out' then m.quantity
           when m.from_location_id = p_location then -m.quantity
           else 0 end), 0)::int
  from public.stock_movements m
  where m.item_id = p_item and (m.to_location_id = p_location or m.from_location_id = p_location)
$$;

-- Write one movement. Decreases lock (location, item) for the rest of the transaction and refuse to go
-- below zero (FR-STK-05). Only the functions below call this.
create or replace function app.record_movement(
  p_type text, p_item uuid, p_quantity int, p_from uuid, p_to uuid,
  p_ref_type text, p_ref_id uuid, p_reason text default null, p_approved_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if not exists (select 1 from public.stock_items where id = p_item) then raise exception 'UNKNOWN_ITEM'; end if;
  if p_from is not null then
    perform pg_advisory_xact_lock(hashtext('stock:' || p_from::text || ':' || p_item::text));
    if app.location_balance(p_from, p_item) < p_quantity then
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;
  insert into public.stock_movements (movement_type, item_id, quantity, from_location_id, to_location_id, ref_type, ref_id, reason, actor_id, approved_by)
  values (p_type, p_item, p_quantity, p_from, p_to, p_ref_type, p_ref_id, nullif(btrim(p_reason), ''), auth.uid(), p_approved_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deliveries to teams
-- ---------------------------------------------------------------------------
create table public.stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  to_location_id  uuid not null references public.stock_locations (id),
  status          text not null default 'sent' check (status in ('sent', 'accepted', 'cancelled')),
  note            text check (note is null or length(note) <= 500),
  sent_by         uuid,
  sent_at         timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz
);
create index stock_transfers_to_idx on public.stock_transfers (to_location_id, status);
comment on table public.stock_transfers is 'Stock sent from Central to a team; counts for the team only after acceptance (FR-STK-08, D-35).';

create table public.stock_transfer_lines (
  transfer_id uuid not null references public.stock_transfers (id),
  item_id     uuid not null references public.stock_items (id),
  quantity    int not null check (quantity > 0),
  primary key (transfer_id, item_id)
);
create trigger stock_transfer_lines_append_only
  before update or delete on public.stock_transfer_lines
  for each row execute function app.prevent_change();

-- ---------------------------------------------------------------------------
-- Adjustments (Stock Officer requests, Super Admin approves)
-- ---------------------------------------------------------------------------
create table public.stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.stock_locations (id),
  item_id         uuid not null references public.stock_items (id),
  quantity_change int not null check (quantity_change <> 0 and abs(quantity_change) <= 100000),
  reason          text not null check (length(btrim(reason)) between 3 and 500),
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 500)
);
create index stock_adjustments_status_idx on public.stock_adjustments (status, requested_at);
comment on table public.stock_adjustments is 'Corrections such as lost or damaged stock: reason required, Super Admin approval (FR-STK-07).';

-- ---------------------------------------------------------------------------
-- Who may see a location (RLS helper)
--   stock.read at "all": every location · "city": teams of the caller's city · "team"/"own": the team the
--   caller leads or belongs to (agents see their team's stock, since their sales deduct from it).
-- ---------------------------------------------------------------------------
create or replace function app.can_read_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case app.permission_scope('stock.read')
    when 'all' then true
    when 'city' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      join public.user_profiles me on me.id = auth.uid()
      where l.id = p_location and me.city_id is not null and t.city_id = me.city_id)
    when 'team' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = p_location
        and (t.team_leader_id = auth.uid() or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = auth.uid())))
    when 'own' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = p_location
        and (t.team_leader_id = auth.uid() or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = auth.uid())))
    else false
  end
$$;

-- The team stock a user's sales deduct from (their team, or the team they lead). Null when none.
create or replace function app.team_location_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.stock_locations l
  join public.teams t on t.id = l.team_id and t.is_active
  where t.id = coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = p_user),
    (select t2.id from public.teams t2 where t2.team_leader_id = p_user and t2.is_active order by t2.created_at limit 1))
$$;

-- ---------------------------------------------------------------------------
-- Operations (API). Each checks its permission, validates, writes the ledger and the activity log.
-- p_lines: [{"item_id": "...", "quantity": 3}, ...] — one line per item.
-- ---------------------------------------------------------------------------
create or replace function app.read_lines(p_lines jsonb)
returns table (item_id uuid, quantity int)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 20 then
    raise exception 'INVALID_LINES';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity')::numeric <> trunc((e ->> 'quantity')::numeric)
       or (e ->> 'quantity')::numeric not between 1 and 100000 or (e ->> 'item_id') is null
  ) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines) then
    raise exception 'DUPLICATE_ITEM';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where not exists (select 1 from public.stock_items i where i.id::text = e ->> 'item_id' and i.is_active)
  ) then
    raise exception 'UNKNOWN_ITEM';
  end if;
  return query select (e ->> 'item_id')::uuid, (e ->> 'quantity')::int from jsonb_array_elements(p_lines) e;
end;
$$;

-- Receive into Central (stock.receive).
create or replace function public.stock_receive(p_lines jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid := gen_random_uuid();
  v_line record;
begin
  if not app.has_permission('stock.receive') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('receipt', v_line.item_id, v_line.quantity, null, app.location_of('central'), 'receipt', v_ref, p_note);
  end loop;
  perform app.log_activity('stock.receive', 'stock_movements', v_ref, jsonb_build_object('lines', p_lines));
  return v_ref;
end;
$$;

-- Send from Central to a team (stock.transfer). Leaves Central at once; the team counts it on acceptance.
create or replace function public.stock_send(p_team uuid, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to uuid;
  v_id uuid;
  v_line record;
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select l.id into v_to from public.stock_locations l join public.teams t on t.id = l.team_id where t.id = p_team and t.is_active;
  if v_to is null then raise exception 'TEAM_NOT_FOUND'; end if;

  insert into public.stock_transfers (to_location_id, note, sent_by) values (v_to, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  for v_line in select * from app.read_lines(p_lines) loop
    insert into public.stock_transfer_lines (transfer_id, item_id, quantity) values (v_id, v_line.item_id, v_line.quantity);
    perform app.record_movement('transfer_out', v_line.item_id, v_line.quantity, app.location_of('central'), v_to, 'transfer', v_id);
  end loop;
  perform app.log_activity('stock.send', 'stock_transfers', v_id);
  return v_id;
end;
$$;

-- Accept a delivery: the receiving team's Team Leader / Supervisor (stock.acknowledge), or Super Admin.
create or replace function public.stock_accept(p_transfer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_line record;
begin
  select * into v_transfer from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (
    (app.is_active_user() and app.is_super_admin(auth.uid()))
    or (app.has_permission('stock.acknowledge') and exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = v_transfer.to_location_id and t.team_leader_id = auth.uid()))
  ) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_transfer.status <> 'sent' then raise exception 'ALREADY_DECIDED'; end if;

  for v_line in select item_id, quantity from public.stock_transfer_lines where transfer_id = p_transfer loop
    perform app.record_movement('transfer_in', v_line.item_id, v_line.quantity, null, v_transfer.to_location_id, 'transfer', p_transfer);
  end loop;
  update public.stock_transfers set status = 'accepted', decided_by = auth.uid(), decided_at = now() where id = p_transfer;
  perform app.log_activity('stock.accept', 'stock_transfers', p_transfer);
end;
$$;

-- Cancel a delivery not yet accepted (stock.transfer): the stock goes back to Central.
create or replace function public.stock_cancel(p_transfer uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_line record;
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_transfer from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_transfer.status <> 'sent' then raise exception 'ALREADY_DECIDED'; end if;

  for v_line in select item_id, quantity from public.stock_transfer_lines where transfer_id = p_transfer loop
    perform app.record_movement('transfer_in', v_line.item_id, v_line.quantity, null, app.location_of('central'), 'transfer', p_transfer, p_reason);
  end loop;
  update public.stock_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_transfer;
  perform app.log_activity('stock.cancel', 'stock_transfers', p_transfer, jsonb_build_object('reason', p_reason));
end;
$$;

-- Return (Stock Officer only, stock.transfer): from a team, or from a customer (p_team null), to Central
-- or — when faulty — to the faulty store. Reason codes: faulty, refund, switch, retention_rejected, other.
create or replace function public.stock_return(
  p_team uuid, p_item uuid, p_quantity int, p_reason_code text, p_note text default null, p_faulty boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
  v_ref uuid := gen_random_uuid();
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason_code is null or p_reason_code not in ('faulty', 'refund', 'switch', 'retention_rejected', 'other') then
    raise exception 'REASON_REQUIRED';
  end if;
  if p_reason_code = 'other' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'REASON_REQUIRED'; end if;
  if p_team is not null then
    select l.id into v_from from public.stock_locations l where l.team_id = p_team;
    if v_from is null then raise exception 'TEAM_NOT_FOUND'; end if;
  end if;
  perform app.record_movement('return', p_item, p_quantity, v_from,
    app.location_of(case when coalesce(p_faulty, false) or p_reason_code = 'faulty' then 'faulty' else 'central' end),
    'return', v_ref, p_reason_code || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  perform app.log_activity('stock.return', 'stock_movements', v_ref, jsonb_build_object('reason', p_reason_code, 'from_team', p_team));
  return v_ref;
end;
$$;

create or replace function public.stock_request_adjustment(p_location uuid, p_item uuid, p_change int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('stock.adjust.request') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.stock_locations where id = p_location) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.stock_items where id = p_item) then raise exception 'UNKNOWN_ITEM'; end if;
  if p_change is null or p_change = 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  insert into public.stock_adjustments (location_id, item_id, quantity_change, reason, requested_by)
  values (p_location, p_item, p_change, btrim(p_reason), auth.uid()) returning id into v_id;
  perform app.log_activity('stock.adjust_request', 'stock_adjustments', v_id);
  return v_id;
end;
$$;

-- Approve or reject (stock.adjust.approve). Nobody decides their own request.
create or replace function public.stock_decide_adjustment(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adj public.stock_adjustments;
begin
  if not app.has_permission('stock.adjust.approve') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_adj from public.stock_adjustments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_adj.status <> 'requested' then raise exception 'ALREADY_DECIDED'; end if;
  if v_adj.requested_by = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if p_approve then
    if v_adj.quantity_change > 0 then
      perform app.record_movement('adjustment', v_adj.item_id, v_adj.quantity_change, null, v_adj.location_id, 'adjustment', p_id, v_adj.reason, auth.uid());
    else
      perform app.record_movement('adjustment', v_adj.item_id, -v_adj.quantity_change, v_adj.location_id, null, 'adjustment', p_id, v_adj.reason, auth.uid());
    end if;
  end if;
  update public.stock_adjustments
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  perform app.log_activity(case when p_approve then 'stock.adjust_approve' else 'stock.adjust_reject' end, 'stock_adjustments', p_id);
end;
$$;

-- Issue to a customer (internal: called by the sale / switch functions of Phases 7–8, never by the API).
-- Deducts from the seller's team stock; refuses when the seller has no team or the stock is short.
create or replace function app.issue_stock(p_seller uuid, p_lines jsonb, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := app.team_location_of(p_seller);
  v_line record;
begin
  if v_from is null then raise exception 'NO_TEAM_STOCK'; end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('issue', v_line.item_id, v_line.quantity, v_from, null, p_ref_type, p_ref_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: per location and item, for a period (EAT dates): opening, in/out by type, closing; plus stock in
-- transit to the location. SECURITY INVOKER: RLS limits it to the locations the caller may see.
-- ---------------------------------------------------------------------------
create or replace function public.stock_report(p_from date, p_to date)
returns table (
  location_id uuid, item_id uuid,
  opening int, received int, transferred_in int, transferred_out int, issued int,
  returned_in int, returned_out int, adjusted int, closing int, in_transit int
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Africa/Mogadishu') as t0,
           ((p_to + 1)::timestamp at time zone 'Africa/Mogadishu') as t1
  ),
  legs as (
    -- each movement seen from each location it touches; sign = effect on that location
    select m.to_location_id as loc, m.item_id, m.movement_type, m.quantity as qty, m.occurred_at
    from public.stock_movements m where m.to_location_id is not null and m.movement_type <> 'transfer_out'
    union all
    select m.from_location_id, m.item_id, m.movement_type, -m.quantity, m.occurred_at
    from public.stock_movements m where m.from_location_id is not null
  ),
  per as (
    select l.loc, l.item_id,
      coalesce(sum(l.qty) filter (where l.occurred_at < b.t0), 0) as opening,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'receipt'), 0) as received,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'transfer_in'), 0) as transferred_in,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'transfer_out'), 0) as transferred_out,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'issue'), 0) as issued,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'return' and l.qty > 0), 0) as returned_in,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'return' and l.qty < 0), 0) as returned_out,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'adjustment'), 0) as adjusted,
      coalesce(sum(l.qty) filter (where l.occurred_at < b.t1), 0) as closing
    from legs l cross join bounds b
    group by l.loc, l.item_id
  ),
  transit as (
    select t.to_location_id as loc, tl.item_id, sum(tl.quantity) as qty
    from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id
    where t.status = 'sent'
    group by t.to_location_id, tl.item_id
  )
  select coalesce(p.loc, tr.loc), coalesce(p.item_id, tr.item_id),
         coalesce(p.opening, 0)::int, coalesce(p.received, 0)::int, coalesce(p.transferred_in, 0)::int,
         coalesce(p.transferred_out, 0)::int, coalesce(p.issued, 0)::int, coalesce(p.returned_in, 0)::int,
         coalesce(p.returned_out, 0)::int, coalesce(p.adjusted, 0)::int, coalesce(p.closing, 0)::int,
         coalesce(tr.qty, 0)::int
  from per p full join transit tr on tr.loc = p.loc and tr.item_id = p.item_id
  where app.can_read_location(coalesce(p.loc, tr.loc))
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.stock_locations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_adjustments enable row level security;

revoke all on public.stock_locations, public.stock_movements, public.stock_transfers, public.stock_transfer_lines,
  public.stock_adjustments from anon, authenticated;
grant select on public.stock_locations, public.stock_movements, public.stock_transfers, public.stock_transfer_lines,
  public.stock_adjustments to authenticated;

create policy stock_locations_read on public.stock_locations for select to authenticated using (app.is_active_user());
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (app.can_read_location(from_location_id) or app.can_read_location(to_location_id));
create policy stock_transfers_read on public.stock_transfers for select to authenticated
  using (app.can_read_location(to_location_id) or app.has_permission('stock.transfer'));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated
  using (exists (select 1 from public.stock_transfers t where t.id = transfer_id));
create policy stock_adjustments_read on public.stock_adjustments for select to authenticated
  using (app.can_read_location(location_id) or app.has_permission('stock.adjust.request') or app.has_permission('stock.adjust.approve'));

select app.enable_change_log('public.stock_locations');
select app.enable_change_log('public.stock_movements');
select app.enable_change_log('public.stock_transfers');
select app.enable_change_log('public.stock_transfer_lines', 'transfer_id');
select app.enable_change_log('public.stock_adjustments');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function app.location_of(text), app.location_balance(uuid, uuid),
  app.record_movement(text, uuid, int, uuid, uuid, text, uuid, text, uuid), app.can_read_location(uuid),
  app.team_location_of(uuid), app.read_lines(jsonb), app.issue_stock(uuid, jsonb, text, uuid) from public;
grant execute on function app.can_read_location(uuid) to authenticated;

revoke execute on function public.stock_receive(jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_send(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_accept(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.stock_cancel(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_return(uuid, uuid, int, text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.stock_request_adjustment(uuid, uuid, int, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_decide_adjustment(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_report(date, date) from public, anon, authenticated, service_role;

grant execute on function public.stock_receive(jsonb, text) to authenticated;
grant execute on function public.stock_send(uuid, jsonb, text) to authenticated;
grant execute on function public.stock_accept(uuid) to authenticated;
grant execute on function public.stock_cancel(uuid, text) to authenticated;
grant execute on function public.stock_return(uuid, uuid, int, text, text, boolean) to authenticated;
grant execute on function public.stock_request_adjustment(uuid, uuid, int, text) to authenticated;
grant execute on function public.stock_decide_adjustment(uuid, boolean, text) to authenticated;
grant execute on function public.stock_report(date, date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261022150000', 'stock');

-- ================================ 20261022170000_stock_supervisors ================================
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261022170000', 'stock_supervisors');

-- ================================ 20261024090000_sales ================================
-- Phase 7 — Sales registration (BRD §6.4, §6.11, §7, §8; SDD §10.1, 10.2, 10.6, 11.1; D-01, D-02, D-09, D-14,
-- D-30, D-31, D-34, D-35, D-36)
--
--  * customers + customer_identifiers: phone (E.164) and Index (8 digits) are each unique across ALL customers,
--    current and former values (BR-01). Changing one is a Super Admin action with a reason; the old value stays
--    reserved (FR-SALE-16).
--  * sales + sale_items: one row per sale (1 unit). Agent from the session; sale time and month from the database
--    clock in EAT (D-30); price from the plan's price in force (D-34); stock deducted from the seller's team in the
--    same transaction (D-35); idempotent on client_request_id (FR-SALE-15).
--  * public.create_sale is the only way to write a sale. Duplicates (DUP_PHONE, DUP_INDEX, IDENTITY_CONFLICT,
--    SAME_MONTH) record a durable audit event and RETURN a result instead of raising, so the event commits even
--    though no sale is created (SDD §11.1). Races are caught by unique indexes inside a sub-transaction.
--  * D-36 (owner, 24 Oct 2026): Retention names may differ slightly (close match); months paid 1–12;
--    amount = recharge × months + installation fee; free month = any plan, months fixed at 2, 2 × recharge must be
--    at least the free-month amount setting ($50).

-- ---------------------------------------------------------------------------
-- Name matching (D-36): ignore capitals, spaces and punctuation; allow small spelling differences.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '[^[:alpha:]]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function app.levenshtein(a text, b text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  la int := length(a);
  lb int := length(b);
  prev int[];
  cur int[];
  i int;
  j int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(
        cur[j] + 1,
        prev[j + 1] + 1,
        prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$$;

-- True when two names are the same person by D-36: equal after normalising, equal without spaces
-- ("Abdi Rahman" = "Abdirahman"), equal with words in any order, or within a small edit distance
-- (up to 1 change, or 1 per 5 letters: "Mohamed" ≈ "Mohammed"). Clearly different names do not match.
create or replace function app.names_match(a text, b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  na text := app.normalize_name(a);
  nb text := app.normalize_name(b);
  ca text := replace(na, ' ', '');
  cb text := replace(nb, ' ', '');
  sa text := (select string_agg(w, '' order by w) from unnest(string_to_array(na, ' ')) w);
  sb text := (select string_agg(w, '' order by w) from unnest(string_to_array(nb, ' ')) w);
  allowed int := greatest(1, greatest(length(ca), length(cb)) / 5);
begin
  if ca = '' or cb = '' then return false; end if;
  if ca = cb or sa = sb then return true; end if;
  return app.levenshtein(ca, cb) <= allowed or app.levenshtein(sa, sb) <= allowed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (length(btrim(full_name)) between 2 and 120),
  city_id     uuid not null references public.cities (id),
  district_id uuid references public.districts (id),
  area_text   text check (area_text is null or length(area_text) <= 100),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create trigger customers_touch before update on public.customers for each row execute function app.touch_updated();
comment on table public.customers is 'One row per real customer (D-01). Identity = phone and Index in customer_identifiers.';

create table public.customer_identifiers (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id),
  kind         text not null check (kind in ('phone', 'index')),
  value        text not null,
  is_current   boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  replaced_at  timestamptz,
  replaced_by  uuid,
  replace_reason text check (replace_reason is null or length(replace_reason) <= 500),
  constraint identifier_format check (
    (kind = 'phone' and value ~ '^\+252[1-9][0-9]{6,8}$') or (kind = 'index' and value ~ '^[0-9]{8}$')),
  constraint identifier_unique unique (kind, value)
);
create unique index customer_identifiers_one_current on public.customer_identifiers (customer_id, kind) where is_current;
comment on table public.customer_identifiers is
  'Phones and Index Numbers, current and former. Each value is unique for ever (BR-01): an old value stays reserved.';

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table public.sales (
  id                uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  customer_id       uuid not null references public.customers (id),
  customer_name     text not null,                       -- as typed on this sale (evidence)
  agent_id          uuid not null references public.user_profiles (id),
  team_id           uuid references public.teams (id),
  customer_type     text not null references public.customer_types (code),
  product_id        uuid not null references public.products (id),
  plan_id           uuid not null references public.plans (id),
  plan_price_id     uuid not null references public.plan_prices (id),
  unit_price        numeric(10, 2) not null check (unit_price > 0),       -- recharge snapshot (FR-CONF-03)
  installation_fee  numeric(10, 2) not null check (installation_fee >= 0),
  months_paid       int not null check (months_paid between 1 and 12),
  free_month        boolean not null default false,
  amount_collected  numeric(10, 2) not null check (amount_collected > 0),
  city_id           uuid not null references public.cities (id),
  district_id       uuid not null references public.districts (id),
  area_text         text not null check (length(btrim(area_text)) between 1 and 100),
  branch_id         uuid not null references public.branches (id),       -- where the money is handed in (D-31)
  status            text not null check (status in ('approved', 'pending_approval', 'rejected', 'reversed')),
  submitted_at      timestamptz not null default now(),                   -- database clock only (D-30)
  sale_month        date generated always as (app.business_month(submitted_at)) stored,
  approved_at       timestamptz,
  approved_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint sales_client_request_unique unique (client_request_id),
  constraint free_month_is_two_months check (not free_month or months_paid = 2),
  constraint amount_matches check (amount_collected = unit_price * months_paid + installation_fee)
);
-- One non-reversed (approved or pending) sale per customer per month (BR-15, FR-SALE-13).
create unique index sales_one_per_customer_month on public.sales (customer_id, sale_month)
  where status in ('approved', 'pending_approval');
create index sales_agent_month_idx on public.sales (agent_id, sale_month);
create index sales_team_month_idx on public.sales (team_id, sale_month);
create index sales_month_idx on public.sales (sale_month, status);
create trigger sales_touch before update on public.sales for each row execute function app.touch_updated();
comment on table public.sales is 'One sale = one unit (BR-16). Written only by public.create_sale; month from server time (D-30).';

create table public.sale_items (
  sale_id       uuid not null references public.sales (id),
  stock_item_id uuid not null references public.stock_items (id),
  quantity      int not null check (quantity between 1 and 100),
  primary key (sale_id, stock_item_id)
);
create trigger sale_items_append_only before update or delete on public.sale_items for each row execute function app.prevent_change();
comment on table public.sale_items is 'Equipment given on a sale (D-35: quantities); deducted from the team stock in the same transaction.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Phone in E.164 if valid AND its prefix is allowed by the setting (empty list = any Somaliland mobile).
create or replace function app.customer_phone(p_input text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := app.normalize_phone(p_input);
  v_prefixes jsonb := (select value from public.app_settings where key = 'allowed_phone_prefixes');
begin
  if v_phone is null then raise exception 'INVALID_PHONE'; end if;
  if v_prefixes is not null and jsonb_array_length(v_prefixes) > 0
     and not exists (select 1 from jsonb_array_elements_text(v_prefixes) p where substr(v_phone, 5, 2) = p) then
    raise exception 'PHONE_PREFIX';
  end if;
  return v_phone;
end;
$$;

create or replace function app.current_identifier(p_customer uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.customer_identifiers where customer_id = p_customer and kind = p_kind and is_current
$$;

-- Write a duplicate-attempt audit event and build the result returned to the form.
create or replace function app.duplicate_result(p_rule text, p_field text, p_customer uuid, p_attempt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_audit_event(p_rule, 'high', p_attempt, case when p_customer is null then null else 'customers' end, p_customer,
    jsonb_build_object('source', 'create_sale'));
  return jsonb_build_object('status', 'duplicate', 'rule', p_rule, 'field', p_field);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_sale — the only way to register a sale (sales.create)
-- p: { client_request_id, customer_type: 'new'|'retention', full_name, phone, index, city_id?, district_id, area,
--      branch_id, plan_id, months_paid, free_month, items: [{item_id, quantity}] }
-- Any date or agent in p is ignored. Returns { status: 'ok', sale_id, sale_month, sale_status, existing }
-- or { status: 'duplicate', rule, field }. Invalid input raises an error code (nothing is written).
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.sales;
  v_type text := p ->> 'customer_type';
  v_name text := btrim(coalesce(p ->> 'full_name', ''));
  v_phone text;
  v_index text := btrim(coalesce(p ->> 'index', ''));
  v_my_city uuid;
  v_city uuid;
  v_district uuid;
  v_area text := btrim(coalesce(p ->> 'area', ''));
  v_branch uuid;
  v_plan public.plans;
  v_price record;
  v_months int;
  v_free boolean := coalesce((p ->> 'free_month')::boolean, false);
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_team uuid;
  v_phone_owner uuid;
  v_index_owner uuid;
  v_customer uuid;
  v_sale uuid;
  v_month date := app.business_month(now());
  v_attempt jsonb;
  v_constraint text;
begin
  if not app.has_permission('sales.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotency: the same form submitted again returns the first result (FR-SALE-15).
  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.sales where client_request_id = v_request;
  if found then
    if v_existing.agent_id <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
      'sale_status', v_existing.status, 'existing', true);
  end if;

  -- Validation (each failure raises a code; nothing is written).
  if v_type is null or v_type not in ('new', 'retention') then raise exception 'CUSTOMER_TYPE'; end if;
  if length(v_name) < 2 or length(v_name) > 120 or app.normalize_name(v_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_phone := app.customer_phone(p ->> 'phone');
  if v_index !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;

  select city_id into v_my_city from public.user_profiles where id = v_me;
  v_city := coalesce(nullif(p ->> 'city_id', '')::uuid, v_my_city);
  if v_city is null then raise exception 'CITY_REQUIRED'; end if;
  if v_city is distinct from v_my_city and not app.has_permission('sales.override_city') then
    raise exception 'CITY_OVERRIDE';
  end if;
  if not exists (select 1 from public.cities where id = v_city and is_active) then raise exception 'CITY_REQUIRED'; end if;

  v_district := nullif(p ->> 'district_id', '')::uuid;
  if v_district is null or not exists (select 1 from public.districts where id = v_district and city_id = v_city and is_active) then
    raise exception 'DISTRICT_REQUIRED';
  end if;
  if length(v_area) < 1 or length(v_area) > 100 then raise exception 'AREA_REQUIRED'; end if;
  v_branch := nullif(p ->> 'branch_id', '')::uuid;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and is_active) then
    raise exception 'BRANCH_REQUIRED';
  end if;

  select pl.* into v_plan from public.plans pl join public.products pr on pr.id = pl.product_id
   where pl.id = nullif(p ->> 'plan_id', '')::uuid and pl.is_active and pr.is_active;
  if not found then raise exception 'PLAN_REQUIRED'; end if;
  select pp.id, pp.recharge_amount, pp.installation_fee into v_price
    from public.plan_prices pp
   where pp.plan_id = v_plan.id
     and daterange(pp.effective_from, pp.effective_to, '[]') @> (now() at time zone 'Africa/Mogadishu')::date;
  if not found then raise exception 'NO_PRICE'; end if;

  if v_free then
    v_months := 2;
    if 2 * v_price.recharge_amount < (select (value::text)::numeric from public.app_settings where key = 'free_month_amount') then
      raise exception 'FREE_MONTH_NOT_QUALIFIED';
    end if;
  else
    begin
      v_months := (p ->> 'months_paid')::int;
    exception when others then
      raise exception 'MONTHS_PAID';
    end;
    if v_months is null or v_months not between 1 and 12 then raise exception 'MONTHS_PAID'; end if;
  end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  v_attempt := jsonb_build_object('customer_type', v_type, 'full_name', v_name, 'phone', v_phone, 'index', v_index);

  -- Identity resolution (SDD §10.1, D-01, D-36).
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index;

  if v_type = 'new' then
    if v_phone_owner is not null and v_index_owner is not null then
      perform app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
      return app.duplicate_result('DUP_PHONE', 'phone_and_index', v_phone_owner, v_attempt);
    elsif v_phone_owner is not null then
      return app.duplicate_result('DUP_PHONE', 'phone', v_phone_owner, v_attempt);
    elsif v_index_owner is not null then
      return app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
    end if;
  else
    if v_phone_owner is not null and v_index_owner is not null and v_phone_owner <> v_index_owner then
      return app.duplicate_result('IDENTITY_CONFLICT', 'phone_and_index', v_phone_owner, v_attempt || jsonb_build_object('other_customer', v_index_owner));
    end if;
    v_customer := coalesce(v_phone_owner, v_index_owner);
    if v_customer is not null then
      -- One number known: the customer's other number must be the one typed (or not yet recorded).
      if v_phone_owner is null and app.current_identifier(v_customer, 'phone') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'phone', v_customer, v_attempt);
      end if;
      if v_index_owner is null and app.current_identifier(v_customer, 'index') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'index', v_customer, v_attempt);
      end if;
      if not app.names_match(v_name, (select full_name from public.customers where id = v_customer)) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'name', v_customer, v_attempt);
      end if;
      -- A former (replaced) number cannot be used for a sale.
      if (v_phone_owner is not null and app.current_identifier(v_customer, 'phone') <> v_phone)
         or (v_index_owner is not null and app.current_identifier(v_customer, 'index') <> v_index) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'former_number', v_customer, v_attempt);
      end if;
    end if;
  end if;

  if v_customer is not null and exists (
    select 1 from public.sales where customer_id = v_customer and sale_month = v_month and status in ('approved', 'pending_approval')
  ) then
    return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
  end if;

  -- Write everything; a race on phone, Index, month or request id rolls back this block only.
  begin
    if v_customer is null then
      insert into public.customers (full_name, city_id, district_id, area_text, created_by)
      values (v_name, v_city, v_district, v_area, v_me) returning id into v_customer;
    end if;
    if app.current_identifier(v_customer, 'phone') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'phone', v_phone, v_me);
    end if;
    if app.current_identifier(v_customer, 'index') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'index', v_index, v_me);
    end if;

    insert into public.sales (
      client_request_id, customer_id, customer_name, agent_id, team_id, customer_type, product_id, plan_id, plan_price_id,
      unit_price, installation_fee, months_paid, free_month, amount_collected, city_id, district_id, area_text, branch_id,
      status, approved_at)
    values (
      v_request, v_customer, v_name, v_me, v_team, v_type, v_plan.product_id, v_plan.id, v_price.id,
      v_price.recharge_amount, v_price.installation_fee, v_months, v_free,
      v_price.recharge_amount * v_months + v_price.installation_fee, v_city, v_district, v_area, v_branch,
      case when v_type = 'new' then 'approved' else 'pending_approval' end,
      case when v_type = 'new' then now() end)
    returning id into v_sale;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_client_request_unique' then
      select * into v_existing from public.sales where client_request_id = v_request;
      return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
        'sale_status', v_existing.status, 'existing', true);
    elsif v_constraint = 'sales_one_per_customer_month' then
      return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
    else
      -- Another agent registered this phone or Index a moment ago.
      select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone;
      select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index;
      if v_phone_owner is not null then
        return app.duplicate_result(case when v_type = 'new' then 'DUP_PHONE' else 'IDENTITY_CONFLICT' end, 'phone', v_phone_owner, v_attempt);
      end if;
      return app.duplicate_result(case when v_type = 'new' then 'DUP_INDEX' else 'IDENTITY_CONFLICT' end, 'index', v_index_owner, v_attempt);
    end if;
  end;

  -- Equipment from the team's accepted stock, in the same transaction (D-35); short stock aborts everything.
  if jsonb_array_length(v_items) > 0 then
    insert into public.sale_items (sale_id, stock_item_id, quantity)
    select v_sale, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_stock(v_me, v_items, 'sale', v_sale);
  end if;

  perform app.log_activity('sales.create', 'sales', v_sale, jsonb_build_object('customer_type', v_type, 'free_month', v_free));
  return jsonb_build_object('status', 'ok', 'sale_id', v_sale, 'sale_month', v_month,
    'sale_status', case when v_type = 'new' then 'approved' else 'pending_approval' end, 'existing', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Change a customer's phone or Index (customers.change_identity — Super Admin). The old value stays reserved.
-- ---------------------------------------------------------------------------
create or replace function public.change_customer_identifier(p_customer uuid, p_kind text, p_value text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new text;
  v_old text;
begin
  if not app.has_permission('customers.change_identity') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then raise exception 'NOT_FOUND'; end if;
  if p_kind = 'phone' then
    v_new := app.customer_phone(p_value);
  elsif p_kind = 'index' then
    v_new := btrim(coalesce(p_value, ''));
    if v_new !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;
  else
    raise exception 'NOT_FOUND';
  end if;
  v_old := app.current_identifier(p_customer, p_kind);
  if v_old = v_new then return; end if;
  if exists (select 1 from public.customer_identifiers where kind = p_kind and value = v_new) then
    raise exception 'IDENTIFIER_TAKEN';
  end if;
  update public.customer_identifiers
     set is_current = false, replaced_at = now(), replaced_by = auth.uid(), replace_reason = btrim(p_reason)
   where customer_id = p_customer and kind = p_kind and is_current;
  insert into public.customer_identifiers (customer_id, kind, value, created_by) values (p_customer, p_kind, v_new, auth.uid());
  perform app.log_activity('customers.change_identity', 'customers', p_customer,
    jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — reads only; every write goes through the functions above.
--   sales: within the caller's sales.read scope (own / team / city / all).
--   customers + identifiers: customers.read at "all", or a customer with a sale inside the caller's
--   customers.read scope (agents: their own customers).
-- ---------------------------------------------------------------------------
create or replace function app.can_read_customer(p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.permission_scope('customers.read') = 'all'
      or exists (select 1 from public.sales s where s.customer_id = p_customer and app.in_scope('customers.read', s.agent_id))
$$;

alter table public.customers enable row level security;
alter table public.customer_identifiers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

revoke all on public.customers, public.customer_identifiers, public.sales, public.sale_items from anon, authenticated;
grant select on public.customers, public.customer_identifiers, public.sales, public.sale_items to authenticated;

create policy customers_read on public.customers for select to authenticated using (app.can_read_customer(id));
create policy customer_identifiers_read on public.customer_identifiers for select to authenticated using (app.can_read_customer(customer_id));
create policy sales_read on public.sales for select to authenticated using (app.in_scope('sales.read', agent_id));
create policy sale_items_read on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

select app.enable_change_log('public.customers');
select app.enable_change_log('public.customer_identifiers');
select app.enable_change_log('public.sales');
select app.enable_change_log('public.sale_items', 'sale_id');

revoke execute on function app.normalize_name(text), app.levenshtein(text, text), app.names_match(text, text),
  app.customer_phone(text), app.current_identifier(uuid, text), app.duplicate_result(text, text, uuid, jsonb),
  app.can_read_customer(uuid) from public;
grant execute on function app.can_read_customer(uuid) to authenticated;

revoke execute on function public.create_sale(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.change_customer_identifier(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.change_customer_identifier(uuid, text, text, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261024090000', 'sales');

-- ================================ 20261024120000_sales_all_need_approval ================================
-- Phase 7 change (D-37, owner decision 24 Oct 2026): EVERY sale — New and Retention — waits for approval by the
-- agent's Team Leader / Outdoor Supervisor (Super Admin as fallback; never by the seller), and the Supervisor
-- records the equipment given at approval (Phase 8), because the team's stock is in the Supervisor's hands (D-35).
--
--  * public.create_sale: every sale is saved as 'pending_approval' (approved_at empty); the form no longer sends
--    equipment — any "items" in the request are ignored; no stock moves at registration.
--  * Unchanged: identity checks, durable duplicate events, same-month rule (pending sales count), idempotency,
--    server time (D-30), price snapshot (D-34), months paid / free month (D-36).
--  * Phase 8 adds the approval screen: approve with equipment (stock deducted then, refused if short) or reject
--    with a reason; a rejected New sale releases the customer's phone and Index when the customer has no other
--    sale (D-37).

comment on table public.sale_items is 'Equipment given on a sale (D-35 quantities), recorded by the Supervisor at approval (D-37, Phase 8).';

create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.sales;
  v_type text := p ->> 'customer_type';
  v_name text := btrim(coalesce(p ->> 'full_name', ''));
  v_phone text;
  v_index text := btrim(coalesce(p ->> 'index', ''));
  v_my_city uuid;
  v_city uuid;
  v_district uuid;
  v_area text := btrim(coalesce(p ->> 'area', ''));
  v_branch uuid;
  v_plan public.plans;
  v_price record;
  v_months int;
  v_free boolean := coalesce((p ->> 'free_month')::boolean, false);
  v_team uuid;
  v_phone_owner uuid;
  v_index_owner uuid;
  v_customer uuid;
  v_sale uuid;
  v_month date := app.business_month(now());
  v_attempt jsonb;
  v_constraint text;
begin
  if not app.has_permission('sales.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotency: the same form submitted again returns the first result (FR-SALE-15).
  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.sales where client_request_id = v_request;
  if found then
    if v_existing.agent_id <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
      'sale_status', v_existing.status, 'existing', true);
  end if;

  -- Validation (each failure raises a code; nothing is written).
  if v_type is null or v_type not in ('new', 'retention') then raise exception 'CUSTOMER_TYPE'; end if;
  if length(v_name) < 2 or length(v_name) > 120 or app.normalize_name(v_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_phone := app.customer_phone(p ->> 'phone');
  if v_index !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;

  select city_id into v_my_city from public.user_profiles where id = v_me;
  v_city := coalesce(nullif(p ->> 'city_id', '')::uuid, v_my_city);
  if v_city is null then raise exception 'CITY_REQUIRED'; end if;
  if v_city is distinct from v_my_city and not app.has_permission('sales.override_city') then
    raise exception 'CITY_OVERRIDE';
  end if;
  if not exists (select 1 from public.cities where id = v_city and is_active) then raise exception 'CITY_REQUIRED'; end if;

  v_district := nullif(p ->> 'district_id', '')::uuid;
  if v_district is null or not exists (select 1 from public.districts where id = v_district and city_id = v_city and is_active) then
    raise exception 'DISTRICT_REQUIRED';
  end if;
  if length(v_area) < 1 or length(v_area) > 100 then raise exception 'AREA_REQUIRED'; end if;
  v_branch := nullif(p ->> 'branch_id', '')::uuid;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and is_active) then
    raise exception 'BRANCH_REQUIRED';
  end if;

  select pl.* into v_plan from public.plans pl join public.products pr on pr.id = pl.product_id
   where pl.id = nullif(p ->> 'plan_id', '')::uuid and pl.is_active and pr.is_active;
  if not found then raise exception 'PLAN_REQUIRED'; end if;
  select pp.id, pp.recharge_amount, pp.installation_fee into v_price
    from public.plan_prices pp
   where pp.plan_id = v_plan.id
     and daterange(pp.effective_from, pp.effective_to, '[]') @> (now() at time zone 'Africa/Mogadishu')::date;
  if not found then raise exception 'NO_PRICE'; end if;

  if v_free then
    v_months := 2;
    if 2 * v_price.recharge_amount < (select (value::text)::numeric from public.app_settings where key = 'free_month_amount') then
      raise exception 'FREE_MONTH_NOT_QUALIFIED';
    end if;
  else
    begin
      v_months := (p ->> 'months_paid')::int;
    exception when others then
      raise exception 'MONTHS_PAID';
    end;
    if v_months is null or v_months not between 1 and 12 then raise exception 'MONTHS_PAID'; end if;
  end if;

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  v_attempt := jsonb_build_object('customer_type', v_type, 'full_name', v_name, 'phone', v_phone, 'index', v_index);

  -- Identity resolution (SDD §10.1, D-01, D-36).
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index;

  if v_type = 'new' then
    if v_phone_owner is not null and v_index_owner is not null then
      perform app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
      return app.duplicate_result('DUP_PHONE', 'phone_and_index', v_phone_owner, v_attempt);
    elsif v_phone_owner is not null then
      return app.duplicate_result('DUP_PHONE', 'phone', v_phone_owner, v_attempt);
    elsif v_index_owner is not null then
      return app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
    end if;
  else
    if v_phone_owner is not null and v_index_owner is not null and v_phone_owner <> v_index_owner then
      return app.duplicate_result('IDENTITY_CONFLICT', 'phone_and_index', v_phone_owner, v_attempt || jsonb_build_object('other_customer', v_index_owner));
    end if;
    v_customer := coalesce(v_phone_owner, v_index_owner);
    if v_customer is not null then
      -- One number known: the customer's other number must be the one typed (or not yet recorded).
      if v_phone_owner is null and app.current_identifier(v_customer, 'phone') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'phone', v_customer, v_attempt);
      end if;
      if v_index_owner is null and app.current_identifier(v_customer, 'index') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'index', v_customer, v_attempt);
      end if;
      if not app.names_match(v_name, (select full_name from public.customers where id = v_customer)) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'name', v_customer, v_attempt);
      end if;
      -- A former (replaced) number cannot be used for a sale.
      if (v_phone_owner is not null and app.current_identifier(v_customer, 'phone') <> v_phone)
         or (v_index_owner is not null and app.current_identifier(v_customer, 'index') <> v_index) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'former_number', v_customer, v_attempt);
      end if;
    end if;
  end if;

  if v_customer is not null and exists (
    select 1 from public.sales where customer_id = v_customer and sale_month = v_month and status in ('approved', 'pending_approval')
  ) then
    return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
  end if;

  -- Write everything; a race on phone, Index, month or request id rolls back this block only.
  begin
    if v_customer is null then
      insert into public.customers (full_name, city_id, district_id, area_text, created_by)
      values (v_name, v_city, v_district, v_area, v_me) returning id into v_customer;
    end if;
    if app.current_identifier(v_customer, 'phone') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'phone', v_phone, v_me);
    end if;
    if app.current_identifier(v_customer, 'index') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'index', v_index, v_me);
    end if;

    insert into public.sales (
      client_request_id, customer_id, customer_name, agent_id, team_id, customer_type, product_id, plan_id, plan_price_id,
      unit_price, installation_fee, months_paid, free_month, amount_collected, city_id, district_id, area_text, branch_id,
      status, approved_at)
    values (
      v_request, v_customer, v_name, v_me, v_team, v_type, v_plan.product_id, v_plan.id, v_price.id,
      v_price.recharge_amount, v_price.installation_fee, v_months, v_free,
      v_price.recharge_amount * v_months + v_price.installation_fee, v_city, v_district, v_area, v_branch,
      'pending_approval',
      null)
    returning id into v_sale;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_client_request_unique' then
      select * into v_existing from public.sales where client_request_id = v_request;
      return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
        'sale_status', v_existing.status, 'existing', true);
    elsif v_constraint = 'sales_one_per_customer_month' then
      return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
    else
      -- Another agent registered this phone or Index a moment ago.
      select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone;
      select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index;
      if v_phone_owner is not null then
        return app.duplicate_result(case when v_type = 'new' then 'DUP_PHONE' else 'IDENTITY_CONFLICT' end, 'phone', v_phone_owner, v_attempt);
      end if;
      return app.duplicate_result(case when v_type = 'new' then 'DUP_INDEX' else 'IDENTITY_CONFLICT' end, 'index', v_index_owner, v_attempt);
    end if;
  end;

  perform app.log_activity('sales.create', 'sales', v_sale, jsonb_build_object('customer_type', v_type, 'free_month', v_free));
  return jsonb_build_object('status', 'ok', 'sale_id', v_sale, 'sale_month', v_month,
    'sale_status', 'pending_approval', 'existing', false);
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261024120000', 'sales_all_need_approval');

-- ================================ 20261025090000_approvals_switches ================================
-- Phase 8 — Sale approval with equipment, product switch, in-app notifications
-- (BRD §6.4 FR-SALE-07/08, §6.10 FR-SW-01…06, §6.16 FR-NOT-03; SDD §10.3, §10.4, §18; D-14, D-16, D-35, D-37, D-38)
--
--  * Every sale waits for the agent's Team Leader / Outdoor Supervisor (D-37); Super Admin is the fallback and
--    decides the Team Leaders' own sales. Nobody approves their own sale. (A Super Admin may reject — cancel — a
--    sale of their own; approving one's own sale is always refused.)
--  * Approval records the equipment given; it is deducted from the SALE's team stock in the same transaction and
--    refused if short (FR-SALE-08, FR-STK-03). Approver can only approve or reject (with a reason).
--  * A rejected New sale releases the customer's phone and Index when the customer has no other sale (D-37).
--    Former numbers replaced by Super Admin stay reserved (BR-01); only released numbers can be used again.
--  * D-38 (owner, 25 Oct 2026): Super Admins do not register sales or switches; product switch FTTA ↔ FTTH goes
--    to the Supervisor like a sale (equipment at approval); the agent picks the new plan, no payment; "from"
--    product must be the customer's current product (latest approved sale or switch).
--  * A switch is never a sale, unit or revenue (D-16). Old equipment is returned via the Stock Officer (D-35).
--  * notifications: in-app messages (sale/switch awaiting decision, decided, stock to accept) — SDD §18.

-- ---------------------------------------------------------------------------
-- Releasable identifiers (D-37)
-- ---------------------------------------------------------------------------
alter table public.customer_identifiers
  add column released_at timestamptz,
  add column released_by uuid;
alter table public.customer_identifiers drop constraint identifier_unique;
create unique index customer_identifiers_unique_live on public.customer_identifiers (kind, value) where released_at is null;
comment on column public.customer_identifiers.released_at is
  'Set when a rejected New sale released the number (D-37); a released number may be registered again. Replaced numbers are never released (BR-01).';

-- Identity checks ignore released numbers; Super Admins do not sell (D-38).
create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.sales;
  v_type text := p ->> 'customer_type';
  v_name text := btrim(coalesce(p ->> 'full_name', ''));
  v_phone text;
  v_index text := btrim(coalesce(p ->> 'index', ''));
  v_my_city uuid;
  v_city uuid;
  v_district uuid;
  v_area text := btrim(coalesce(p ->> 'area', ''));
  v_branch uuid;
  v_plan public.plans;
  v_price record;
  v_months int;
  v_free boolean := coalesce((p ->> 'free_month')::boolean, false);
  v_team uuid;
  v_phone_owner uuid;
  v_index_owner uuid;
  v_customer uuid;
  v_sale uuid;
  v_month date := app.business_month(now());
  v_attempt jsonb;
  v_constraint text;
begin
  if not app.has_permission('sales.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  -- D-38: Super Admins do not register sales (nobody could approve them).
  if app.is_super_admin(v_me) then raise exception 'SUPER_ADMIN_NO_SALES'; end if;

  -- Idempotency: the same form submitted again returns the first result (FR-SALE-15).
  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.sales where client_request_id = v_request;
  if found then
    if v_existing.agent_id <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
      'sale_status', v_existing.status, 'existing', true);
  end if;

  -- Validation (each failure raises a code; nothing is written).
  if v_type is null or v_type not in ('new', 'retention') then raise exception 'CUSTOMER_TYPE'; end if;
  if length(v_name) < 2 or length(v_name) > 120 or app.normalize_name(v_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_phone := app.customer_phone(p ->> 'phone');
  if v_index !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;

  select city_id into v_my_city from public.user_profiles where id = v_me;
  v_city := coalesce(nullif(p ->> 'city_id', '')::uuid, v_my_city);
  if v_city is null then raise exception 'CITY_REQUIRED'; end if;
  if v_city is distinct from v_my_city and not app.has_permission('sales.override_city') then
    raise exception 'CITY_OVERRIDE';
  end if;
  if not exists (select 1 from public.cities where id = v_city and is_active) then raise exception 'CITY_REQUIRED'; end if;

  v_district := nullif(p ->> 'district_id', '')::uuid;
  if v_district is null or not exists (select 1 from public.districts where id = v_district and city_id = v_city and is_active) then
    raise exception 'DISTRICT_REQUIRED';
  end if;
  if length(v_area) < 1 or length(v_area) > 100 then raise exception 'AREA_REQUIRED'; end if;
  v_branch := nullif(p ->> 'branch_id', '')::uuid;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and is_active) then
    raise exception 'BRANCH_REQUIRED';
  end if;

  select pl.* into v_plan from public.plans pl join public.products pr on pr.id = pl.product_id
   where pl.id = nullif(p ->> 'plan_id', '')::uuid and pl.is_active and pr.is_active;
  if not found then raise exception 'PLAN_REQUIRED'; end if;
  select pp.id, pp.recharge_amount, pp.installation_fee into v_price
    from public.plan_prices pp
   where pp.plan_id = v_plan.id
     and daterange(pp.effective_from, pp.effective_to, '[]') @> (now() at time zone 'Africa/Mogadishu')::date;
  if not found then raise exception 'NO_PRICE'; end if;

  if v_free then
    v_months := 2;
    if 2 * v_price.recharge_amount < (select (value::text)::numeric from public.app_settings where key = 'free_month_amount') then
      raise exception 'FREE_MONTH_NOT_QUALIFIED';
    end if;
  else
    begin
      v_months := (p ->> 'months_paid')::int;
    exception when others then
      raise exception 'MONTHS_PAID';
    end;
    if v_months is null or v_months not between 1 and 12 then raise exception 'MONTHS_PAID'; end if;
  end if;

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  v_attempt := jsonb_build_object('customer_type', v_type, 'full_name', v_name, 'phone', v_phone, 'index', v_index);

  -- Identity resolution (SDD §10.1, D-01, D-36).
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and released_at is null;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and released_at is null;

  if v_type = 'new' then
    if v_phone_owner is not null and v_index_owner is not null then
      perform app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
      return app.duplicate_result('DUP_PHONE', 'phone_and_index', v_phone_owner, v_attempt);
    elsif v_phone_owner is not null then
      return app.duplicate_result('DUP_PHONE', 'phone', v_phone_owner, v_attempt);
    elsif v_index_owner is not null then
      return app.duplicate_result('DUP_INDEX', 'index', v_index_owner, v_attempt);
    end if;
  else
    if v_phone_owner is not null and v_index_owner is not null and v_phone_owner <> v_index_owner then
      return app.duplicate_result('IDENTITY_CONFLICT', 'phone_and_index', v_phone_owner, v_attempt || jsonb_build_object('other_customer', v_index_owner));
    end if;
    v_customer := coalesce(v_phone_owner, v_index_owner);
    if v_customer is not null then
      -- One number known: the customer's other number must be the one typed (or not yet recorded).
      if v_phone_owner is null and app.current_identifier(v_customer, 'phone') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'phone', v_customer, v_attempt);
      end if;
      if v_index_owner is null and app.current_identifier(v_customer, 'index') is not null then
        return app.duplicate_result('IDENTITY_CONFLICT', 'index', v_customer, v_attempt);
      end if;
      if not app.names_match(v_name, (select full_name from public.customers where id = v_customer)) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'name', v_customer, v_attempt);
      end if;
      -- A former (replaced) number cannot be used for a sale.
      if (v_phone_owner is not null and app.current_identifier(v_customer, 'phone') <> v_phone)
         or (v_index_owner is not null and app.current_identifier(v_customer, 'index') <> v_index) then
        return app.duplicate_result('IDENTITY_CONFLICT', 'former_number', v_customer, v_attempt);
      end if;
    end if;
  end if;

  if v_customer is not null and exists (
    select 1 from public.sales where customer_id = v_customer and sale_month = v_month and status in ('approved', 'pending_approval')
  ) then
    return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
  end if;

  -- Write everything; a race on phone, Index, month or request id rolls back this block only.
  begin
    if v_customer is null then
      insert into public.customers (full_name, city_id, district_id, area_text, created_by)
      values (v_name, v_city, v_district, v_area, v_me) returning id into v_customer;
    end if;
    if app.current_identifier(v_customer, 'phone') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'phone', v_phone, v_me);
    end if;
    if app.current_identifier(v_customer, 'index') is null then
      insert into public.customer_identifiers (customer_id, kind, value, created_by) values (v_customer, 'index', v_index, v_me);
    end if;

    insert into public.sales (
      client_request_id, customer_id, customer_name, agent_id, team_id, customer_type, product_id, plan_id, plan_price_id,
      unit_price, installation_fee, months_paid, free_month, amount_collected, city_id, district_id, area_text, branch_id,
      status, approved_at)
    values (
      v_request, v_customer, v_name, v_me, v_team, v_type, v_plan.product_id, v_plan.id, v_price.id,
      v_price.recharge_amount, v_price.installation_fee, v_months, v_free,
      v_price.recharge_amount * v_months + v_price.installation_fee, v_city, v_district, v_area, v_branch,
      'pending_approval',
      null)
    returning id into v_sale;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_client_request_unique' then
      select * into v_existing from public.sales where client_request_id = v_request;
      return jsonb_build_object('status', 'ok', 'sale_id', v_existing.id, 'sale_month', v_existing.sale_month,
        'sale_status', v_existing.status, 'existing', true);
    elsif v_constraint = 'sales_one_per_customer_month' then
      return app.duplicate_result('SAME_MONTH', 'month', v_customer, v_attempt);
    else
      -- Another agent registered this phone or Index a moment ago.
      select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and released_at is null;
      select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and released_at is null;
      if v_phone_owner is not null then
        return app.duplicate_result(case when v_type = 'new' then 'DUP_PHONE' else 'IDENTITY_CONFLICT' end, 'phone', v_phone_owner, v_attempt);
      end if;
      return app.duplicate_result(case when v_type = 'new' then 'DUP_INDEX' else 'IDENTITY_CONFLICT' end, 'index', v_index_owner, v_attempt);
    end if;
  end;

  perform app.log_activity('sales.create', 'sales', v_sale, jsonb_build_object('customer_type', v_type, 'free_month', v_free));
  return jsonb_build_object('status', 'ok', 'sale_id', v_sale, 'sale_month', v_month,
    'sale_status', 'pending_approval', 'existing', false);
end;
$$;

create or replace function public.change_customer_identifier(p_customer uuid, p_kind text, p_value text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new text;
  v_old text;
begin
  if not app.has_permission('customers.change_identity') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then raise exception 'NOT_FOUND'; end if;
  if p_kind = 'phone' then
    v_new := app.customer_phone(p_value);
  elsif p_kind = 'index' then
    v_new := btrim(coalesce(p_value, ''));
    if v_new !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;
  else
    raise exception 'NOT_FOUND';
  end if;
  v_old := app.current_identifier(p_customer, p_kind);
  if v_old = v_new then return; end if;
  if exists (select 1 from public.customer_identifiers where kind = p_kind and value = v_new and released_at is null) then
    raise exception 'IDENTIFIER_TAKEN';
  end if;
  update public.customer_identifiers
     set is_current = false, replaced_at = now(), replaced_by = auth.uid(), replace_reason = btrim(p_reason)
   where customer_id = p_customer and kind = p_kind and is_current;
  insert into public.customer_identifiers (customer_id, kind, value, created_by) values (p_customer, p_kind, v_new, auth.uid());
  perform app.log_activity('customers.change_identity', 'customers', p_customer,
    jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)));
end;
$$;

update public.permissions set description = 'Approve or reject sales and product switches (own team; Super Admin: all)'
 where key = 'retention.review';

-- ---------------------------------------------------------------------------
-- Notifications (SDD §18)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles (id),
  kind        text not null check (kind in ('sale_pending', 'sale_approved', 'sale_rejected', 'switch_pending',
                'switch_approved', 'switch_rejected', 'stock_to_accept')),
  entity_type text not null check (entity_type in ('sales', 'product_switches', 'stock_transfers')),
  entity_id   uuid not null,
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
comment on table public.notifications is 'In-app notifications (SDD §18). No customer phone or Index in data.';

create or replace function app.notify(p_user uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, entity_type, entity_id, data)
  select p_user, p_kind, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb)
  where p_user is not null
$$;

-- Who decides a sale or switch of this agent: the active leader of its team (not the agent), else every active
-- Super Admin (fallback; also for Team Leaders' own sales).
create or replace function app.approvers_for(p_agent uuid, p_team uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with leader as (
    select t.team_leader_id as id
    from public.teams t join public.user_profiles p on p.id = t.team_leader_id
    where t.id = p_team and t.is_active and p.is_active and t.team_leader_id <> p_agent
  )
  select id from leader
  union all
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active and not exists (select 1 from leader) and ur.user_id <> p_agent
$$;

create or replace function app.agent_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select full_name from public.user_profiles where id = p_user
$$;

create or replace function app.notify_new_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending_approval' then
    perform app.notify(a, 'sale_pending', 'sales', new.id,
      jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
    from app.approvers_for(new.agent_id, new.team_id) a;
  end if;
  return new;
end;
$$;
create trigger sales_notify_approvers after insert on public.sales for each row execute function app.notify_new_sale();

create or replace function app.notify_stock_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(t.team_leader_id, 'stock_to_accept', 'stock_transfers', new.id, '{}'::jsonb)
  from public.stock_locations l join public.teams t on t.id = l.team_id
  where l.id = new.to_location_id;
  return new;
end;
$$;
create trigger stock_transfers_notify after insert on public.stock_transfers for each row execute function app.notify_stock_issue();

-- Mark the caller's notifications read (all, or the given ones).
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions (approval history, append-only)
-- ---------------------------------------------------------------------------
create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('sales', 'product_switches')),
  entity_id   uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  reason      text check (reason is null or length(reason) <= 500),
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  decided_by  uuid not null,
  decided_at  timestamptz not null default now()
);
create index approvals_entity_idx on public.approvals (entity_type, entity_id);
create trigger approvals_append_only before update or delete on public.approvals for each row execute function app.prevent_change();
comment on table public.approvals is 'Every approve / reject decision on a sale or switch, with the equipment recorded (FR-SALE-09).';

-- May the caller decide this agent's sale/switch? Approve: never one's own. Reject: a Super Admin may cancel
-- their own; nobody else may decide their own.
create or replace function app.check_decider(p_agent uuid, p_team uuid, p_approve boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sa boolean := app.is_super_admin(v_me);
begin
  if not app.has_permission('retention.review') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_me = p_agent and (p_approve or not v_sa) then
    raise exception 'SELF_APPROVAL';
  end if;
  if v_sa then return; end if;
  if not exists (select 1 from public.teams t where t.id = p_team and t.is_active and t.team_leader_id = v_me) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Equipment from a team's accepted stock (all lines or none; never below zero).
create or replace function app.issue_from_team(p_team uuid, p_lines jsonb, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := (select id from public.stock_locations where team_id = p_team);
  v_line record;
begin
  if v_from is null then raise exception 'NO_TEAM_STOCK'; end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('issue', v_line.item_id, v_line.quantity, v_from, null, p_ref_type, p_ref_id);
  end loop;
end;
$$;

-- Approve a sale and record the equipment given (FR-SALE-07/08, D-37).
create or replace function public.approve_sale(p_sale uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_sale.agent_id, v_sale.team_id, true);
  if v_sale.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.sale_items (sale_id, stock_item_id, quantity)
    select p_sale, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_sale.team_id, v_items, 'sale', p_sale);
  end if;

  update public.sales set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_sale;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('sales', p_sale, 'approved', v_items, auth.uid());
  perform app.notify(v_sale.agent_id, 'sale_approved', 'sales', p_sale, jsonb_build_object('customer', v_sale.customer_name));
  perform app.log_activity('sales.approve', 'sales', p_sale, jsonb_build_object('items', v_items));
end;
$$;

-- Reject a sale with a reason. A rejected New sale releases the customer's numbers if the customer has no other
-- sale (D-37).
create or replace function public.reject_sale(p_sale uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_released boolean := false;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_sale.agent_id, v_sale.team_id, false);
  if v_sale.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;

  update public.sales set status = 'rejected' where id = p_sale;
  if v_sale.customer_type = 'new' and not exists (
    select 1 from public.sales s where s.customer_id = v_sale.customer_id and s.id <> p_sale and s.status <> 'rejected'
  ) and not exists (select 1 from public.product_switches w where w.customer_id = v_sale.customer_id) then
    update public.customer_identifiers
       set is_current = false, released_at = now(), released_by = auth.uid(), replace_reason = 'Released: New sale rejected'
     where customer_id = v_sale.customer_id and released_at is null;
    v_released := true;
  end if;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('sales', p_sale, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_sale.agent_id, 'sale_rejected', 'sales', p_sale,
    jsonb_build_object('customer', v_sale.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('sales.reject', 'sales', p_sale, jsonb_build_object('released_numbers', v_released));
end;
$$;

-- ---------------------------------------------------------------------------
-- Product switch (D-16, D-38)
-- ---------------------------------------------------------------------------
create table public.product_switches (
  id                uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  customer_id       uuid not null references public.customers (id),
  customer_name     text not null,
  agent_id          uuid not null references public.user_profiles (id),
  team_id           uuid references public.teams (id),
  from_product_id   uuid not null references public.products (id),
  to_product_id     uuid not null references public.products (id),
  to_plan_id        uuid not null references public.plans (id),
  city_id           uuid not null references public.cities (id),
  branch_id         uuid not null references public.branches (id),
  status            text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  submitted_at      timestamptz not null default now(),
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint switch_request_unique unique (client_request_id),
  constraint switch_changes_product check (from_product_id <> to_product_id)
);
create unique index product_switches_one_pending on public.product_switches (customer_id) where status = 'pending_approval';
create index product_switches_agent_idx on public.product_switches (agent_id, submitted_at desc);
create trigger product_switches_touch before update on public.product_switches for each row execute function app.touch_updated();
comment on table public.product_switches is 'FTTA ↔ FTTH product changes (D-16). Never a sale, unit or revenue.';

create table public.switch_items (
  switch_id     uuid not null references public.product_switches (id),
  stock_item_id uuid not null references public.stock_items (id),
  quantity      int not null check (quantity between 1 and 100),
  primary key (switch_id, stock_item_id)
);
create trigger switch_items_append_only before update or delete on public.switch_items for each row execute function app.prevent_change();

-- The customer's product now: the latest approved sale or approved switch.
create or replace function app.current_product(p_customer uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select product_id from (
    select s.product_id, coalesce(s.approved_at, s.submitted_at) as at
    from public.sales s where s.customer_id = p_customer and s.status = 'approved'
    union all
    select w.to_product_id, w.decided_at
    from public.product_switches w where w.customer_id = p_customer and w.status = 'approved'
  ) x
  order by at desc
  limit 1
$$;

create or replace function app.notify_new_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'switch_pending', 'product_switches', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
  from app.approvers_for(new.agent_id, new.team_id) a;
  return new;
end;
$$;
create trigger product_switches_notify after insert on public.product_switches for each row execute function app.notify_new_switch();

-- Register a switch (switches.create). p: { client_request_id, full_name, phone, index, from_product_id,
-- to_product_id, to_plan_id, city_id?, branch_id }. Returns { status: 'ok', switch_id, existing } or
-- { status: 'mismatch', field } (with a durable SWITCH_MISMATCH audit event, UAT-12).
create or replace function public.create_switch(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.product_switches;
  v_name text := btrim(coalesce(p ->> 'full_name', ''));
  v_phone text;
  v_index text := btrim(coalesce(p ->> 'index', ''));
  v_phone_owner uuid;
  v_index_owner uuid;
  v_customer uuid;
  v_from public.products;
  v_to public.products;
  v_plan uuid;
  v_my_city uuid;
  v_city uuid;
  v_branch uuid;
  v_team uuid;
  v_id uuid;
  v_attempt jsonb;
begin
  if not app.has_permission('switches.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if app.is_super_admin(v_me) then raise exception 'SUPER_ADMIN_NO_SALES'; end if;

  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.product_switches where client_request_id = v_request;
  if found then
    if v_existing.agent_id <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('status', 'ok', 'switch_id', v_existing.id, 'existing', true);
  end if;

  if length(v_name) < 2 or length(v_name) > 120 or app.normalize_name(v_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_phone := app.customer_phone(p ->> 'phone');
  if v_index !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;

  select * into v_from from public.products where id = nullif(p ->> 'from_product_id', '')::uuid;
  select * into v_to from public.products where id = nullif(p ->> 'to_product_id', '')::uuid and is_active;
  if v_from.id is null or v_to.id is null or v_from.code not in ('FTTA', 'FTTH') or v_to.code not in ('FTTA', 'FTTH') then
    raise exception 'SWITCH_PRODUCTS';
  end if;
  if v_from.id = v_to.id then raise exception 'SAME_PRODUCT'; end if;
  v_plan := nullif(p ->> 'to_plan_id', '')::uuid;
  if v_plan is null or not exists (select 1 from public.plans where id = v_plan and product_id = v_to.id and is_active) then
    raise exception 'PLAN_REQUIRED';
  end if;

  select city_id into v_my_city from public.user_profiles where id = v_me;
  v_city := coalesce(nullif(p ->> 'city_id', '')::uuid, v_my_city);
  if v_city is null then raise exception 'CITY_REQUIRED'; end if;
  if v_city is distinct from v_my_city and not app.has_permission('sales.override_city') then raise exception 'CITY_OVERRIDE'; end if;
  if not exists (select 1 from public.cities where id = v_city and is_active) then raise exception 'CITY_REQUIRED'; end if;
  v_branch := nullif(p ->> 'branch_id', '')::uuid;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and is_active) then raise exception 'BRANCH_REQUIRED'; end if;

  -- Identity must match one existing customer exactly (FR-SW-03): phone, Index and name.
  v_attempt := jsonb_build_object('full_name', v_name, 'phone', v_phone, 'index', v_index,
    'from_product', v_from.code, 'to_product', v_to.code);
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and is_current and released_at is null;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and is_current and released_at is null;
  if v_phone_owner is null or v_index_owner is null or v_phone_owner <> v_index_owner then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, case when coalesce(v_phone_owner, v_index_owner) is null then null else 'customers' end,
      coalesce(v_phone_owner, v_index_owner), jsonb_build_object('source', 'create_switch', 'field', 'phone_or_index'));
    return jsonb_build_object('status', 'mismatch', 'field', 'phone_or_index');
  end if;
  v_customer := v_phone_owner;
  if not app.names_match(v_name, (select full_name from public.customers where id = v_customer)) then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, 'customers', v_customer, jsonb_build_object('source', 'create_switch', 'field', 'name'));
    return jsonb_build_object('status', 'mismatch', 'field', 'name');
  end if;
  if app.current_product(v_customer) is distinct from v_from.id then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, 'customers', v_customer, jsonb_build_object('source', 'create_switch', 'field', 'product'));
    return jsonb_build_object('status', 'mismatch', 'field', 'product');
  end if;
  if exists (select 1 from public.product_switches where customer_id = v_customer and status = 'pending_approval') then
    raise exception 'SWITCH_PENDING';
  end if;

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  begin
    insert into public.product_switches (client_request_id, customer_id, customer_name, agent_id, team_id, from_product_id,
      to_product_id, to_plan_id, city_id, branch_id)
    values (v_request, v_customer, v_name, v_me, v_team, v_from.id, v_to.id, v_plan, v_city, v_branch)
    returning id into v_id;
  exception when unique_violation then
    select * into v_existing from public.product_switches where client_request_id = v_request;
    if found then return jsonb_build_object('status', 'ok', 'switch_id', v_existing.id, 'existing', true); end if;
    raise exception 'SWITCH_PENDING';
  end;
  perform app.log_activity('switches.create', 'product_switches', v_id, jsonb_build_object('from', v_from.code, 'to', v_to.code));
  return jsonb_build_object('status', 'ok', 'switch_id', v_id, 'existing', false);
end;
$$;

create or replace function public.approve_switch(p_switch uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_switch.agent_id, v_switch.team_id, true);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;
  -- The customer's product may have changed since submission.
  if app.current_product(v_switch.customer_id) is distinct from v_switch.from_product_id then raise exception 'SWITCH_STALE'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.switch_items (switch_id, stock_item_id, quantity)
    select p_switch, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_switch.team_id, v_items, 'switch', p_switch);
  end if;
  update public.product_switches set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('product_switches', p_switch, 'approved', v_items, auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_approved', 'product_switches', p_switch, jsonb_build_object('customer', v_switch.customer_name));
  perform app.log_activity('switches.approve', 'product_switches', p_switch, jsonb_build_object('items', v_items));
end;
$$;

create or replace function public.reject_switch(p_switch uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_switch.agent_id, v_switch.team_id, false);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  update public.product_switches set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('product_switches', p_switch, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_rejected', 'product_switches', p_switch,
    jsonb_build_object('customer', v_switch.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('switches.reject', 'product_switches', p_switch);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.approvals enable row level security;
alter table public.product_switches enable row level security;
alter table public.switch_items enable row level security;

revoke all on public.notifications, public.approvals, public.product_switches, public.switch_items from anon, authenticated;
grant select on public.notifications, public.approvals, public.product_switches, public.switch_items to authenticated;

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_active_user());
create policy product_switches_read on public.product_switches for select to authenticated
  using (app.in_scope('sales.read', agent_id));
create policy switch_items_read on public.switch_items for select to authenticated
  using (exists (select 1 from public.product_switches w where w.id = switch_id));
create policy approvals_read on public.approvals for select to authenticated
  using ((entity_type = 'sales' and exists (select 1 from public.sales s where s.id = entity_id))
      or (entity_type = 'product_switches' and exists (select 1 from public.product_switches w where w.id = entity_id)));

select app.enable_change_log('public.notifications');
select app.enable_change_log('public.approvals');
select app.enable_change_log('public.product_switches');
select app.enable_change_log('public.switch_items', 'switch_id');

revoke execute on function app.notify(uuid, text, text, uuid, jsonb), app.approvers_for(uuid, uuid), app.agent_name(uuid),
  app.notify_new_sale(), app.notify_stock_issue(), app.notify_new_switch(), app.check_decider(uuid, uuid, boolean),
  app.issue_from_team(uuid, jsonb, text, uuid), app.current_product(uuid) from public;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon, authenticated, service_role;
revoke execute on function public.approve_sale(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.reject_sale(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.create_switch(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.approve_switch(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.reject_switch(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.approve_sale(uuid, jsonb) to authenticated;
grant execute on function public.reject_sale(uuid, text) to authenticated;
grant execute on function public.create_switch(jsonb) to authenticated;
grant execute on function public.approve_switch(uuid, jsonb) to authenticated;
grant execute on function public.reject_switch(uuid, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261025090000', 'approvals_switches');

-- ================================ 20261025120000_product_equipment ================================
-- Phase 8 change (D-39, owner decision 25 Oct 2026): the equipment given at approval depends on the product.
--   FTTA          → exactly 1 WiFi Router
--   FTTH, FTTB    → exactly 1 PDCOM or 1 CALIX
--   LTE           → no equipment from stock
-- Product switches follow the product switched TO. The rule is data (product_equipment), checked in
-- approve_sale / approve_switch before any stock moves.

create table public.product_equipment (
  product_id    uuid not null references public.products (id),
  stock_item_id uuid not null references public.stock_items (id),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  primary key (product_id, stock_item_id)
);
comment on table public.product_equipment is
  'Equipment allowed per product (D-39). A product with rows needs exactly one of them at approval; a product without rows takes none.';

insert into public.product_equipment (product_id, stock_item_id)
select p.id, i.id
from (values ('FTTA', 'WIFI_ROUTER'), ('FTTH', 'PDCOM'), ('FTTH', 'CALIX'), ('FTTB', 'PDCOM'), ('FTTB', 'CALIX')) as r (product, item)
join public.products p on p.code = r.product
join public.stock_items i on i.code = r.item;

alter table public.product_equipment enable row level security;
revoke all on public.product_equipment from anon, authenticated;
grant select on public.product_equipment to authenticated;
create policy product_equipment_read on public.product_equipment for select to authenticated using (app.is_active_user());
select app.enable_change_log('public.product_equipment', 'product_id');

-- Exactly one allowed device when the product has a rule; none when it has none.
create or replace function app.check_equipment(p_product uuid, p_items jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needs boolean := exists (select 1 from public.product_equipment where product_id = p_product);
  v_count int := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  if not v_needs then
    if v_count > 0 then raise exception 'EQUIPMENT_NOT_ALLOWED'; end if;
    return;
  end if;
  if v_count = 0 then raise exception 'EQUIPMENT_REQUIRED'; end if;
  if v_count > 1 or (p_items -> 0 ->> 'quantity') is distinct from '1' then raise exception 'EQUIPMENT_ONE'; end if;
  if not exists (
    select 1 from public.product_equipment
    where product_id = p_product and stock_item_id::text = (p_items -> 0 ->> 'item_id')
  ) then
    raise exception 'EQUIPMENT_NOT_ALLOWED';
  end if;
end;
$$;
revoke execute on function app.check_equipment(uuid, jsonb) from public;

create or replace function public.approve_sale(p_sale uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_sale.agent_id, v_sale.team_id, true);
  if v_sale.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;
  perform app.check_equipment(v_sale.product_id, v_items); -- D-39

  if jsonb_array_length(v_items) > 0 then
    insert into public.sale_items (sale_id, stock_item_id, quantity)
    select p_sale, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_sale.team_id, v_items, 'sale', p_sale);
  end if;

  update public.sales set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_sale;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('sales', p_sale, 'approved', v_items, auth.uid());
  perform app.notify(v_sale.agent_id, 'sale_approved', 'sales', p_sale, jsonb_build_object('customer', v_sale.customer_name));
  perform app.log_activity('sales.approve', 'sales', p_sale, jsonb_build_object('items', v_items));
end;
$$;

create or replace function public.approve_switch(p_switch uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_switch.agent_id, v_switch.team_id, true);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;
  perform app.check_equipment(v_switch.to_product_id, v_items); -- D-39
  -- The customer's product may have changed since submission.
  if app.current_product(v_switch.customer_id) is distinct from v_switch.from_product_id then raise exception 'SWITCH_STALE'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.switch_items (switch_id, stock_item_id, quantity)
    select p_switch, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_switch.team_id, v_items, 'switch', p_switch);
  end if;
  update public.product_switches set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('product_switches', p_switch, 'approved', v_items, auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_approved', 'product_switches', p_switch, jsonb_build_object('customer', v_switch.customer_name));
  perform app.log_activity('switches.approve', 'product_switches', p_switch, jsonb_build_object('items', v_items));
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261025120000', 'product_equipment');

-- ================================ 20261025150000_team_leader_self_approval ================================
-- Phase 8 change (D-40, owner decision 25 Oct 2026): a Team Leader / Outdoor Supervisor may approve their OWN sales
-- and give the device from their own team's stock — no Super Admin step. Their own product SWITCHES (and, from Phase 12,
-- refunds) still need Super Admin. Agents still never approve;
-- Super Admins still do not sell (D-38). Every decision stays recorded in `approvals` (who decided, and that it was
-- their own), so self-approved sales can be reviewed (audit rule in Phase 9).

-- Who may decide: retention.review AND (Super Admin, or the leader of the sale's team — now including their own).
-- A Super Admin's own item can only be rejected (cancelled), never approved.
create or replace function app.check_decider(p_agent uuid, p_team uuid, p_approve boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sa boolean := app.is_super_admin(v_me);
  v_leads boolean := exists (select 1 from public.teams t where t.id = p_team and t.is_active and t.team_leader_id = v_me);
begin
  if not app.has_permission('retention.review') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_me = p_agent then
    if v_leads then return; end if;                 -- D-40: Team Leader decides own sale for their team
    if v_sa and not p_approve then return; end if;  -- Super Admin may cancel their own
    raise exception 'SELF_APPROVAL';
  end if;
  if v_sa or v_leads then return; end if;
  raise exception 'not allowed' using errcode = 'insufficient_privilege';
end;
$$;

-- Who is notified of a new SALE: the active leader of its team (also when it is the leader's own sale),
-- else every active Super Admin.
create or replace function app.approvers_for(p_agent uuid, p_team uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with leader as (
    select t.team_leader_id as id
    from public.teams t join public.user_profiles p on p.id = t.team_leader_id
    where t.id = p_team and t.is_active and p.is_active
  )
  select id from leader
  union all
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active and not exists (select 1 from leader) and ur.user_id <> p_agent
$$;


-- Switches keep the D-38 rule: nobody decides their own switch (a Team Leader's own goes to Super Admin; a Super
-- Admin may only cancel their own).
create or replace function app.check_switch_decider(p_agent uuid, p_team uuid, p_approve boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sa boolean := app.is_super_admin(v_me);
begin
  if not app.has_permission('retention.review') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_me = p_agent and (p_approve or not v_sa) then
    raise exception 'SELF_APPROVAL';
  end if;
  if v_sa then return; end if;
  if not exists (select 1 from public.teams t where t.id = p_team and t.is_active and t.team_leader_id = v_me) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Who is notified of a new SWITCH: the team's leader unless it is the leader's own, else every active Super Admin.
create or replace function app.switch_approvers_for(p_agent uuid, p_team uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with leader as (
    select t.team_leader_id as id
    from public.teams t join public.user_profiles p on p.id = t.team_leader_id
    where t.id = p_team and t.is_active and p.is_active and t.team_leader_id <> p_agent
  )
  select id from leader
  union all
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active and not exists (select 1 from leader) and ur.user_id <> p_agent
$$;

create or replace function app.notify_new_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'switch_pending', 'product_switches', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
  from app.switch_approvers_for(new.agent_id, new.team_id) a;
  return new;
end;
$$;

create or replace function public.approve_switch(p_switch uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_switch_decider(v_switch.agent_id, v_switch.team_id, true);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;
  perform app.check_equipment(v_switch.to_product_id, v_items); -- D-39
  -- The customer's product may have changed since submission.
  if app.current_product(v_switch.customer_id) is distinct from v_switch.from_product_id then raise exception 'SWITCH_STALE'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.switch_items (switch_id, stock_item_id, quantity)
    select p_switch, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_switch.team_id, v_items, 'switch', p_switch);
  end if;
  update public.product_switches set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('product_switches', p_switch, 'approved', v_items, auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_approved', 'product_switches', p_switch, jsonb_build_object('customer', v_switch.customer_name));
  perform app.log_activity('switches.approve', 'product_switches', p_switch, jsonb_build_object('items', v_items));
end;
$$;

create or replace function public.reject_switch(p_switch uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_switch_decider(v_switch.agent_id, v_switch.team_id, false);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  update public.product_switches set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('product_switches', p_switch, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_rejected', 'product_switches', p_switch,
    jsonb_build_object('customer', v_switch.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('switches.reject', 'product_switches', p_switch);
end;
$$;

revoke execute on function app.check_decider(uuid, uuid, boolean), app.approvers_for(uuid, uuid),
  app.check_switch_decider(uuid, uuid, boolean), app.switch_approvers_for(uuid, uuid), app.notify_new_switch() from public;

insert into supabase_migrations.schema_migrations (version, name) values ('20261025150000', 'team_leader_self_approval');

-- ================================ 20261026090000_audit_cases ================================
-- =============================================================================
-- Phase 9 — Duplicate detection, audit cases and alerts (SDD §11, §18; FR-AUD-01…08; D-13, D-23, D-41)
--
-- audit_rules        : every rule with its enable flag and thresholds (Super Admin changes them, logged).
-- audit_cases        : investigations. Open → Under Review → Confirmed Issue / False Positive → Resolved.
-- audit_case_links   : what a case is about (events, sales, customers, agents). Append-only.
-- audit_case_history : every state change, assignment and note. Append-only.
-- email_outbox       : email copies of audit alerts, sent by the server (no phone or Index in any email).
--
-- Events are grouped into a case automatically (same customer — or, without a customer, same agent — within
-- 30 days) or a case is opened by hand. Only Super Admin or the assigned Auditor changes a case (FR-AUD-07);
-- nobody edits or deletes events, cases' identity, links or history (FR-AUD-05).
-- Effects (FR-AUD-08): Open / Under Review → linked agents on hold; Confirmed Issue → linked sales ineligible;
-- False Positive → none. Exposed to the eligibility service (Phase 10) as app.agent_audit_hold() and
-- app.sale_audit_state().
--
-- Owner choices (26 Oct 2026, D-41): MULTI_AGENT_ATTEMPT and POST_APPROVAL_EDIT on; BURST off; Team Leaders'
-- self-approved sales (D-40) recorded as SELF_APPROVED events only (no case, no hold). Refined the same day:
-- MULTI_AGENT_ATTEMPT counts New sales and blocked attempts only (a Retention by another agent is normal) and
-- holds only the agent who made the attempt; Super Admin corrections of a customer's phone / Index / name are
-- IDENTITY_CORRECTED events only (no case, no hold); events for the same customer / agent are serialised with
-- an advisory lock so concurrent events join one case.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create table public.audit_rules (
  code        text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,62}$'),
  name        text not null check (length(btrim(name)) between 3 and 80),
  description text not null check (length(btrim(description)) between 3 and 300),
  severity    text not null check (severity in ('info', 'low', 'medium', 'high')),
  enabled     boolean not null,
  can_disable boolean not null default true,       -- false = core rule required by the BRD (always on)
  opens_case  boolean not null,                    -- false = event only (no case, no hold)
  threshold   jsonb not null default '{}'::jsonb check (jsonb_typeof(threshold) = 'object'),
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint audit_rules_core_on check (can_disable or enabled)
);
create trigger audit_rules_touch before update on public.audit_rules for each row execute function app.touch_updated();
comment on table public.audit_rules is 'Audit rules with enable flags and thresholds (SDD §11.2). Changed only through public.audit_rule_update.';

insert into public.audit_rules (code, name, description, severity, enabled, can_disable, opens_case, threshold, sort_order) values
  ('DUP_PHONE', 'Duplicate phone number', 'A New sale used a phone number that already belongs to a customer. The sale was blocked.', 'high', true, false, true, '{}', 10),
  ('DUP_INDEX', 'Duplicate Index Number', 'A New sale used an Index Number that already belongs to a customer. The sale was blocked.', 'high', true, false, true, '{}', 20),
  ('IDENTITY_CONFLICT', 'Identity conflict', 'A Retention sale used a phone and Index of different customers, or a name that does not match. The sale was blocked.', 'high', true, false, true, '{}', 30),
  ('SAME_MONTH', 'Second sale in the same month', 'A sale was attempted for a customer who already has a sale this month. The sale was blocked.', 'high', true, false, true, '{}', 40),
  ('SWITCH_MISMATCH', 'Product switch mismatch', 'A product switch used details that do not match one existing customer and product. The switch was blocked.', 'medium', true, false, true, '{}', 50),
  ('MULTI_AGENT_ATTEMPT', 'Several agents, same customer', 'A customer registered as New by one agent was attempted again by a different agent within a short period. Normal Retention sales are not counted.', 'medium', true, true, true, '{"agents": 2, "days": 30}', 60),
  ('BURST', 'Too many sales too fast', 'One agent registered many sales within a few minutes.', 'medium', false, true, true, '{"sales": 5, "minutes": 30}', 70),
  ('POST_APPROVAL_EDIT', 'Edit after approval', 'An approved sale itself was changed after approval.', 'medium', true, true, true, '{}', 80),
  ('IDENTITY_CORRECTED', 'Customer details corrected', 'Super Admin corrected the phone, Index or name of a customer with an approved sale, with a reason. Recorded for review only; no case, no hold.', 'low', true, true, false, '{}', 85),
  ('SELF_APPROVED', 'Self-approved sale', 'A Team Leader approved their own sale (allowed by D-40). Recorded for review only; no case, no hold.', 'low', true, true, false, '{}', 90);

-- ---------------------------------------------------------------------------
-- Cases, links, history
-- ---------------------------------------------------------------------------
create table public.audit_cases (
  id            uuid primary key default gen_random_uuid(),
  case_no       bigint generated always as identity unique,
  title         text not null check (length(btrim(title)) between 3 and 200),
  rule_code     text references public.audit_rules (code),   -- null = opened by hand
  group_key     text,                                         -- 'customer:<id>' / 'agent:<id>'; null = manual
  status        text not null default 'open'
                  check (status in ('open', 'under_review', 'confirmed_issue', 'false_positive', 'resolved')),
  outcome       text check (outcome in ('confirmed_issue', 'false_positive')),
  assigned_to   uuid references public.user_profiles (id),
  opened_by     uuid,                                         -- null = opened automatically
  opened_at     timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now(),
  constraint audit_cases_outcome check (case status
    when 'open' then outcome is null
    when 'under_review' then outcome is null
    when 'resolved' then outcome is not null
    else outcome = status end)
);
create index audit_cases_group_idx on public.audit_cases (group_key, status);
create index audit_cases_status_idx on public.audit_cases (status, last_event_at desc);
create index audit_cases_assigned_idx on public.audit_cases (assigned_to, status);
comment on table public.audit_cases is
  'Audit investigations (SDD §11.3, D-13). Changed only through the audit_case_* functions; never deleted.';

-- A case's identity never changes; only state, outcome, assignment and timestamps move (FR-AUD-05).
create or replace function app.audit_case_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.case_no <> old.case_no or new.title <> old.title
     or new.rule_code is distinct from old.rule_code or new.group_key is distinct from old.group_key
     or new.opened_by is distinct from old.opened_by or new.opened_at <> old.opened_at then
    raise exception 'AUDIT_CASE_IMMUTABLE' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger audit_cases_guard before update on public.audit_cases for each row execute function app.audit_case_guard();
create trigger audit_cases_no_delete before delete on public.audit_cases for each row execute function app.prevent_change();
create trigger audit_cases_no_truncate before truncate on public.audit_cases for each statement execute function app.prevent_change();

create table public.audit_case_links (
  case_id     uuid not null references public.audit_cases (id),
  entity_type text not null check (entity_type in ('audit_events', 'sales', 'customers', 'user_profiles', 'product_switches')),
  entity_id   uuid not null,
  added_at    timestamptz not null default now(),
  added_by    uuid,
  primary key (case_id, entity_type, entity_id)
);
create index audit_case_links_entity_idx on public.audit_case_links (entity_type, entity_id);
create trigger audit_case_links_append_only before update or delete on public.audit_case_links for each row execute function app.prevent_change();
create trigger audit_case_links_no_truncate before truncate on public.audit_case_links for each statement execute function app.prevent_change();
comment on table public.audit_case_links is 'What a case is about: events, sales, customers, agents (user_profiles). Append-only.';

create table public.audit_case_history (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.audit_cases (id),
  at          timestamptz not null default now(),
  actor_id    uuid,                                         -- null = the system
  action      text not null check (action in ('opened', 'status', 'assigned', 'note', 'linked')),
  from_status text,
  to_status   text,
  assigned_to uuid,
  note        text not null check (length(btrim(note)) between 1 and 1000)
);
create index audit_case_history_case_idx on public.audit_case_history (case_id, at);
create trigger audit_case_history_append_only before update or delete on public.audit_case_history for each row execute function app.prevent_change();
create trigger audit_case_history_no_truncate before truncate on public.audit_case_history for each statement execute function app.prevent_change();
comment on table public.audit_case_history is 'Every state change, assignment and note on a case, with who and when. Append-only.';

-- ---------------------------------------------------------------------------
-- Notifications: audit kinds (SDD §18) + email outbox
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('sale_pending', 'sale_approved',
  'sale_rejected', 'switch_pending', 'switch_approved', 'switch_rejected', 'stock_to_accept', 'audit_alert', 'audit_case_assigned'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('sales', 'product_switches', 'stock_transfers', 'audit_cases'));

create table public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications (id),
  user_id         uuid not null references public.user_profiles (id),
  to_email        text,
  subject         text not null check (length(subject) <= 200),
  body            text not null check (length(body) <= 2000),
  link_path       text not null check (link_path ~ '^/[a-z0-9/_-]*$'),
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0 check (attempts between 0 and 20),
  last_error      text check (last_error is null or length(last_error) <= 300),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index email_outbox_status_idx on public.email_outbox (status, created_at);
comment on table public.email_outbox is
  'Email copies of audit alerts (D-23). Sent by the server with the secret key (T-25). No phone or Index in any email.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.super_admins()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active
$$;

create or replace function app.rule_enabled(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.audit_rules where code = p_code), false)
$$;

-- Record a rule hit from inside the system (triggers, checks). Skipped when the rule is switched off.
-- The actor is the session user (may be null for maintenance run in the SQL Editor).
create or replace function app.rule_event(p_rule text, p_attempted jsonb, p_matched_type text, p_matched_id uuid, p_context jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.rule_enabled(p_rule) then return null; end if;
  insert into public.audit_events (rule_code, severity, actor_id, attempted_values, matched_entity_type, matched_entity_id, context)
  select p_rule, r.severity, auth.uid(), coalesce(p_attempted, '{}'::jsonb), p_matched_type, p_matched_id, coalesce(p_context, '{}'::jsonb)
  from public.audit_rules r where r.code = p_rule
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.case_link(p_case uuid, p_type text, p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_case_links (case_id, entity_type, entity_id, added_by)
  select p_case, p_type, p_id, auth.uid() where p_id is not null
  on conflict do nothing
$$;

-- Link a sale with its agent and customer.
create or replace function app.case_link_sale(p_case uuid, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  select agent_id, customer_id into v_sale from public.sales where id = p_sale;
  if not found then return; end if;
  perform app.case_link(p_case, 'sales', p_sale);
  perform app.case_link(p_case, 'user_profiles', v_sale.agent_id);
  perform app.case_link(p_case, 'customers', v_sale.customer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Automatic grouping of events into cases + Super Admin alert (FR-AUD-02, SDD §11.3)
-- ---------------------------------------------------------------------------
create or replace function app.on_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.audit_rules;
  v_customer uuid;
  v_agent uuid;
  v_key text;
  v_case uuid;
  v_no bigint;
  v_new boolean := false;
begin
  select * into r from public.audit_rules where code = new.rule_code;
  if not found or not r.opens_case then return null; end if;

  v_customer := case when new.matched_entity_type = 'customers' then new.matched_entity_id end;
  v_agent := coalesce(nullif(new.context ->> 'agent_id', '')::uuid, new.actor_id);
  v_key := coalesce('customer:' || v_customer, 'agent:' || v_agent, 'event:' || new.id);
  -- Two events for the same customer / agent at the same moment wait for each other, so they join one case.
  perform pg_advisory_xact_lock(hashtext('audit_case:' || v_key));

  select id, case_no into v_case, v_no from public.audit_cases
   where group_key = v_key and status in ('open', 'under_review') and last_event_at >= new.occurred_at - interval '30 days'
   order by opened_at desc limit 1
   for update;

  if v_case is null then
    insert into public.audit_cases (title, rule_code, group_key, last_event_at)
    values (r.name, r.code, v_key, new.occurred_at)
    returning id, case_no into v_case, v_no;
    insert into public.audit_case_history (case_id, action, to_status, note)
    values (v_case, 'opened', 'open', 'Opened automatically: ' || r.name);
    v_new := true;
  else
    update public.audit_cases set last_event_at = greatest(last_event_at, new.occurred_at), updated_at = now() where id = v_case;
    insert into public.audit_case_history (case_id, action, note) values (v_case, 'linked', 'New event added: ' || r.name);
  end if;

  perform app.case_link(v_case, 'audit_events', new.id);
  perform app.case_link(v_case, 'customers', v_customer);
  if v_agent is not null and exists (select 1 from public.user_profiles where id = v_agent) then
    perform app.case_link(v_case, 'user_profiles', v_agent);
  end if;
  if nullif(new.context ->> 'sale_id', '') is not null then
    perform app.case_link_sale(v_case, (new.context ->> 'sale_id')::uuid);
  end if;
  if new.matched_entity_type = 'sales' then perform app.case_link_sale(v_case, new.matched_entity_id); end if;

  -- In-app (and email) alert to every active Super Admin and the assigned Auditor. No phone or Index.
  perform app.notify(u.id, 'audit_alert', 'audit_cases', v_case,
    jsonb_build_object('rule', r.code, 'rule_name', r.name, 'case_no', v_no::text, 'new_case', v_new::text))
  from (select app.super_admins() as id
        union
        select assigned_to from public.audit_cases where id = v_case and assigned_to is not null) u;
  return null;
end;
$$;
create trigger audit_events_case after insert on public.audit_events for each row execute function app.on_audit_event();

-- Email copy of audit notifications (subject + body without phone or Index; the link is added at send time).
create or replace function app.queue_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_subject text;
  v_body text;
begin
  if new.kind not in ('audit_alert', 'audit_case_assigned') then return null; end if;
  select email into v_email from auth.users where id = new.user_id;
  if new.kind = 'audit_alert' then
    v_subject := 'Audit alert: ' || coalesce(new.data ->> 'rule_name', 'rule') || ' (case #' || coalesce(new.data ->> 'case_no', '?') || ')';
    v_body := 'A new audit alert needs review in Sogasho Outdoor.' || chr(10) || 'Rule: ' || coalesce(new.data ->> 'rule_name', '-')
      || chr(10) || 'Case: #' || coalesce(new.data ->> 'case_no', '?')
      || chr(10) || 'A duplicate attempt is a risk indicator, not proof of fraud. Open the case to review it.';
  else
    v_subject := 'Audit case #' || coalesce(new.data ->> 'case_no', '?') || ' assigned to you';
    v_body := 'An audit case was assigned to you in Sogasho Outdoor.' || chr(10) || 'Case: #' || coalesce(new.data ->> 'case_no', '?')
      || ' - ' || coalesce(new.data ->> 'title', '');
  end if;
  insert into public.email_outbox (notification_id, user_id, to_email, subject, body, link_path, status)
  values (new.id, new.user_id, v_email, left(v_subject, 200), left(v_body, 2000), '/audit/cases/' || new.entity_id,
    -- Agents' internal sign-in addresses (T-16) cannot receive email.
    case when v_email is null or v_email ilike '%@phone.%' then 'skipped' else 'pending' end);
  return null;
end;
$$;
create trigger notifications_email after insert on public.notifications for each row execute function app.queue_email();

-- ---------------------------------------------------------------------------
-- Additional rules (SDD §11.2)
-- ---------------------------------------------------------------------------
-- MULTI_AGENT_ATTEMPT: a customer's New sale and blocked attempts (duplicates, conflicts, mismatches) come from
-- ≥ N different agents within D days. Retention sales are NOT counted (a renewal with another agent is normal).
-- Checked when an attempt is blocked; one event per customer per window; only the attempting agent is linked
-- (put on hold) — the others are listed in the event.
create or replace function app.check_multi_agent(p_customer uuid, p_agent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_days int;
  v_min int;
  v_agents uuid[];
begin
  if p_customer is null or not app.rule_enabled('MULTI_AGENT_ATTEMPT') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'MULTI_AGENT_ATTEMPT';
  v_days := coalesce((v_t ->> 'days')::int, 30);
  v_min := coalesce((v_t ->> 'agents')::int, 2);
  if exists (select 1 from public.audit_events where rule_code = 'MULTI_AGENT_ATTEMPT' and matched_entity_type = 'customers'
             and matched_entity_id = p_customer and occurred_at >= now() - make_interval(days => v_days)) then
    return;
  end if;
  select array_agg(distinct a) into v_agents from (
    select agent_id as a from public.sales
     where customer_id = p_customer and customer_type = 'new' and submitted_at >= now() - make_interval(days => v_days)
    union all
    select actor_id from public.audit_events
     where matched_entity_type = 'customers' and matched_entity_id = p_customer and actor_id is not null
       and rule_code in ('DUP_PHONE', 'DUP_INDEX', 'IDENTITY_CONFLICT', 'SAME_MONTH', 'SWITCH_MISMATCH')
       and occurred_at >= now() - make_interval(days => v_days)
  ) x where a is not null;
  if coalesce(cardinality(v_agents), 0) < v_min then return; end if;
  perform app.rule_event('MULTI_AGENT_ATTEMPT',
    jsonb_build_object('agents', cardinality(v_agents), 'days', v_days,
      'agent_names', (select jsonb_agg(full_name order by full_name) from public.user_profiles where id = any (v_agents))),
    'customers', p_customer, jsonb_build_object('source', 'check_multi_agent', 'agent_id', p_agent));
end;
$$;

-- BURST: ≥ N sales by one agent within M minutes. One event per agent per window.
create or replace function app.check_burst(p_agent uuid, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_n int;
  v_m int;
  v_count int;
begin
  if not app.rule_enabled('BURST') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'BURST';
  v_n := coalesce((v_t ->> 'sales')::int, 5);
  v_m := coalesce((v_t ->> 'minutes')::int, 30);
  select count(*) into v_count from public.sales where agent_id = p_agent and submitted_at >= now() - make_interval(mins => v_m);
  if v_count < v_n then return; end if;
  if exists (select 1 from public.audit_events where rule_code = 'BURST' and context ->> 'agent_id' = p_agent::text
             and occurred_at >= now() - make_interval(mins => v_m)) then
    return;
  end if;
  perform app.rule_event('BURST', jsonb_build_object('sales', v_count, 'minutes', v_m), null, null,
    jsonb_build_object('source', 'check_burst', 'agent_id', p_agent, 'sale_id', p_sale));
end;
$$;

create or replace function app.on_sale_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_burst(new.agent_id, new.id);
  return null;
end;
$$;
create trigger sales_audit_rules after insert on public.sales for each row execute function app.on_sale_insert();

create or replace function app.on_attempt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule_code in ('DUP_PHONE', 'DUP_INDEX', 'IDENTITY_CONFLICT', 'SAME_MONTH', 'SWITCH_MISMATCH')
     and new.matched_entity_type = 'customers' then
    perform app.check_multi_agent(new.matched_entity_id, new.actor_id);
  end if;
  return null;
end;
$$;
create trigger audit_events_multi_agent after insert on public.audit_events for each row execute function app.on_attempt_event();

-- IDENTITY_CORRECTED: a customer's phone / Index / name corrected (Super Admin, with a reason) after one of
-- their sales was approved. Event only — no case, no hold (D-41).
create or replace function app.identity_corrected(p_customer uuid, p_attempted jsonb, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  select id, agent_id into v_sale from public.sales where customer_id = p_customer and status = 'approved'
   order by approved_at desc nulls last limit 1;
  if not found then return; end if;
  perform app.rule_event('IDENTITY_CORRECTED', p_attempted, 'customers', p_customer,
    jsonb_build_object('source', p_source, 'agent_id', v_sale.agent_id, 'sale_id', v_sale.id));
end;
$$;

create or replace function app.on_identifier_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_current and not new.is_current and new.replaced_at is not null then
    perform app.identity_corrected(new.customer_id,
      jsonb_build_object('field', new.kind, 'old_value', old.value, 'reason', new.replace_reason), 'change_customer_identifier');
  end if;
  return null;
end;
$$;
create trigger customer_identifiers_post_approval after update on public.customer_identifiers
  for each row execute function app.on_identifier_replaced();

create or replace function app.on_customer_renamed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name then
    perform app.identity_corrected(new.id, jsonb_build_object('field', 'name', 'old_value', old.full_name, 'new_value', new.full_name), 'customers');
  end if;
  return null;
end;
$$;
create trigger customers_post_approval after update on public.customers for each row execute function app.on_customer_renamed();

-- POST_APPROVAL_EDIT: an approved sale itself changed (the system never does this) → case + hold.
create or replace function app.on_approved_sale_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if old.status <> 'approved' or new.status <> 'approved' then return null; end if;
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new) - 'updated_at' - 'updated_by') n
  where n.value is distinct from (to_jsonb(old) -> n.key);
  if v_changed is null then return null; end if;
  perform app.rule_event('POST_APPROVAL_EDIT', jsonb_build_object('field', 'sale', 'changed', to_jsonb(v_changed)), 'customers', new.customer_id,
    jsonb_build_object('source', 'sales', 'agent_id', new.agent_id, 'sale_id', new.id));
  return null;
end;
$$;
create trigger sales_post_approval after update on public.sales for each row execute function app.on_approved_sale_changed();

-- SELF_APPROVED: a Team Leader approved their own sale (D-40). Event only.
create or replace function app.on_sale_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  if new.entity_type <> 'sales' or new.decision <> 'approved' then return null; end if;
  select agent_id, customer_id into v_sale from public.sales where id = new.entity_id;
  if v_sale.agent_id = new.decided_by then
    perform app.rule_event('SELF_APPROVED', jsonb_build_object('items', new.items), 'sales', new.entity_id,
      jsonb_build_object('source', 'approve_sale', 'agent_id', v_sale.agent_id, 'customer_id', v_sale.customer_id));
  end if;
  return null;
end;
$$;
create trigger approvals_self_approved after insert on public.approvals for each row execute function app.on_sale_decision();

-- ---------------------------------------------------------------------------
-- Effects for the eligibility service (Phase 10) and payroll (Phase 16) — FR-AUD-08
-- ---------------------------------------------------------------------------
create or replace function app.agent_audit_hold(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
    where l.entity_type = 'user_profiles' and l.entity_id = p_agent and c.status in ('open', 'under_review'))
$$;
comment on function app.agent_audit_hold(uuid) is 'True while the agent is linked to an Open or Under Review case (payroll line on hold).';

-- 'confirmed_issue' (ineligible) / 'on_hold' / null.
create or replace function app.sale_audit_state(p_sale uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
                 where l.entity_type = 'sales' and l.entity_id = p_sale and c.outcome = 'confirmed_issue') then 'confirmed_issue'
    when exists (select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
                 where l.entity_type = 'sales' and l.entity_id = p_sale and c.status in ('open', 'under_review'))
      or app.agent_audit_hold((select agent_id from public.sales where id = p_sale)) then 'on_hold'
  end
$$;
comment on function app.sale_audit_state(uuid) is 'Audit effect on a sale: confirmed_issue = ineligible, on_hold = payroll hold, null = none.';

-- ---------------------------------------------------------------------------
-- Case management — Super Admin, or the Auditor assigned to the case (FR-AUD-07)
-- ---------------------------------------------------------------------------
create or replace function app.can_manage_case(p_assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user() and coalesce(app.in_scope('audit.manage', p_assigned), false)
$$;

create or replace function app.case_note(p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  return left(btrim(p_note), 1000);
end;
$$;

create or replace function public.audit_case_set_status(p_case uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.audit_cases;
  v_note text;
begin
  select * into v_case from public.audit_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app.can_manage_case(v_case.assigned_to) then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  v_note := app.case_note(p_note);
  if not ((v_case.status = 'open' and p_status = 'under_review')
       or (v_case.status = 'under_review' and p_status in ('confirmed_issue', 'false_positive'))
       or (v_case.status in ('confirmed_issue', 'false_positive') and p_status = 'resolved')) then
    raise exception 'INVALID_TRANSITION';
  end if;
  update public.audit_cases
     set status = p_status,
         outcome = case when p_status in ('confirmed_issue', 'false_positive') then p_status else outcome end,
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
         updated_at = now()
   where id = p_case;
  insert into public.audit_case_history (case_id, actor_id, action, from_status, to_status, note)
  values (p_case, auth.uid(), 'status', v_case.status, p_status, v_note);
  perform app.log_activity('audit.case_status', 'audit_cases', p_case, jsonb_build_object('from', v_case.status, 'to', p_status));
end;
$$;

create or replace function public.audit_case_add_note(p_case uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned uuid;
begin
  select assigned_to into v_assigned from public.audit_cases where id = p_case;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app.can_manage_case(v_assigned) then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  insert into public.audit_case_history (case_id, actor_id, action, note) values (p_case, auth.uid(), 'note', app.case_note(p_note));
end;
$$;

-- Super Admin assigns (or unassigns, p_user null) a case to an active Auditor or Super Admin.
create or replace function public.audit_case_assign(p_case uuid, p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.audit_cases;
  v_name text;
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_case from public.audit_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_case.status = 'resolved' then raise exception 'CASE_RESOLVED'; end if;
  if p_user is not null and not exists (
    select 1 from public.user_profiles p join public.user_roles ur on ur.user_id = p.id
    where p.id = p_user and p.is_active and ur.role_key in ('auditor', 'super_admin')) then
    raise exception 'ASSIGNEE_INVALID';
  end if;
  if p_user is not distinct from v_case.assigned_to then return; end if;
  update public.audit_cases set assigned_to = p_user, updated_at = now() where id = p_case;
  select full_name into v_name from public.user_profiles where id = p_user;
  insert into public.audit_case_history (case_id, actor_id, action, assigned_to, note)
  values (p_case, auth.uid(), 'assigned', p_user,
    coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), case when p_user is null then 'Unassigned' else 'Assigned to ' || v_name end));
  if p_user is not null and p_user <> auth.uid() then
    perform app.notify(p_user, 'audit_case_assigned', 'audit_cases', p_case,
      jsonb_build_object('case_no', v_case.case_no::text, 'title', v_case.title));
  end if;
  perform app.log_activity('audit.case_assign', 'audit_cases', p_case, jsonb_build_object('assigned_to', p_user));
end;
$$;

-- Manual case (Super Admin), optionally about one sale (its agent and customer are linked too).
create or replace function public.audit_case_create(p_title text, p_note text, p_sale uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then raise exception 'TITLE_REQUIRED'; end if;
  if p_sale is not null and not exists (select 1 from public.sales where id = p_sale) then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_cases (title, opened_by) values (v_title, auth.uid()) returning id into v_case;
  insert into public.audit_case_history (case_id, actor_id, action, to_status, note)
  values (v_case, auth.uid(), 'opened', 'open', app.case_note(p_note));
  if p_sale is not null then perform app.case_link_sale(v_case, p_sale); end if;
  perform app.log_activity('audit.case_create', 'audit_cases', v_case, jsonb_build_object('sale', p_sale));
  return v_case;
end;
$$;

-- Rules: enable / disable and thresholds (Super Admin, settings.manage; logged). Core rules stay on.
create or replace function public.audit_rule_update(p_code text, p_enabled boolean, p_threshold jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.audit_rules;
  v_t jsonb := '{}'::jsonb;
  v_a int;
  v_b int;
begin
  if not app.is_active_user() or not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.audit_rules where code = p_code for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not r.can_disable and not coalesce(p_enabled, false) then raise exception 'RULE_REQUIRED'; end if;
  begin
    if p_code = 'MULTI_AGENT_ATTEMPT' then
      v_a := (p_threshold ->> 'agents')::int; v_b := (p_threshold ->> 'days')::int;
      if v_a is null or v_a not between 2 and 10 or v_b is null or v_b not between 1 and 90 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('agents', v_a, 'days', v_b);
    elsif p_code = 'BURST' then
      v_a := (p_threshold ->> 'sales')::int; v_b := (p_threshold ->> 'minutes')::int;
      if v_a is null or v_a not between 2 and 50 or v_b is null or v_b not between 5 and 1440 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('sales', v_a, 'minutes', v_b);
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'THRESHOLD_INVALID';
  end;
  update public.audit_rules set enabled = coalesce(p_enabled, false), threshold = v_t, updated_by = auth.uid() where code = p_code;
  perform app.log_activity('audit.rule_update', 'audit_rules', null,
    jsonb_build_object('code', p_code, 'enabled', coalesce(p_enabled, false), 'threshold', v_t));
end;
$$;

-- Email queue status for the audit screen (counts only).
create or replace function public.email_outbox_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (select jsonb_build_object(
    'pending', count(*) filter (where status in ('pending', 'sending')),
    'failed', count(*) filter (where status = 'failed'),
    'sent', count(*) filter (where status = 'sent'))
    from public.email_outbox);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — reads only; every write goes through the functions and triggers above.
-- ---------------------------------------------------------------------------
alter table public.audit_rules enable row level security;
alter table public.audit_cases enable row level security;
alter table public.audit_case_links enable row level security;
alter table public.audit_case_history enable row level security;
alter table public.email_outbox enable row level security;
revoke all on public.audit_rules, public.audit_cases, public.audit_case_links, public.audit_case_history, public.email_outbox
  from anon, authenticated, service_role;
grant select on public.audit_rules, public.audit_cases, public.audit_case_links, public.audit_case_history to authenticated, service_role;
-- The server's email sender (secret key, T-25) reads the queue and records the result.
grant select, update on public.email_outbox to service_role;

create policy audit_rules_read on public.audit_rules for select to authenticated
  using (app.is_active_user() and (app.has_permission('audit.read') or app.has_permission('settings.manage')));
create policy audit_cases_read on public.audit_cases for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
create policy audit_case_links_read on public.audit_case_links for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
create policy audit_case_history_read on public.audit_case_history for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
-- email_outbox: no policy for authenticated — nobody reads it through the API except the server.

select app.enable_change_log('public.audit_rules', 'code');
select app.enable_change_log('public.audit_cases');
select app.enable_change_log('public.audit_case_links', 'case_id');
select app.enable_change_log('public.audit_case_history');
select app.enable_change_log('public.email_outbox', 'id', 'to_email');

revoke execute on function app.audit_case_guard(), app.super_admins(), app.rule_enabled(text),
  app.rule_event(text, jsonb, text, uuid, jsonb), app.case_link(uuid, text, uuid), app.case_link_sale(uuid, uuid),
  app.on_audit_event(), app.queue_email(), app.check_multi_agent(uuid, uuid), app.check_burst(uuid, uuid),
  app.on_sale_insert(), app.on_attempt_event(), app.identity_corrected(uuid, jsonb, text), app.on_identifier_replaced(),
  app.on_customer_renamed(), app.on_approved_sale_changed(), app.on_sale_decision(), app.agent_audit_hold(uuid),
  app.sale_audit_state(uuid), app.can_manage_case(uuid), app.case_note(text) from public;

revoke execute on function public.audit_case_set_status(uuid, text, text), public.audit_case_add_note(uuid, text),
  public.audit_case_assign(uuid, uuid, text), public.audit_case_create(text, text, uuid),
  public.audit_rule_update(text, boolean, jsonb), public.email_outbox_summary() from public, anon, authenticated, service_role;
grant execute on function public.audit_case_set_status(uuid, text, text), public.audit_case_add_note(uuid, text),
  public.audit_case_assign(uuid, uuid, text), public.audit_case_create(text, text, uuid),
  public.audit_rule_update(text, boolean, jsonb), public.email_outbox_summary() to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261026090000', 'audit_cases');

-- ================================ 20261103090000_dashboard ================================
-- Phase 10 — Operational dashboard (Roadmap Phase 10; BRD §8.2, §9.1, §9.3; SDD §14.1–14.2; D-42)
--
--  * app.eligible_sale_facts() / app.eligible_sales(month): the ONE eligible-sale definition (D-06), used by
--    the dashboard now and by targets, payroll and rankings later. A sale is eligible when it is approved,
--    not reversed, not linked to a Confirmed-issue audit case and is a sale (switches live in their own table).
--    Counting month = sale month if approved by the payroll cutoff (day N of the next month, end of day EAT),
--    otherwise the business month of approval. on_hold = linked to an open case (Phase 9), still counted.
--  * Dashboard read functions (SECURITY DEFINER, scope from dashboard.read: own / team / all). Aggregation
--    happens here, on the server (SDD §14.2); nothing is stored.
--  * City target (D-42) = active Sales Agents + active Team Leaders of the city × performance_target_units
--    (Settings) until Phase 14 adds individual agent targets. No city or branch target table.
--  * Owner decisions (D-42): Team Leaders may no longer sell in another city (sales.override_city removed);
--    Stock Officers see only the stock part (dashboard.read removed; stock cards use stock.read).

-- ---------------------------------------------------------------------------
-- Permission changes (D-42)
-- ---------------------------------------------------------------------------
delete from public.role_permissions where role_key = 'team_leader' and permission_key = 'sales.override_city';
delete from public.role_permissions where role_key = 'stock_officer' and permission_key = 'dashboard.read';

create index if not exists sales_status_month_idx on public.sales (status, sale_month);

-- ---------------------------------------------------------------------------
-- Reporting period (EAT). basis 'month' = counting months from_month..to_month (eligible rule);
-- basis 'date' = approved sales by submission date from_date..to_date (today, this week, custom range).
-- ---------------------------------------------------------------------------
create or replace function app.dashboard_period(p jsonb)
returns table (basis text, from_date date, to_date date, from_month date, to_month date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Mogadishu')::date;
  v_month date := date_trunc('month', v_today)::date;
  v_prev date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_start text;
  v_from date;
  v_to date;
begin
  case coalesce(p ->> 'period', 'month')
    when 'month' then
      return query select 'month'::text, v_month, v_today, v_month, v_month;
    when 'prev_month' then
      return query select 'month'::text, v_prev, v_month - 1, v_prev, v_prev;
    when 'ytd' then
      return query select 'month'::text, date_trunc('year', v_today)::date, v_today, date_trunc('year', v_today)::date, v_month;
    when 'today' then
      return query select 'date'::text, v_today, v_today, null::date, null::date;
    when 'week' then
      select value #>> '{}' into v_start from public.app_settings where key = 'week_start_day';
      v_from := v_today - ((extract(dow from v_today)::int
        - (array_position(array['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], coalesce(v_start, 'saturday')) - 1)
        + 7) % 7);
      return query select 'date'::text, v_from, v_today, null::date, null::date;
    when 'custom' then
      begin
        v_from := (p ->> 'from')::date;
        v_to := (p ->> 'to')::date;
      exception when others then
        raise exception 'PERIOD_INVALID';
      end;
      if v_from is null or v_to is null or v_from > v_to or v_to > v_today or v_to - v_from > 366 then
        raise exception 'PERIOD_INVALID';
      end if;
      return query select 'date'::text, v_from, v_to, null::date, null::date;
    else
      raise exception 'PERIOD_INVALID';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- The eligible-sale definition (BRD §8.2, SDD §14.1, D-06)
-- ---------------------------------------------------------------------------
create or replace function app.eligible_sale_facts()
returns table (
  sale_id uuid, agent_id uuid, team_id uuid, city_id uuid, branch_id uuid, product_id uuid, customer_type text,
  amount numeric, sale_month date, submitted_on date, approved_at timestamptz, counting_month date, on_hold boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cutoff as (
    select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'payroll_cutoff_day'), 3) as days
  ),
  case_sales as (
    select l.entity_id,
           bool_or(c.outcome = 'confirmed_issue') as confirmed,
           bool_or(c.status in ('open', 'under_review')) as open
    from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
    where l.entity_type = 'sales'
    group by l.entity_id
  ),
  held_agents as (
    select distinct l.entity_id
    from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
    where l.entity_type = 'user_profiles' and c.status in ('open', 'under_review')
  )
  select s.id, s.agent_id, s.team_id, s.city_id, s.branch_id, s.product_id, s.customer_type, s.amount_collected,
         s.sale_month, (s.submitted_at at time zone 'Africa/Mogadishu')::date, s.approved_at,
         case when s.approved_at < ((s.sale_month + interval '1 month' + make_interval(days => cutoff.days))::timestamp
                                    at time zone 'Africa/Mogadishu')
              then s.sale_month
              else app.business_month(s.approved_at) end,
         coalesce(cs.open, false) or exists (select 1 from held_agents h where h.entity_id = s.agent_id)
  from public.sales s
  cross join cutoff
  left join case_sales cs on cs.entity_id = s.id
  where s.status = 'approved'
    and s.approved_at is not null
    and not coalesce(cs.confirmed, false)
$$;
comment on function app.eligible_sale_facts() is
  'Every eligible sale with its counting month (BRD §8.2): approved, not reversed, not Confirmed issue; payroll cutoff applied. on_hold = open audit case.';

create or replace function app.eligible_sales(p_month date)
returns table (
  sale_id uuid, agent_id uuid, team_id uuid, city_id uuid, branch_id uuid, product_id uuid, customer_type text,
  amount numeric, sale_month date, submitted_on date, approved_at timestamptz, counting_month date, on_hold boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.eligible_sale_facts() f where f.counting_month = date_trunc('month', p_month)::date
$$;
comment on function app.eligible_sales(date) is
  'Eligible sales counted in one month — the shared definition for dashboard, targets, payroll and rankings (D-06).';

-- ---------------------------------------------------------------------------
-- Scope: the users whose records the caller may see for a permission (same rules as app.in_scope)
-- ---------------------------------------------------------------------------
create or replace function app.scope_users(p_permission text)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := app.permission_scope(p_permission);
  v_me uuid := auth.uid();
begin
  if v_scope = 'all' then
    return query select u.id from public.user_profiles u;
  elsif v_scope = 'city' then
    return query select u.id from public.user_profiles u
      where u.id = v_me or u.city_id = (select me.city_id from public.user_profiles me where me.id = v_me);
  elsif v_scope = 'team' then
    return query select v_me
      union select tm.user_id from public.team_members tm join public.teams t on t.id = tm.team_id
            where t.team_leader_id = v_me and t.is_active;
  elsif v_scope = 'own' then
    return query select v_me;
  end if;
end;
$$;

-- Dimension filters from the request: city_id, branch_id, agent_id, product_id (null / '' = all).
create or replace function app.dashboard_filter(p jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(p ->> p_key, '')::uuid;
exception when others then
  raise exception 'FILTER_INVALID';
end;
$$;

-- Eligible sales the caller may see, with the dimension filters applied (no period).
create or replace function app.dashboard_facts(p jsonb)
returns table (
  sale_id uuid, agent_id uuid, team_id uuid, city_id uuid, branch_id uuid, product_id uuid, customer_type text,
  amount numeric, sale_month date, submitted_on date, approved_at timestamptz, counting_month date, on_hold boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.* from app.eligible_sale_facts() f
  where f.agent_id in (select su.user_id from app.scope_users('dashboard.read') su)
    and (app.dashboard_filter(p, 'city_id') is null or f.city_id = app.dashboard_filter(p, 'city_id'))
    and (app.dashboard_filter(p, 'branch_id') is null or f.branch_id = app.dashboard_filter(p, 'branch_id'))
    and (app.dashboard_filter(p, 'agent_id') is null or f.agent_id = app.dashboard_filter(p, 'agent_id'))
    and (app.dashboard_filter(p, 'product_id') is null or f.product_id = app.dashboard_filter(p, 'product_id'))
$$;

-- Submitted sales (everything not rejected or reversed: approved + waiting for approval) the caller may see.
create or replace function app.dashboard_submitted(p jsonb)
returns table (
  sale_id uuid, agent_id uuid, city_id uuid, branch_id uuid, product_id uuid, customer_type text, amount numeric,
  status text, sale_month date, submitted_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.agent_id, s.city_id, s.branch_id, s.product_id, s.customer_type, s.amount_collected, s.status, s.sale_month,
         (s.submitted_at at time zone 'Africa/Mogadishu')::date
  from public.sales s
  where s.status in ('approved', 'pending_approval')
    and s.agent_id in (select su.user_id from app.scope_users('dashboard.read') su)
    and (app.dashboard_filter(p, 'city_id') is null or s.city_id = app.dashboard_filter(p, 'city_id'))
    and (app.dashboard_filter(p, 'branch_id') is null or s.branch_id = app.dashboard_filter(p, 'branch_id'))
    and (app.dashboard_filter(p, 'agent_id') is null or s.agent_id = app.dashboard_filter(p, 'agent_id'))
    and (app.dashboard_filter(p, 'product_id') is null or s.product_id = app.dashboard_filter(p, 'product_id'))
$$;

-- Buckets (one sale can be in several):
--   overall · month (this counting month) · last_month · period (selected period, see app.dashboard_period)
--   submitted_month (submitted this month, approved or waiting) · submitted_period · pending (waiting now).
create or replace function app.dashboard_tagged(p jsonb)
returns table (
  bucket text, sale_id uuid, agent_id uuid, city_id uuid, branch_id uuid, product_id uuid, customer_type text,
  amount numeric, counting_month date, on_hold boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (select * from app.dashboard_period(p)),
  m as (select app.business_month(now()) as cur),
  f as (select * from app.dashboard_facts(p)),
  s as (select * from app.dashboard_submitted(p))
  select 'overall', f.sale_id, f.agent_id, f.city_id, f.branch_id, f.product_id, f.customer_type, f.amount, f.counting_month, f.on_hold from f
  union all
  select 'month', f.sale_id, f.agent_id, f.city_id, f.branch_id, f.product_id, f.customer_type, f.amount, f.counting_month, f.on_hold
    from f, m where f.counting_month = m.cur
  union all
  select 'last_month', f.sale_id, f.agent_id, f.city_id, f.branch_id, f.product_id, f.customer_type, f.amount, f.counting_month, f.on_hold
    from f, m where f.counting_month = (m.cur - interval '1 month')::date
  union all
  select 'period', f.sale_id, f.agent_id, f.city_id, f.branch_id, f.product_id, f.customer_type, f.amount, f.counting_month, f.on_hold
    from f, r
    where (r.basis = 'month' and f.counting_month between r.from_month and r.to_month)
       or (r.basis = 'date' and f.submitted_on between r.from_date and r.to_date)
  union all
  select 'submitted_month', s.sale_id, s.agent_id, s.city_id, s.branch_id, s.product_id, s.customer_type, s.amount, null::date, false
    from s, m where s.sale_month = m.cur
  union all
  select 'submitted_period', s.sale_id, s.agent_id, s.city_id, s.branch_id, s.product_id, s.customer_type, s.amount, null::date, false
    from s, r
    where (r.basis = 'month' and s.sale_month between r.from_month and r.to_month)
       or (r.basis = 'date' and s.submitted_on between r.from_date and r.to_date)
  union all
  select 'pending', s.sale_id, s.agent_id, s.city_id, s.branch_id, s.product_id, s.customer_type, s.amount, null::date, false
    from s where s.status = 'pending_approval'
$$;

create or replace function app.require_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_permission) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read functions (dashboard.read)
-- ---------------------------------------------------------------------------

-- Period, settings and freshness for the screen.
create or replace function public.dashboard_context(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not app.is_active_user() then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  select * into r from app.dashboard_period(p);
  return jsonb_build_object(
    'basis', r.basis, 'from_date', r.from_date, 'to_date', r.to_date, 'from_month', r.from_month, 'to_month', r.to_month,
    'current_month', app.business_month(now()),
    'today', (now() at time zone 'Africa/Mogadishu')::date,
    'cutoff_day', coalesce((select (value #>> '{}')::int from public.app_settings where key = 'payroll_cutoff_day'), 3),
    'target_units', coalesce((select (value #>> '{}')::int from public.app_settings where key = 'performance_target_units'), 20),
    'baseline_units', coalesce((select (value #>> '{}')::int from public.app_settings where key = 'performance_baseline_units'), 15),
    'scope', app.permission_scope('dashboard.read'),
    'generated_at', now());
end;
$$;

-- Units, revenue, New and Retention per bucket, overall and by city / branch / product / agent.
create or replace function public.dashboard_figures(p jsonb)
returns table (
  bucket text, dim text, key uuid, label text, parent uuid,
  units int, revenue numeric, new_units int, retention_units int, on_hold_units int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('dashboard.read');
  return query
  with g as (
    select t.bucket as b,
           case when grouping(t.city_id) = 0 then 'city' when grouping(t.branch_id) = 0 then 'branch'
                when grouping(t.product_id) = 0 then 'product' when grouping(t.agent_id) = 0 then 'agent' else 'total' end as d,
           coalesce(case when grouping(t.city_id) = 0 then t.city_id end, case when grouping(t.branch_id) = 0 then t.branch_id end,
                    case when grouping(t.product_id) = 0 then t.product_id end, case when grouping(t.agent_id) = 0 then t.agent_id end) as k,
           count(*)::int as u, coalesce(sum(t.amount), 0)::numeric as rev,
           (count(*) filter (where t.customer_type = 'new'))::int as nu,
           (count(*) filter (where t.customer_type = 'retention'))::int as ru,
           (count(*) filter (where t.on_hold))::int as hu
    from app.dashboard_tagged(p) t
    group by grouping sets ((t.bucket), (t.bucket, t.city_id), (t.bucket, t.branch_id), (t.bucket, t.product_id), (t.bucket, t.agent_id))
  )
  select g.b, g.d, g.k,
         case g.d when 'city' then c.name when 'branch' then br.name when 'product' then pr.code when 'agent' then up.full_name end,
         case g.d when 'branch' then br.city_id end,
         g.u, g.rev, g.nu, g.ru, g.hu
  from g
  left join public.cities c on g.d = 'city' and c.id = g.k
  left join public.branches br on g.d = 'branch' and br.id = g.k
  left join public.products pr on g.d = 'product' and pr.id = g.k
  left join public.user_profiles up on g.d = 'agent' and up.id = g.k;
end;
$$;

-- Monthly trend (counting months), overall and by product and city, for the last p_months months.
create or replace function public.dashboard_trend(p jsonb, p_months int default 12)
returns table (month date, dim text, key uuid, label text, units int, revenue numeric, new_units int, retention_units int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date := app.business_month(now());
  v_from date := (app.business_month(now()) - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1))::date;
begin
  perform app.require_permission('dashboard.read');
  return query
  with g as (
    select f.counting_month as m,
           case when grouping(f.product_id) = 0 then 'product' when grouping(f.city_id) = 0 then 'city' else 'total' end as d,
           coalesce(case when grouping(f.product_id) = 0 then f.product_id end, case when grouping(f.city_id) = 0 then f.city_id end) as k,
           count(*)::int as u, coalesce(sum(f.amount), 0)::numeric as rev,
           (count(*) filter (where f.customer_type = 'new'))::int as nu,
           (count(*) filter (where f.customer_type = 'retention'))::int as ru
    from app.dashboard_facts(p) f
    where f.counting_month between v_from and v_to
    group by grouping sets ((f.counting_month), (f.counting_month, f.product_id), (f.counting_month, f.city_id))
  )
  select g.m, g.d, g.k, case g.d when 'product' then pr.code when 'city' then c.name end, g.u, g.rev, g.nu, g.ru
  from g
  left join public.products pr on g.d = 'product' and pr.id = g.k
  left join public.cities c on g.d = 'city' and c.id = g.k;
end;
$$;

-- People who carry a target (D-42): active Sales Agents and Team Leaders the caller may see, in their city.
create or replace function public.dashboard_people(p jsonb)
returns table (user_id uuid, full_name text, city_id uuid, team_name text, is_team_leader boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('dashboard.read');
  return query
  select u.id, u.full_name, u.city_id,
         coalesce((select t.name from public.teams t where t.team_leader_id = u.id and t.is_active order by t.name limit 1),
                  (select t.name from public.team_members tm join public.teams t on t.id = tm.team_id where tm.user_id = u.id order by t.name limit 1)),
         exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_key = 'team_leader')
  from public.user_profiles u
  where u.is_active
    and exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_key in ('agent', 'team_leader'))
    and u.id in (select su.user_id from app.scope_users('dashboard.read') su)
    and (app.dashboard_filter(p, 'city_id') is null or u.city_id = app.dashboard_filter(p, 'city_id'))
    and (app.dashboard_filter(p, 'agent_id') is null or u.id = app.dashboard_filter(p, 'agent_id'));
end;
$$;

-- Sellers for the agent filter: people the caller may see who sell or have sold.
create or replace function public.dashboard_agents()
returns table (user_id uuid, full_name text, city_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('dashboard.read');
  return query
  select u.id, u.full_name, u.city_id
  from public.user_profiles u
  where u.id in (select su.user_id from app.scope_users('dashboard.read') su)
    and (exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_key in ('agent', 'team_leader'))
         or exists (select 1 from public.sales s where s.agent_id = u.id))
  order by u.full_name;
end;
$$;

-- The sales behind a figure (BRD §9.3 drill-down): same buckets and filters as dashboard_figures.
create or replace function public.dashboard_sales_list(p jsonb, p_bucket text)
returns table (
  sale_id uuid, submitted_at timestamptz, approved_at timestamptz, counting_month date, status text, agent_name text,
  customer_name text, product_code text, customer_type text, amount numeric, city_name text, branch_name text, on_hold boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('dashboard.read');
  if p_bucket not in ('overall', 'month', 'last_month', 'period', 'submitted_month', 'submitted_period', 'pending') then
    raise exception 'BUCKET_INVALID';
  end if;
  return query
  select s.id, s.submitted_at, s.approved_at, t.counting_month, s.status, up.full_name, s.customer_name, pr.code, s.customer_type,
         s.amount_collected, c.name, br.name, t.on_hold
  from app.dashboard_tagged(p) t
  join public.sales s on s.id = t.sale_id
  join public.user_profiles up on up.id = s.agent_id
  join public.products pr on pr.id = s.product_id
  join public.cities c on c.id = s.city_id
  join public.branches br on br.id = s.branch_id
  where t.bucket = p_bucket
  order by s.submitted_at desc
  limit 500;
end;
$$;

-- Stock received (Central Store, company-wide) and issued to customers, per item, in the period's dates.
-- Received only for stock.read 'all'; issued follows the caller's stock locations and the city / branch /
-- agent / product filters (through the sale or switch it was issued for). Agents (stock.read own) get nothing.
create or replace function public.dashboard_stock(p jsonb)
returns table (item_id uuid, code text, name text, received int, issued int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := app.permission_scope('stock.read');
  r record;
  v_t0 timestamptz;
  v_t1 timestamptz;
begin
  if v_scope is null or v_scope = 'own' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.dashboard_period(p);
  v_t0 := r.from_date::timestamp at time zone 'Africa/Mogadishu';
  v_t1 := (r.to_date + 1)::timestamp at time zone 'Africa/Mogadishu';
  return query
  with issues as (
    select m.item_id, m.quantity
    from public.stock_movements m
    left join public.sales s on m.ref_type = 'sale' and s.id = m.ref_id
    left join public.product_switches w on m.ref_type = 'switch' and w.id = m.ref_id
    where m.movement_type = 'issue' and m.occurred_at >= v_t0 and m.occurred_at < v_t1
      and app.can_read_location(m.from_location_id)
      and (app.dashboard_filter(p, 'city_id') is null or coalesce(s.city_id, w.city_id) = app.dashboard_filter(p, 'city_id'))
      and (app.dashboard_filter(p, 'branch_id') is null or coalesce(s.branch_id, w.branch_id) = app.dashboard_filter(p, 'branch_id'))
      and (app.dashboard_filter(p, 'agent_id') is null or coalesce(s.agent_id, w.agent_id) = app.dashboard_filter(p, 'agent_id'))
      and (app.dashboard_filter(p, 'product_id') is null or coalesce(s.product_id, w.to_product_id) = app.dashboard_filter(p, 'product_id'))
  ),
  receipts as (
    select m.item_id, m.quantity
    from public.stock_movements m join public.stock_locations l on l.id = m.to_location_id and l.kind = 'central'
    where m.movement_type = 'receipt' and m.occurred_at >= v_t0 and m.occurred_at < v_t1
  )
  select i.id, i.code, i.display_name,
         case when v_scope = 'all' then coalesce((select sum(x.quantity) from receipts x where x.item_id = i.id), 0)::int end,
         coalesce((select sum(x.quantity) from issues x where x.item_id = i.id), 0)::int
  from public.stock_items i
  where i.is_active
  order by i.sort_order, i.code;
end;
$$;

-- Audit figures (audit.read): duplicate attempts in the period, open cases, cases open longer than 7 days.
create or replace function public.dashboard_audit(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  perform app.require_permission('audit.read');
  select * into r from app.dashboard_period(p);
  return jsonb_build_object(
    'duplicate_attempts', (select count(*) from public.audit_events e
      where e.rule_code in ('DUP_PHONE', 'DUP_INDEX')
        and e.occurred_at >= (r.from_date::timestamp at time zone 'Africa/Mogadishu')
        and e.occurred_at < ((r.to_date + 1)::timestamp at time zone 'Africa/Mogadishu')),
    'open_cases', (select count(*) from public.audit_cases c where c.status in ('open', 'under_review')),
    'older_than_7_days', (select count(*) from public.audit_cases c
      where c.status in ('open', 'under_review') and c.opened_at < now() - interval '7 days'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function app.dashboard_period(jsonb), app.eligible_sale_facts(), app.eligible_sales(date),
  app.scope_users(text), app.dashboard_filter(jsonb, text), app.dashboard_facts(jsonb), app.dashboard_submitted(jsonb),
  app.dashboard_tagged(jsonb), app.require_permission(text) from public;

revoke execute on function public.dashboard_context(jsonb), public.dashboard_figures(jsonb), public.dashboard_trend(jsonb, int),
  public.dashboard_people(jsonb), public.dashboard_agents(), public.dashboard_sales_list(jsonb, text),
  public.dashboard_stock(jsonb), public.dashboard_audit(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dashboard_context(jsonb), public.dashboard_figures(jsonb), public.dashboard_trend(jsonb, int),
  public.dashboard_people(jsonb), public.dashboard_agents(), public.dashboard_sales_list(jsonb, text),
  public.dashboard_stock(jsonb), public.dashboard_audit(jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261103090000', 'dashboard');

-- ================================ 20261104090000_readiness ================================
-- Phase 11 — Pilot readiness (Roadmap Phase 11; SDD §19, §26.3; R-10, R-11)
--
--  * app.readiness_report(city): the automated go-live checks for a pilot city — every active product priced,
--    districts, agents with city / team / team stock, teams with an active leader and stock, Settings values,
--    Super Admin and Stock Officer accounts, opening stock received and accepted, SMS code on, no test data.
--  * app.opening_stock_summary(): per item, what was received and where it is now; `difference` must be 0
--    (received + adjustments = held + in transit + issued + removed). The Stock Officer compares `received`
--    with the physical count (R-11).
--  * Public wrappers for the Settings → Pilot readiness page (settings.manage; opening stock also anyone with stock.read all:
--    Stock Officer, Finance, Auditor).
--    The app functions can also be run directly in the SQL Editor (supabase/checks/readiness.sql).

-- ---------------------------------------------------------------------------
-- Readiness checks
-- ---------------------------------------------------------------------------
create or replace function app.readiness_report(p_city uuid)
returns table (check_key text, required boolean, ok boolean, n int, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Mogadishu')::date;
  v_names jsonb;
  v_count int;
begin
  if not exists (select 1 from public.cities where id = p_city) then raise exception 'NOT_FOUND'; end if;

  -- Every active product has at least one active plan with a price in force today (FR-CONF-01, D-34).
  select coalesce(jsonb_agg(p.code order by p.sort_order), '[]'::jsonb), count(*) into v_names, v_count
  from public.products p
  where p.is_active and not exists (
    select 1 from public.plans pl join public.plan_prices pp on pp.plan_id = pl.id
    where pl.product_id = p.id and pl.is_active and pp.effective_from <= v_today
      and (pp.effective_to is null or pp.effective_to >= v_today));
  return query select 'products_priced'::text, true, v_count = 0, v_count, v_names;

  -- Districts for the city (FR-USER-10).
  select count(*) into v_count from public.districts d where d.city_id = p_city and d.is_active;
  return query select 'city_districts'::text, true, v_count > 0, v_count, '[]'::jsonb;

  -- Teams of the city: at least one, each with an active Team Leader and a team stock (D-35).
  select count(*) into v_count from public.teams t where t.city_id = p_city and t.is_active;
  return query select 'city_teams'::text, true, v_count > 0, v_count, '[]'::jsonb;

  select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb), count(*) into v_names, v_count
  from public.teams t
  where t.city_id = p_city and t.is_active
    and (not exists (select 1 from public.user_profiles u join public.user_roles ur on ur.user_id = u.id
                     where u.id = t.team_leader_id and u.is_active and ur.role_key = 'team_leader')
         or not exists (select 1 from public.stock_locations l where l.team_id = t.id));
  return query select 'teams_ready'::text, true, v_count = 0, v_count, v_names;

  -- Active Sales Agents of the city (or with no city): city set, in one active team of that city with stock.
  select coalesce(jsonb_agg(u.full_name order by u.full_name), '[]'::jsonb), count(*) into v_names, v_count
  from public.user_profiles u
  where u.is_active
    and exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_key = 'agent')
    and (u.city_id = p_city or u.city_id is null)
    and (u.city_id is null or not exists (
      select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
      join public.stock_locations l on l.team_id = t.id
      where tm.user_id = u.id and t.is_active and t.city_id = u.city_id));
  return query select 'agents_ready'::text, true, v_count = 0, v_count, v_names;

  select count(*) into v_count from public.user_profiles u
  where u.is_active and u.city_id = p_city
    and exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_key = 'agent');
  return query select 'city_agents'::text, true, v_count > 0, v_count, '[]'::jsonb;

  -- Settings that payroll and performance depend on (SDD §8.3).
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb), count(*) into v_names, v_count
  from unnest(array['temp_base_salary', 'incentive_threshold', 'incentive_rate', 'payroll_cutoff_day',
                    'performance_target_units', 'performance_baseline_units', 'free_month_amount', 'week_start_day']) k
  where not exists (select 1 from public.app_settings s where s.key = k and s.value is not null and s.value <> 'null'::jsonb);
  if v_count = 0 and (
       (select (value #>> '{}')::numeric from public.app_settings where key = 'temp_base_salary') <= 0
    or (select (value #>> '{}')::numeric from public.app_settings where key = 'performance_baseline_units')
       >= (select (value #>> '{}')::numeric from public.app_settings where key = 'performance_target_units')) then
    v_names := '["values"]'::jsonb;
    v_count := 1;
  end if;
  return query select 'settings'::text, true, v_count = 0, v_count, v_names;

  select count(*) into v_count from public.app_settings where key = 'otp_enabled' and value = 'true'::jsonb;
  return query select 'otp_enabled'::text, true, v_count = 1, v_count, '[]'::jsonb;

  -- People: Super Admins (two recommended, so one can stand in) and a Stock Officer.
  select count(*) into v_count from public.user_profiles u join public.user_roles ur on ur.user_id = u.id
  where u.is_active and ur.role_key = 'super_admin';
  return query select 'super_admins'::text, false, v_count >= 2, v_count, '[]'::jsonb;

  select count(*) into v_count from public.user_profiles u join public.user_roles ur on ur.user_id = u.id
  where u.is_active and ur.role_key = 'stock_officer';
  return query select 'stock_officer'::text, true, v_count > 0, v_count, '[]'::jsonb;

  -- Opening stock: every active item received into the Central Store; nothing waiting for acceptance (R-11).
  select coalesce(jsonb_agg(i.display_name order by i.sort_order), '[]'::jsonb), count(*) into v_names, v_count
  from public.stock_items i
  where i.is_active and not exists (select 1 from public.stock_movements m where m.item_id = i.id and m.movement_type = 'receipt');
  return query select 'opening_stock_received'::text, true, v_count = 0, v_count, v_names;

  select count(*) into v_count from public.stock_transfers t where t.status = 'sent';
  return query select 'deliveries_accepted'::text, true, v_count = 0, v_count, '[]'::jsonb;

  select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb), count(*) into v_names, v_count
  from public.teams t join public.stock_locations l on l.team_id = t.id
  where t.city_id = p_city and t.is_active
    and not exists (select 1 from public.stock_items i where i.is_active and app.location_balance(l.id, i.id) > 0);
  return query select 'teams_have_stock'::text, false, v_count = 0, v_count, v_names;

  -- No test data in production: test-looking accounts or customers (names only, never phones).
  select coalesce(jsonb_agg(x.name order by x.name), '[]'::jsonb), count(*) into v_names, v_count
  from (
    select u.full_name as name from public.user_profiles u left join auth.users a on a.id = u.id
    where u.full_name ~* '\mtest\M' or a.email ~* '(@|\.)example\.|\.test$|\.invalid$'
    union all
    select c.full_name from public.customers c where c.full_name ~* '\mtest\M'
  ) x;
  return query select 'no_test_data'::text, true, v_count = 0, v_count, v_names;
end;
$$;
comment on function app.readiness_report(uuid) is
  'Pilot go-live checks for one city (Roadmap Phase 11). required = must pass before go-live; the rest are advice.';

-- ---------------------------------------------------------------------------
-- Opening stock reconciliation (R-11): per item, received vs where it is now
-- ---------------------------------------------------------------------------
create or replace function app.opening_stock_summary()
returns table (
  item_id uuid, code text, name text, received int, adjusted int, central int, faulty int, teams int,
  in_transit int, issued int, removed int, difference int
)
language sql
stable
security definer
set search_path = ''
as $$
  with mv as (
    select m.item_id,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'receipt'), 0) as received,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'adjustment' and m.to_location_id is not null), 0)
        - coalesce(sum(m.quantity) filter (where m.movement_type = 'adjustment' and m.from_location_id is not null), 0) as adjusted,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'issue'), 0) as issued,
      coalesce(sum(m.quantity) filter (where m.to_location_id is null and m.movement_type not in ('issue', 'adjustment')), 0) as removed
    from public.stock_movements m
    group by m.item_id
  ),
  held as (
    select i.id as item_id,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'central'), 0) as central,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'faulty'), 0) as faulty,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'team'), 0) as teams
    from public.stock_items i cross join public.stock_locations l
    group by i.id
  ),
  transit as (
    select tl.item_id, sum(tl.quantity) as qty
    from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id
    where t.status = 'sent'
    group by tl.item_id
  )
  select i.id, i.code, i.display_name,
    coalesce(mv.received, 0)::int, coalesce(mv.adjusted, 0)::int, h.central::int, h.faulty::int, h.teams::int,
    coalesce(tr.qty, 0)::int, coalesce(mv.issued, 0)::int, coalesce(mv.removed, 0)::int,
    (coalesce(mv.received, 0) + coalesce(mv.adjusted, 0) - coalesce(mv.issued, 0) - coalesce(mv.removed, 0)
      - h.central - h.faulty - h.teams - coalesce(tr.qty, 0))::int
  from public.stock_items i
  join held h on h.item_id = i.id
  left join mv on mv.item_id = i.id
  left join transit tr on tr.item_id = i.id
  where i.is_active
  order by i.sort_order, i.code
$$;
comment on function app.opening_stock_summary() is
  'Per item: received, adjustments, held (central / faulty / teams), in transit, issued, removed; difference must be 0 (R-11).';

-- ---------------------------------------------------------------------------
-- Public wrappers (Settings → Pilot readiness)
-- ---------------------------------------------------------------------------
create or replace function public.readiness_report(p_city uuid)
returns table (check_key text, required boolean, ok boolean, n int, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() or not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select * from app.readiness_report(p_city);
end;
$$;

create or replace function public.opening_stock_summary()
returns table (
  item_id uuid, code text, name text, received int, adjusted int, central int, faulty int, teams int,
  in_transit int, issued int, removed int, difference int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user()
     or not (app.has_permission('settings.manage') or app.permission_scope('stock.read') = 'all') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select * from app.opening_stock_summary();
end;
$$;

revoke execute on function app.readiness_report(uuid), app.opening_stock_summary() from public;
revoke execute on function public.readiness_report(uuid), public.opening_stock_summary() from public, anon, authenticated, service_role;
grant execute on function public.readiness_report(uuid), public.opening_stock_summary() to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261104090000', 'readiness');

-- ================================ 20261107090000_refunds ================================
-- Phase 12 — Refunds (BRD §6.5 FR-REF-01…08, BR-03, D-15, D-40; SDD §10.5; Roadmap Phase 12; T-28).
--
-- refunds                       : one request per sale at a time (pending or approved); rejected ones stay as history
--                                 and a new request may follow. Snapshot of customer name, product, branch and the
--                                 amount collected; phone and Index stay on the customer (never copied).
-- payroll_pending_adjustments   : the payroll hook (FR-REF-07). A refund approved after the sale's counting month was
--                                 finalized creates a negative adjustment waiting for the next payroll run (Phase 16
--                                 consumes it). Before finalization the sale simply stops being eligible.
-- public.create_refund          : agents (own sales), Team Leaders (team, their own included), Super Admin (all).
-- public.decide_refund          : Super Admin only (refunds.approve); never a refund one requested. Approve sets the
--                                 sale to 'reversed' (never deleted); reject changes nothing.
-- public.refund_record_return   : Stock Officer (stock.transfer) records the device coming back, linked to the refund.
-- public.refunds_to_collect     : approved refunds whose devices have not all come back (Stock → Returns).
-- public.refund_equipment       : given / returned per refund the caller may see (Refunds page).
-- HIGH_REFUND_RATE              : audit rule, off by default (agent refund rate over a window).
-- Also: opening-stock reconciliation counts devices returned by customers (Phase 11 fix).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  sale_id           uuid not null references public.sales (id),
  agent_id          uuid not null references public.user_profiles (id),   -- the sale's agent (scope)
  team_id           uuid references public.teams (id),
  customer_id       uuid not null references public.customers (id),
  customer_name     text not null,                                       -- as on the sale
  product_id        uuid not null references public.products (id),
  branch_id         uuid not null references public.branches (id),       -- the sale's branch (FR-SALE-22)
  amount_collected  numeric(10, 2) not null,                             -- the sale's amount (snapshot)
  amount            numeric(10, 2) not null check (amount > 0),
  reason            text not null check (reason in ('out_of_boundary', 'technical_delay', 'refused', 'no_signal', 'other')),
  note              text check (note is null or length(note) <= 500),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by      uuid not null references public.user_profiles (id),
  requested_at      timestamptz not null default now(),
  decided_by        uuid references public.user_profiles (id),
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or length(decision_note) <= 500),
  counting_month    date,                                                -- the sale's counting month at approval
  payroll_effect    text check (payroll_effect in ('excluded', 'adjustment')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint refunds_request_unique unique (client_request_id),
  constraint refunds_amount_max check (amount <= amount_collected),
  constraint refunds_other_note check (reason <> 'other' or length(btrim(coalesce(note, ''))) >= 3),
  constraint refunds_decided check ((status = 'pending') = (decided_by is null and decided_at is null)),
  constraint refunds_effect check ((status = 'approved') = (payroll_effect is not null and counting_month is not null))
);
-- One live refund per sale (FR-REF / SDD §8.3); a rejected request stays as history (T-28).
create unique index refunds_one_per_sale on public.refunds (sale_id) where status in ('pending', 'approved');
create index refunds_status_idx on public.refunds (status, requested_at desc);
create index refunds_agent_idx on public.refunds (agent_id, requested_at desc);
create trigger refunds_touch before update on public.refunds for each row execute function app.touch_updated();
comment on table public.refunds is
  'Refund requests (BRD §6.5). Written only by public.create_refund / public.decide_refund; approval reverses the sale (never deletes it).';

-- Decided refunds never change again.
create or replace function app.refund_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'refunds cannot be deleted'; end if;
  if old.status <> 'pending' then raise exception 'a decided refund cannot be changed'; end if;
  if new.sale_id <> old.sale_id or new.amount <> old.amount or new.reason <> old.reason
     or new.requested_by <> old.requested_by or new.requested_at <> old.requested_at then
    raise exception 'a refund request cannot be edited';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger refunds_guard before update or delete on public.refunds for each row execute function app.refund_guard();

create table public.payroll_pending_adjustments (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null check (source_type in ('refund')),
  source_id      uuid not null,
  sale_id        uuid not null references public.sales (id),
  agent_id       uuid not null references public.user_profiles (id),
  original_month date not null,                     -- the finalized counting month the sale was paid in
  units_delta    int not null check (units_delta < 0),
  revenue_delta  numeric(10, 2) not null check (revenue_delta < 0),
  reason         text not null,
  created_at     timestamptz not null default now(),
  constraint payroll_pending_source_unique unique (source_type, source_id)
);
create trigger payroll_pending_adjustments_append_only before update or delete on public.payroll_pending_adjustments
  for each row execute function app.prevent_change();
comment on table public.payroll_pending_adjustments is
  'Corrections for months already finalized (FR-REF-07, FR-PAY-13): consumed by the next payroll run (Phase 16). Finalized payroll is never edited.';

-- ---------------------------------------------------------------------------
-- Payroll hook
-- ---------------------------------------------------------------------------
-- Is this counting month finalized? No payroll runs exist before Phase 16, so nothing is finalized yet;
-- Phase 16 replaces this function to read payroll_runs.
create or replace function app.month_finalized(p_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;
comment on function app.month_finalized(date) is 'True when the payroll month is finalized (Phase 16 replaces this; false until then).';

-- The month an approved sale counts in (same rule as app.eligible_sale_facts, BRD §8.2): the sale month when approved
-- before the payroll cutoff day of the next month (EAT), otherwise the business month of approval.
create or replace function app.sale_counting_month(p_sale_month date, p_approved_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_approved_at < ((p_sale_month + interval '1 month'
            + make_interval(days => coalesce((select (value #>> '{}')::int from public.app_settings where key = 'payroll_cutoff_day'), 3)))::timestamp
            at time zone 'Africa/Mogadishu')
    then p_sale_month
    else app.business_month(p_approved_at)
  end
$$;

-- ---------------------------------------------------------------------------
-- Notifications: refund kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('sale_pending', 'sale_approved',
  'sale_rejected', 'switch_pending', 'switch_approved', 'switch_rejected', 'stock_to_accept', 'audit_alert', 'audit_case_assigned',
  'refund_pending', 'refund_approved', 'refund_rejected', 'refund_return'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('sales', 'product_switches', 'stock_transfers', 'audit_cases', 'refunds'));

-- Active users holding a permission at scope 'all' (e.g. Stock Officers for stock.transfer).
create or replace function app.users_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_key = ur.role_key
  join public.user_profiles p on p.id = ur.user_id
  where rp.permission_key = p_permission and rp.scope = 'all' and p.is_active
$$;

create or replace function app.notify_new_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'refund_pending', 'refunds', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.requested_by)))
  from app.super_admins() a
  where a <> new.requested_by;
  return null;
end;
$$;
create trigger refunds_notify after insert on public.refunds for each row execute function app.notify_new_refund();

-- ---------------------------------------------------------------------------
-- Visibility (used by RLS and the helper functions)
-- ---------------------------------------------------------------------------
create or replace function app.refund_visible(p_agent uuid, p_requester uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user() and (
    p_requester = auth.uid()
    or app.in_scope('refunds.submit', p_agent)
    or app.in_scope('sales.read', p_agent)
    or app.has_permission('refunds.approve'))
$$;

-- ---------------------------------------------------------------------------
-- Submit (FR-REF-01…03, 06)
-- ---------------------------------------------------------------------------
-- p: { client_request_id, sale_id, amount, reason, note? }. Returns { refund_id, existing }.
create or replace function public.create_refund(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.refunds;
  v_sale public.sales;
  v_amount numeric;
  v_reason text := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_id uuid;
begin
  if not app.has_permission('refunds.submit') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.refunds where client_request_id = v_request;
  if found then
    if v_existing.requested_by <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('refund_id', v_existing.id, 'existing', true);
  end if;

  begin
    select * into v_sale from public.sales where id = (p ->> 'sale_id')::uuid for update;
  exception when invalid_text_representation then
    raise exception 'NOT_FOUND';
  end;
  if v_sale.id is null or not app.in_scope('refunds.submit', v_sale.agent_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_sale.status <> 'approved' then raise exception 'SALE_NOT_REFUNDABLE'; end if;
  if exists (select 1 from public.refunds where sale_id = v_sale.id and status in ('pending', 'approved')) then
    raise exception 'REFUND_EXISTS';
  end if;

  begin
    v_amount := (p ->> 'amount')::numeric;
  exception when others then
    raise exception 'REFUND_AMOUNT';
  end;
  if v_amount is null or v_amount <= 0 or v_amount > v_sale.amount_collected or v_amount <> round(v_amount, 2) then
    raise exception 'REFUND_AMOUNT';
  end if;
  if v_reason is null or v_reason not in ('out_of_boundary', 'technical_delay', 'refused', 'no_signal', 'other') then
    raise exception 'REASON_REQUIRED';
  end if;
  if v_reason = 'other' and (v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;

  insert into public.refunds (client_request_id, sale_id, agent_id, team_id, customer_id, customer_name, product_id, branch_id,
    amount_collected, amount, reason, note, requested_by)
  values (v_request, v_sale.id, v_sale.agent_id, v_sale.team_id, v_sale.customer_id, v_sale.customer_name, v_sale.product_id,
    v_sale.branch_id, v_sale.amount_collected, v_amount, v_reason, v_note, v_me)
  returning id into v_id;
  perform app.log_activity('refund.submit', 'refunds', v_id,
    jsonb_build_object('sale_id', v_sale.id, 'amount', v_amount, 'reason', v_reason));
  return jsonb_build_object('refund_id', v_id, 'existing', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- HIGH_REFUND_RATE (SDD §11.2): off by default
-- ---------------------------------------------------------------------------
insert into public.audit_rules (code, name, description, severity, enabled, can_disable, opens_case, threshold, sort_order) values
  ('HIGH_REFUND_RATE', 'High refund rate', 'Approved refunds of one agent''s sales reached a high share of the agent''s approved sales within a period.',
   'medium', false, true, true, '{"percent": 20, "refunds": 3, "days": 30}', 95);

-- Rate = refunds approved in the window ÷ sales approved in the window (at least the refunds). One event per agent per window.
create or replace function app.check_refund_rate(p_agent uuid, p_refund uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_pct int;
  v_min int;
  v_days int;
  v_refunds int;
  v_sales int;
begin
  if not app.rule_enabled('HIGH_REFUND_RATE') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'HIGH_REFUND_RATE';
  v_pct := coalesce((v_t ->> 'percent')::int, 20);
  v_min := coalesce((v_t ->> 'refunds')::int, 3);
  v_days := coalesce((v_t ->> 'days')::int, 30);
  select count(*) into v_refunds from public.refunds
   where agent_id = p_agent and status = 'approved' and decided_at >= now() - make_interval(days => v_days);
  if v_refunds < v_min then return; end if;
  select count(*) into v_sales from public.sales
   where agent_id = p_agent and status in ('approved', 'reversed') and approved_at >= now() - make_interval(days => v_days);
  v_sales := greatest(v_sales, v_refunds);
  if v_refunds * 100 < v_pct * v_sales then return; end if;
  if exists (select 1 from public.audit_events where rule_code = 'HIGH_REFUND_RATE' and context ->> 'agent_id' = p_agent::text
             and occurred_at >= now() - make_interval(days => v_days)) then
    return;
  end if;
  perform app.rule_event('HIGH_REFUND_RATE',
    jsonb_build_object('refunds', v_refunds, 'sales', v_sales, 'percent', round(v_refunds * 100.0 / v_sales), 'days', v_days),
    null, null, jsonb_build_object('source', 'decide_refund', 'agent_id', p_agent, 'refund_id', p_refund));
end;
$$;

-- Thresholds editable like the other rules (adds HIGH_REFUND_RATE to Phase 9's function).
create or replace function public.audit_rule_update(p_code text, p_enabled boolean, p_threshold jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.audit_rules;
  v_t jsonb := '{}'::jsonb;
  v_a int;
  v_b int;
  v_c int;
begin
  if not app.is_active_user() or not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.audit_rules where code = p_code for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not r.can_disable and not coalesce(p_enabled, false) then raise exception 'RULE_REQUIRED'; end if;
  begin
    if p_code = 'MULTI_AGENT_ATTEMPT' then
      v_a := (p_threshold ->> 'agents')::int; v_b := (p_threshold ->> 'days')::int;
      if v_a is null or v_a not between 2 and 10 or v_b is null or v_b not between 1 and 90 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('agents', v_a, 'days', v_b);
    elsif p_code = 'BURST' then
      v_a := (p_threshold ->> 'sales')::int; v_b := (p_threshold ->> 'minutes')::int;
      if v_a is null or v_a not between 2 and 50 or v_b is null or v_b not between 5 and 1440 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('sales', v_a, 'minutes', v_b);
    elsif p_code = 'HIGH_REFUND_RATE' then
      v_a := (p_threshold ->> 'percent')::int; v_b := (p_threshold ->> 'refunds')::int; v_c := (p_threshold ->> 'days')::int;
      if v_a is null or v_a not between 1 and 100 or v_b is null or v_b not between 1 and 50 or v_c is null or v_c not between 1 and 365 then
        raise exception 'THRESHOLD_INVALID';
      end if;
      v_t := jsonb_build_object('percent', v_a, 'refunds', v_b, 'days', v_c);
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'THRESHOLD_INVALID';
  end;
  update public.audit_rules set enabled = coalesce(p_enabled, false), threshold = v_t, updated_by = auth.uid() where code = p_code;
  perform app.log_activity('audit.rule_update', 'audit_rules', null,
    jsonb_build_object('code', p_code, 'enabled', coalesce(p_enabled, false), 'threshold', v_t));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decide (Super Admin only — BR-03, FR-REF-03…05, 07; UAT-07, 17)
-- ---------------------------------------------------------------------------
create or replace function public.decide_refund(p_refund uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_refund public.refunds;
  v_sale public.sales;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_month date;
  v_effect text;
begin
  if app.permission_scope('refunds.approve') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_approve is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_refund from public.refunds where id = p_refund for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_refund.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if v_refund.requested_by = v_me or v_refund.agent_id = v_me then raise exception 'SELF_APPROVAL'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;

  if not p_approve then
    if v_note is null or length(v_note) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.refunds set status = 'rejected', decided_by = v_me, decided_at = now(), decision_note = v_note, updated_by = v_me
     where id = p_refund;
    perform app.log_activity('refund.reject', 'refunds', p_refund, jsonb_build_object('sale_id', v_refund.sale_id));
    perform app.notify(u, 'refund_rejected', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name, 'reason', v_note))
    from (select distinct unnest(array[v_refund.requested_by, v_refund.agent_id]) as u) x;
    return;
  end if;

  select * into v_sale from public.sales where id = v_refund.sale_id for update;
  if v_sale.status <> 'approved' then raise exception 'SALE_NOT_REFUNDABLE'; end if;
  v_month := app.sale_counting_month(v_sale.sale_month, v_sale.approved_at);
  v_effect := case when app.month_finalized(v_month) then 'adjustment' else 'excluded' end;

  -- The sale stays; it is marked reversed and drops out of eligible sales (FR-REF-05, BRD §8.2).
  update public.sales set status = 'reversed', updated_by = v_me where id = v_sale.id;
  update public.refunds set status = 'approved', decided_by = v_me, decided_at = now(), decision_note = v_note,
         counting_month = v_month, payroll_effect = v_effect, updated_by = v_me
   where id = p_refund;
  if v_effect = 'adjustment' then
    insert into public.payroll_pending_adjustments (source_type, source_id, sale_id, agent_id, original_month, units_delta, revenue_delta, reason)
    values ('refund', p_refund, v_sale.id, v_sale.agent_id, v_month, -1, -v_sale.amount_collected,
            'Refund approved after ' || to_char(v_month, 'FMMonth YYYY') || ' was finalized');
  end if;
  perform app.log_activity('refund.approve', 'refunds', p_refund,
    jsonb_build_object('sale_id', v_sale.id, 'amount', v_refund.amount, 'counting_month', v_month, 'payroll_effect', v_effect));
  perform app.notify(u, 'refund_approved', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name))
  from (select distinct unnest(array[v_refund.requested_by, v_refund.agent_id]) as u) x;
  -- Devices given on the sale should come back to the Stock Officer (FR-REF-08).
  if exists (select 1 from public.sale_items where sale_id = v_sale.id) then
    perform app.notify(u, 'refund_return', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name))
    from app.users_with_permission('stock.transfer') u;
  end if;
  perform app.check_refund_rate(v_sale.agent_id, p_refund);
end;
$$;

-- ---------------------------------------------------------------------------
-- Equipment coming back (FR-REF-08, FR-STK-10: Stock Officer only)
-- ---------------------------------------------------------------------------
create or replace function app.refund_returned(p_refund uuid, p_item uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(quantity), 0)::int from public.stock_movements
  where ref_type = 'refund' and ref_id = p_refund and item_id = p_item and movement_type = 'return'
$$;

create or replace function public.refund_record_return(p_refund uuid, p_item uuid, p_quantity int, p_faulty boolean default false, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
  v_given int;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.permission_scope('stock.transfer') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_refund from public.refunds where id = p_refund for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_refund.status <> 'approved' then raise exception 'REFUND_NOT_APPROVED'; end if;
  select quantity into v_given from public.sale_items where sale_id = v_refund.sale_id and stock_item_id = p_item;
  if v_given is null then raise exception 'UNKNOWN_ITEM'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'INVALID_QUANTITY'; end if;
  if app.refund_returned(p_refund, p_item) + p_quantity > v_given then raise exception 'RETURN_TOO_MANY'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;
  perform app.record_movement('return', p_item, p_quantity, null,
    app.location_of(case when coalesce(p_faulty, false) then 'faulty' else 'central' end),
    'refund', p_refund, 'refund' || coalesce(': ' || v_note, ''));
  perform app.log_activity('stock.return', 'refunds', p_refund,
    jsonb_build_object('reason', 'refund', 'item_id', p_item, 'quantity', p_quantity, 'faulty', coalesce(p_faulty, false)));
end;
$$;

-- Approved refunds with devices still to come back (Stock Officer list). No phone or Index.
create or replace function public.refunds_to_collect()
returns table (refund_id uuid, decided_at timestamptz, customer_name text, team text, agent text, item_id uuid, item text, given int, returned int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.permission_scope('stock.transfer') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.id, r.decided_at, r.customer_name, t.name, p.full_name, si.stock_item_id, i.display_name, si.quantity,
           app.refund_returned(r.id, si.stock_item_id)
    from public.refunds r
    join public.sale_items si on si.sale_id = r.sale_id
    join public.stock_items i on i.id = si.stock_item_id
    left join public.teams t on t.id = r.team_id
    left join public.user_profiles p on p.id = r.agent_id
    where r.status = 'approved' and app.refund_returned(r.id, si.stock_item_id) < si.quantity
    order by r.decided_at, i.sort_order;
end;
$$;

-- Given / returned per refund for the Refunds page (only refunds the caller may see).
create or replace function public.refund_equipment(p_refunds uuid[])
returns table (refund_id uuid, item text, given int, returned int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, i.display_name, si.quantity, app.refund_returned(r.id, si.stock_item_id)
  from public.refunds r
  join public.sale_items si on si.sale_id = r.sale_id
  join public.stock_items i on i.id = si.stock_item_id
  where r.id = any (p_refunds) and app.refund_visible(r.agent_id, r.requested_by)
  order by i.sort_order
$$;

-- ---------------------------------------------------------------------------
-- Opening stock (Phase 11 fix): devices returned by customers reduce "issued" (net with customers).
-- ---------------------------------------------------------------------------
create or replace function app.opening_stock_summary()
returns table (
  item_id uuid, code text, name text, received int, adjusted int, central int, faulty int, teams int,
  in_transit int, issued int, removed int, difference int
)
language sql
stable
security definer
set search_path = ''
as $$
  with mv as (
    select m.item_id,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'receipt'), 0) as received,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'adjustment' and m.to_location_id is not null), 0)
        - coalesce(sum(m.quantity) filter (where m.movement_type = 'adjustment' and m.from_location_id is not null), 0) as adjusted,
      coalesce(sum(m.quantity) filter (where m.movement_type = 'issue'), 0)
        - coalesce(sum(m.quantity) filter (where m.movement_type = 'return' and m.from_location_id is null), 0) as issued,
      coalesce(sum(m.quantity) filter (where m.to_location_id is null and m.movement_type not in ('issue', 'adjustment')), 0) as removed
    from public.stock_movements m
    group by m.item_id
  ),
  held as (
    select i.id as item_id,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'central'), 0) as central,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'faulty'), 0) as faulty,
      coalesce(sum(app.location_balance(l.id, i.id)) filter (where l.kind = 'team'), 0) as teams
    from public.stock_items i cross join public.stock_locations l
    group by i.id
  ),
  transit as (
    select tl.item_id, sum(tl.quantity) as qty
    from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id
    where t.status = 'sent'
    group by tl.item_id
  )
  select i.id, i.code, i.display_name,
    coalesce(mv.received, 0)::int, coalesce(mv.adjusted, 0)::int, h.central::int, h.faulty::int, h.teams::int,
    coalesce(tr.qty, 0)::int, coalesce(mv.issued, 0)::int, coalesce(mv.removed, 0)::int,
    (coalesce(mv.received, 0) + coalesce(mv.adjusted, 0) - coalesce(mv.issued, 0) - coalesce(mv.removed, 0)
      - h.central - h.faulty - h.teams - coalesce(tr.qty, 0))::int
  from public.stock_items i
  join held h on h.item_id = i.id
  left join mv on mv.item_id = i.id
  left join transit tr on tr.item_id = i.id
  where i.is_active
  order by i.sort_order, i.code
$$;

-- ---------------------------------------------------------------------------
-- RLS, grants, change history
-- ---------------------------------------------------------------------------
alter table public.refunds enable row level security;
alter table public.payroll_pending_adjustments enable row level security;
revoke all on public.refunds, public.payroll_pending_adjustments from anon, authenticated;
grant select on public.refunds, public.payroll_pending_adjustments to authenticated;

create policy refunds_read on public.refunds for select to authenticated
  using (app.refund_visible(agent_id, requested_by));
create policy payroll_pending_read on public.payroll_pending_adjustments for select to authenticated
  using (app.permission_scope('payroll.read') = 'all' or app.has_permission('refunds.approve'));

select app.enable_change_log('public.refunds');
select app.enable_change_log('public.payroll_pending_adjustments');

revoke execute on function app.refund_guard(), app.month_finalized(date), app.sale_counting_month(date, timestamptz),
  app.users_with_permission(text), app.notify_new_refund(), app.refund_visible(uuid, uuid), app.check_refund_rate(uuid, uuid),
  app.refund_returned(uuid, uuid) from public;
grant execute on function app.refund_visible(uuid, uuid) to authenticated;

revoke execute on function public.create_refund(jsonb), public.decide_refund(uuid, boolean, text),
  public.refund_record_return(uuid, uuid, int, boolean, text), public.refunds_to_collect(), public.refund_equipment(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_refund(jsonb), public.decide_refund(uuid, boolean, text),
  public.refund_record_return(uuid, uuid, int, boolean, text), public.refunds_to_collect(), public.refund_equipment(uuid[])
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261107090000', 'refunds');

commit;

select 'Applied all 19 changes successfully (up to 20261107090000_refunds)' as result;
