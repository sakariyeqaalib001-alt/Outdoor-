-- =====================================================================================
-- Sogasho Outdoor — database change 20261104090000_readiness
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261104090000_readiness.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104090000') then
    raise exception 'Already applied: 20261104090000_readiness. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261103090000') then
    raise exception 'Apply 20261103090000_dashboard first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261104090000', 'readiness');

commit;

select 'Applied 20261104090000_readiness successfully' as result;
