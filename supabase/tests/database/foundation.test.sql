-- pgTAP checks run by `supabase test db` against a real Supabase Postgres in CI.
-- The detailed behaviour tests live in tests/db (PGlite); this file confirms the same
-- migrations behave identically on Supabase itself.
create extension if not exists pgtap with schema extensions;

begin;
select plan(22);

select has_table('public', 'app_settings', 'app_settings exists');
select has_table('public', 'activity_log', 'activity_log exists');
select has_table('public', 'audit_events', 'audit_events exists');
select has_table('public', 'change_log', 'change_log exists');
select has_trigger('public', 'app_settings', 'zz_change_log', 'app_settings records its change history');

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')),
  'RLS is enabled on every public table'
);

select is(app.business_month('2026-10-31T20:59:59Z'), '2026-10-01'::date, '31 Oct 23:59 EAT is October');
select is(app.business_month('2026-10-31T21:00:00Z'), '2026-11-01'::date, '1 Nov 00:00 EAT is November');

-- A real, active user (Phase 3: the RLS gate requires a profile, a changed password and, for agents, OTP).
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-00000000000a', 'ci.user@example.test', '{"full_name":"CI User","employment_type":"permanent"}');
select has_table('public', 'user_profiles', 'user_profiles exists');
select is((select employment_type from public.user_profiles where id = '00000000-0000-4000-8000-00000000000a'), 'permanent', 'profile created automatically from the Auth user');
select is((select must_change_password from public.user_profiles where id = '00000000-0000-4000-8000-00000000000a'), true, 'new users must change their password');
update public.user_profiles set must_change_password = false where id = '00000000-0000-4000-8000-00000000000a';

-- Signed-in user: may append through the writer functions only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","session_id":"00000000-0000-4000-9000-000000000001"}', true);
select is((public.my_session_status() ->> 'status'), 'ok', 'active permanent user passes the session gate');

select isnt(app.log_activity('ci.check'), null, 'signed-in user can append to activity_log');
select isnt(app.record_audit_event('CI_CHECK', 'info'), null, 'signed-in user can record an audit event');
select is_empty($$ select * from public.activity_log $$, 'activity_log hidden without audit.read');
select throws_ok($$ insert into public.audit_events (rule_code) values ('FAKE_RULE') $$, '42501', null,
  'direct insert into audit_events is denied');
select throws_ok($$ update public.activity_log set occurred_at = now() $$, '42501', null,
  'signed-in user cannot update activity_log');

-- Table owner: rows now exist, so the append-only triggers must fire.
reset role;
select throws_ok($$ update public.activity_log set occurred_at = now() $$, '42501', null,
  'owner cannot update activity_log');
select throws_ok($$ delete from public.audit_events $$, '42501', null,
  'owner cannot delete audit_events');

insert into public.app_settings (key, value) values ('ci_check', '1');
select is((select operation from public.change_log where table_name = 'app_settings' and record_key = 'ci_check'), 'INSERT', 'insert recorded in change_log');
select throws_ok($$ delete from public.change_log $$, '42501', null, 'owner cannot delete change_log');

set local role anon;
select throws_ok($$ select * from public.app_settings $$, '42501', null, 'anon cannot read app_settings');

select * from finish();
rollback;
