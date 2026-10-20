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
