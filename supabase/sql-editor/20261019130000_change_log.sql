-- =====================================================================================
-- Sogasho Outdoor — database change 20261019130000_change_log
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261019130000_change_log.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261019130000') then
    raise exception 'Already applied: 20261019130000_change_log. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261019120000') then
    raise exception 'Apply 20261019120000_foundation first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261019130000', 'change_log');

commit;

select 'Applied 20261019130000_change_log successfully' as result;
