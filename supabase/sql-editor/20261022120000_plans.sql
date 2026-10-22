-- =====================================================================================
-- Sogasho Outdoor — database change 20261022120000_plans
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261022120000_plans.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120000') then
    raise exception 'Already applied: 20261022120000_plans. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022090000') then
    raise exception 'Apply 20261022090000_master_data first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
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
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261022120000', 'plans');

commit;

select 'Applied 20261022120000_plans successfully' as result;
