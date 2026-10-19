-- pgTAP checks run by `supabase test db` against a real Supabase Postgres in CI.
-- The detailed behaviour tests live in tests/db (PGlite); this file confirms the same
-- migrations behave identically on Supabase itself.
create extension if not exists pgtap with schema extensions;

begin;
select plan(18);

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

-- Signed-in user: may append through the writer functions only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

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
