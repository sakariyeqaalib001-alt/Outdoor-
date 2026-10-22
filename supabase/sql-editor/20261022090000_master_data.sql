-- =====================================================================================
-- Sogasho Outdoor — database change 20261022090000_master_data
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261022090000_master_data.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022090000') then
    raise exception 'Already applied: 20261022090000_master_data. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021090000') then
    raise exception 'Apply 20261021090000_otp_for_everyone first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261022090000', 'master_data');

commit;

select 'Applied 20261022090000_master_data successfully' as result;
