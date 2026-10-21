-- =====================================================================================
-- Sogasho Outdoor — database change 20261021090000_otp_for_everyone
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261021090000_otp_for_everyone.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021090000') then
    raise exception 'Already applied: 20261021090000_otp_for_everyone. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020190000') then
    raise exception 'Apply 20261020190000_users_no_branch first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261021090000', 'otp_for_everyone');

commit;

select 'Applied 20261021090000_otp_for_everyone successfully' as result;
