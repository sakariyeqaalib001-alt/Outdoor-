-- =====================================================================================
-- Sogasho Outdoor — database change 20261024090000_sales
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261024090000_sales.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024090000') then
    raise exception 'Already applied: 20261024090000_sales. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022170000') then
    raise exception 'Apply 20261022170000_stock_supervisors first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261024090000', 'sales');

commit;

select 'Applied 20261024090000_sales successfully' as result;
