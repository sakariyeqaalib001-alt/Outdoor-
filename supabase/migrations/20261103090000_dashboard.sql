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
