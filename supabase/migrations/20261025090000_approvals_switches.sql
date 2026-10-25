-- Phase 8 — Sale approval with equipment, product switch, in-app notifications
-- (BRD §6.4 FR-SALE-07/08, §6.10 FR-SW-01…06, §6.16 FR-NOT-03; SDD §10.3, §10.4, §18; D-14, D-16, D-35, D-37, D-38)
--
--  * Every sale waits for the agent's Team Leader / Outdoor Supervisor (D-37); Super Admin is the fallback and
--    decides the Team Leaders' own sales. Nobody approves their own sale. (A Super Admin may reject — cancel — a
--    sale of their own; approving one's own sale is always refused.)
--  * Approval records the equipment given; it is deducted from the SALE's team stock in the same transaction and
--    refused if short (FR-SALE-08, FR-STK-03). Approver can only approve or reject (with a reason).
--  * A rejected New sale releases the customer's phone and Index when the customer has no other sale (D-37).
--    Former numbers replaced by Super Admin stay reserved (BR-01); only released numbers can be used again.
--  * D-38 (owner, 25 Oct 2026): Super Admins do not register sales or switches; product switch FTTA ↔ FTTH goes
--    to the Supervisor like a sale (equipment at approval); the agent picks the new plan, no payment; "from"
--    product must be the customer's current product (latest approved sale or switch).
--  * A switch is never a sale, unit or revenue (D-16). Old equipment is returned via the Stock Officer (D-35).
--  * notifications: in-app messages (sale/switch awaiting decision, decided, stock to accept) — SDD §18.

-- ---------------------------------------------------------------------------
-- Releasable identifiers (D-37)
-- ---------------------------------------------------------------------------
alter table public.customer_identifiers
  add column released_at timestamptz,
  add column released_by uuid;
alter table public.customer_identifiers drop constraint identifier_unique;
create unique index customer_identifiers_unique_live on public.customer_identifiers (kind, value) where released_at is null;
comment on column public.customer_identifiers.released_at is
  'Set when a rejected New sale released the number (D-37); a released number may be registered again. Replaced numbers are never released (BR-01).';

-- Identity checks ignore released numbers; Super Admins do not sell (D-38).
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
  -- D-38: Super Admins do not register sales (nobody could approve them).
  if app.is_super_admin(v_me) then raise exception 'SUPER_ADMIN_NO_SALES'; end if;

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

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  v_attempt := jsonb_build_object('customer_type', v_type, 'full_name', v_name, 'phone', v_phone, 'index', v_index);

  -- Identity resolution (SDD §10.1, D-01, D-36).
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and released_at is null;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and released_at is null;

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
      'pending_approval',
      null)
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
      select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and released_at is null;
      select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and released_at is null;
      if v_phone_owner is not null then
        return app.duplicate_result(case when v_type = 'new' then 'DUP_PHONE' else 'IDENTITY_CONFLICT' end, 'phone', v_phone_owner, v_attempt);
      end if;
      return app.duplicate_result(case when v_type = 'new' then 'DUP_INDEX' else 'IDENTITY_CONFLICT' end, 'index', v_index_owner, v_attempt);
    end if;
  end;

  perform app.log_activity('sales.create', 'sales', v_sale, jsonb_build_object('customer_type', v_type, 'free_month', v_free));
  return jsonb_build_object('status', 'ok', 'sale_id', v_sale, 'sale_month', v_month,
    'sale_status', 'pending_approval', 'existing', false);
end;
$$;

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
  if exists (select 1 from public.customer_identifiers where kind = p_kind and value = v_new and released_at is null) then
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

update public.permissions set description = 'Approve or reject sales and product switches (own team; Super Admin: all)'
 where key = 'retention.review';

-- ---------------------------------------------------------------------------
-- Notifications (SDD §18)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles (id),
  kind        text not null check (kind in ('sale_pending', 'sale_approved', 'sale_rejected', 'switch_pending',
                'switch_approved', 'switch_rejected', 'stock_to_accept')),
  entity_type text not null check (entity_type in ('sales', 'product_switches', 'stock_transfers')),
  entity_id   uuid not null,
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
comment on table public.notifications is 'In-app notifications (SDD §18). No customer phone or Index in data.';

create or replace function app.notify(p_user uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, entity_type, entity_id, data)
  select p_user, p_kind, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb)
  where p_user is not null
$$;

-- Who decides a sale or switch of this agent: the active leader of its team (not the agent), else every active
-- Super Admin (fallback; also for Team Leaders' own sales).
create or replace function app.approvers_for(p_agent uuid, p_team uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with leader as (
    select t.team_leader_id as id
    from public.teams t join public.user_profiles p on p.id = t.team_leader_id
    where t.id = p_team and t.is_active and p.is_active and t.team_leader_id <> p_agent
  )
  select id from leader
  union all
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active and not exists (select 1 from leader) and ur.user_id <> p_agent
$$;

create or replace function app.agent_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select full_name from public.user_profiles where id = p_user
$$;

create or replace function app.notify_new_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending_approval' then
    perform app.notify(a, 'sale_pending', 'sales', new.id,
      jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
    from app.approvers_for(new.agent_id, new.team_id) a;
  end if;
  return new;
end;
$$;
create trigger sales_notify_approvers after insert on public.sales for each row execute function app.notify_new_sale();

create or replace function app.notify_stock_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(t.team_leader_id, 'stock_to_accept', 'stock_transfers', new.id, '{}'::jsonb)
  from public.stock_locations l join public.teams t on t.id = l.team_id
  where l.id = new.to_location_id;
  return new;
end;
$$;
create trigger stock_transfers_notify after insert on public.stock_transfers for each row execute function app.notify_stock_issue();

-- Mark the caller's notifications read (all, or the given ones).
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions (approval history, append-only)
-- ---------------------------------------------------------------------------
create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('sales', 'product_switches')),
  entity_id   uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  reason      text check (reason is null or length(reason) <= 500),
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  decided_by  uuid not null,
  decided_at  timestamptz not null default now()
);
create index approvals_entity_idx on public.approvals (entity_type, entity_id);
create trigger approvals_append_only before update or delete on public.approvals for each row execute function app.prevent_change();
comment on table public.approvals is 'Every approve / reject decision on a sale or switch, with the equipment recorded (FR-SALE-09).';

-- May the caller decide this agent's sale/switch? Approve: never one's own. Reject: a Super Admin may cancel
-- their own; nobody else may decide their own.
create or replace function app.check_decider(p_agent uuid, p_team uuid, p_approve boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sa boolean := app.is_super_admin(v_me);
begin
  if not app.has_permission('retention.review') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_me = p_agent and (p_approve or not v_sa) then
    raise exception 'SELF_APPROVAL';
  end if;
  if v_sa then return; end if;
  if not exists (select 1 from public.teams t where t.id = p_team and t.is_active and t.team_leader_id = v_me) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Equipment from a team's accepted stock (all lines or none; never below zero).
create or replace function app.issue_from_team(p_team uuid, p_lines jsonb, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := (select id from public.stock_locations where team_id = p_team);
  v_line record;
begin
  if v_from is null then raise exception 'NO_TEAM_STOCK'; end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('issue', v_line.item_id, v_line.quantity, v_from, null, p_ref_type, p_ref_id);
  end loop;
end;
$$;

-- Approve a sale and record the equipment given (FR-SALE-07/08, D-37).
create or replace function public.approve_sale(p_sale uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_sale.agent_id, v_sale.team_id, true);
  if v_sale.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.sale_items (sale_id, stock_item_id, quantity)
    select p_sale, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_sale.team_id, v_items, 'sale', p_sale);
  end if;

  update public.sales set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_sale;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('sales', p_sale, 'approved', v_items, auth.uid());
  perform app.notify(v_sale.agent_id, 'sale_approved', 'sales', p_sale, jsonb_build_object('customer', v_sale.customer_name));
  perform app.log_activity('sales.approve', 'sales', p_sale, jsonb_build_object('items', v_items));
end;
$$;

-- Reject a sale with a reason. A rejected New sale releases the customer's numbers if the customer has no other
-- sale (D-37).
create or replace function public.reject_sale(p_sale uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_released boolean := false;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_sale.agent_id, v_sale.team_id, false);
  if v_sale.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;

  update public.sales set status = 'rejected' where id = p_sale;
  if v_sale.customer_type = 'new' and not exists (
    select 1 from public.sales s where s.customer_id = v_sale.customer_id and s.id <> p_sale and s.status <> 'rejected'
  ) and not exists (select 1 from public.product_switches w where w.customer_id = v_sale.customer_id) then
    update public.customer_identifiers
       set is_current = false, released_at = now(), released_by = auth.uid(), replace_reason = 'Released: New sale rejected'
     where customer_id = v_sale.customer_id and released_at is null;
    v_released := true;
  end if;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('sales', p_sale, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_sale.agent_id, 'sale_rejected', 'sales', p_sale,
    jsonb_build_object('customer', v_sale.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('sales.reject', 'sales', p_sale, jsonb_build_object('released_numbers', v_released));
end;
$$;

-- ---------------------------------------------------------------------------
-- Product switch (D-16, D-38)
-- ---------------------------------------------------------------------------
create table public.product_switches (
  id                uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  customer_id       uuid not null references public.customers (id),
  customer_name     text not null,
  agent_id          uuid not null references public.user_profiles (id),
  team_id           uuid references public.teams (id),
  from_product_id   uuid not null references public.products (id),
  to_product_id     uuid not null references public.products (id),
  to_plan_id        uuid not null references public.plans (id),
  city_id           uuid not null references public.cities (id),
  branch_id         uuid not null references public.branches (id),
  status            text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  submitted_at      timestamptz not null default now(),
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint switch_request_unique unique (client_request_id),
  constraint switch_changes_product check (from_product_id <> to_product_id)
);
create unique index product_switches_one_pending on public.product_switches (customer_id) where status = 'pending_approval';
create index product_switches_agent_idx on public.product_switches (agent_id, submitted_at desc);
create trigger product_switches_touch before update on public.product_switches for each row execute function app.touch_updated();
comment on table public.product_switches is 'FTTA ↔ FTTH product changes (D-16). Never a sale, unit or revenue.';

create table public.switch_items (
  switch_id     uuid not null references public.product_switches (id),
  stock_item_id uuid not null references public.stock_items (id),
  quantity      int not null check (quantity between 1 and 100),
  primary key (switch_id, stock_item_id)
);
create trigger switch_items_append_only before update or delete on public.switch_items for each row execute function app.prevent_change();

-- The customer's product now: the latest approved sale or approved switch.
create or replace function app.current_product(p_customer uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select product_id from (
    select s.product_id, coalesce(s.approved_at, s.submitted_at) as at
    from public.sales s where s.customer_id = p_customer and s.status = 'approved'
    union all
    select w.to_product_id, w.decided_at
    from public.product_switches w where w.customer_id = p_customer and w.status = 'approved'
  ) x
  order by at desc
  limit 1
$$;

create or replace function app.notify_new_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'switch_pending', 'product_switches', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
  from app.approvers_for(new.agent_id, new.team_id) a;
  return new;
end;
$$;
create trigger product_switches_notify after insert on public.product_switches for each row execute function app.notify_new_switch();

-- Register a switch (switches.create). p: { client_request_id, full_name, phone, index, from_product_id,
-- to_product_id, to_plan_id, city_id?, branch_id }. Returns { status: 'ok', switch_id, existing } or
-- { status: 'mismatch', field } (with a durable SWITCH_MISMATCH audit event, UAT-12).
create or replace function public.create_switch(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.product_switches;
  v_name text := btrim(coalesce(p ->> 'full_name', ''));
  v_phone text;
  v_index text := btrim(coalesce(p ->> 'index', ''));
  v_phone_owner uuid;
  v_index_owner uuid;
  v_customer uuid;
  v_from public.products;
  v_to public.products;
  v_plan uuid;
  v_my_city uuid;
  v_city uuid;
  v_branch uuid;
  v_team uuid;
  v_id uuid;
  v_attempt jsonb;
begin
  if not app.has_permission('switches.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if app.is_super_admin(v_me) then raise exception 'SUPER_ADMIN_NO_SALES'; end if;

  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.product_switches where client_request_id = v_request;
  if found then
    if v_existing.agent_id <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('status', 'ok', 'switch_id', v_existing.id, 'existing', true);
  end if;

  if length(v_name) < 2 or length(v_name) > 120 or app.normalize_name(v_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_phone := app.customer_phone(p ->> 'phone');
  if v_index !~ '^[0-9]{8}$' then raise exception 'INVALID_INDEX'; end if;

  select * into v_from from public.products where id = nullif(p ->> 'from_product_id', '')::uuid;
  select * into v_to from public.products where id = nullif(p ->> 'to_product_id', '')::uuid and is_active;
  if v_from.id is null or v_to.id is null or v_from.code not in ('FTTA', 'FTTH') or v_to.code not in ('FTTA', 'FTTH') then
    raise exception 'SWITCH_PRODUCTS';
  end if;
  if v_from.id = v_to.id then raise exception 'SAME_PRODUCT'; end if;
  v_plan := nullif(p ->> 'to_plan_id', '')::uuid;
  if v_plan is null or not exists (select 1 from public.plans where id = v_plan and product_id = v_to.id and is_active) then
    raise exception 'PLAN_REQUIRED';
  end if;

  select city_id into v_my_city from public.user_profiles where id = v_me;
  v_city := coalesce(nullif(p ->> 'city_id', '')::uuid, v_my_city);
  if v_city is null then raise exception 'CITY_REQUIRED'; end if;
  if v_city is distinct from v_my_city and not app.has_permission('sales.override_city') then raise exception 'CITY_OVERRIDE'; end if;
  if not exists (select 1 from public.cities where id = v_city and is_active) then raise exception 'CITY_REQUIRED'; end if;
  v_branch := nullif(p ->> 'branch_id', '')::uuid;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and is_active) then raise exception 'BRANCH_REQUIRED'; end if;

  -- Identity must match one existing customer exactly (FR-SW-03): phone, Index and name.
  v_attempt := jsonb_build_object('full_name', v_name, 'phone', v_phone, 'index', v_index,
    'from_product', v_from.code, 'to_product', v_to.code);
  select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone and is_current and released_at is null;
  select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index and is_current and released_at is null;
  if v_phone_owner is null or v_index_owner is null or v_phone_owner <> v_index_owner then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, case when coalesce(v_phone_owner, v_index_owner) is null then null else 'customers' end,
      coalesce(v_phone_owner, v_index_owner), jsonb_build_object('source', 'create_switch', 'field', 'phone_or_index'));
    return jsonb_build_object('status', 'mismatch', 'field', 'phone_or_index');
  end if;
  v_customer := v_phone_owner;
  if not app.names_match(v_name, (select full_name from public.customers where id = v_customer)) then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, 'customers', v_customer, jsonb_build_object('source', 'create_switch', 'field', 'name'));
    return jsonb_build_object('status', 'mismatch', 'field', 'name');
  end if;
  if app.current_product(v_customer) is distinct from v_from.id then
    perform app.record_audit_event('SWITCH_MISMATCH', 'medium', v_attempt, 'customers', v_customer, jsonb_build_object('source', 'create_switch', 'field', 'product'));
    return jsonb_build_object('status', 'mismatch', 'field', 'product');
  end if;
  if exists (select 1 from public.product_switches where customer_id = v_customer and status = 'pending_approval') then
    raise exception 'SWITCH_PENDING';
  end if;

  v_team := (select coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = v_me),
    (select t.id from public.teams t where t.team_leader_id = v_me and t.is_active order by t.created_at limit 1)));

  begin
    insert into public.product_switches (client_request_id, customer_id, customer_name, agent_id, team_id, from_product_id,
      to_product_id, to_plan_id, city_id, branch_id)
    values (v_request, v_customer, v_name, v_me, v_team, v_from.id, v_to.id, v_plan, v_city, v_branch)
    returning id into v_id;
  exception when unique_violation then
    select * into v_existing from public.product_switches where client_request_id = v_request;
    if found then return jsonb_build_object('status', 'ok', 'switch_id', v_existing.id, 'existing', true); end if;
    raise exception 'SWITCH_PENDING';
  end;
  perform app.log_activity('switches.create', 'product_switches', v_id, jsonb_build_object('from', v_from.code, 'to', v_to.code));
  return jsonb_build_object('status', 'ok', 'switch_id', v_id, 'existing', false);
end;
$$;

create or replace function public.approve_switch(p_switch uuid, p_items jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_switch.agent_id, v_switch.team_id, true);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_LINES'; end if;
  -- The customer's product may have changed since submission.
  if app.current_product(v_switch.customer_id) is distinct from v_switch.from_product_id then raise exception 'SWITCH_STALE'; end if;

  if jsonb_array_length(v_items) > 0 then
    insert into public.switch_items (switch_id, stock_item_id, quantity)
    select p_switch, l.item_id, l.quantity from app.read_lines(v_items) l;
    perform app.issue_from_team(v_switch.team_id, v_items, 'switch', p_switch);
  end if;
  update public.product_switches set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, items, decided_by)
  values ('product_switches', p_switch, 'approved', v_items, auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_approved', 'product_switches', p_switch, jsonb_build_object('customer', v_switch.customer_name));
  perform app.log_activity('switches.approve', 'product_switches', p_switch, jsonb_build_object('items', v_items));
end;
$$;

create or replace function public.reject_switch(p_switch uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switch public.product_switches;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_switch from public.product_switches where id = p_switch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app.check_decider(v_switch.agent_id, v_switch.team_id, false);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  update public.product_switches set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('product_switches', p_switch, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_rejected', 'product_switches', p_switch,
    jsonb_build_object('customer', v_switch.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('switches.reject', 'product_switches', p_switch);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.approvals enable row level security;
alter table public.product_switches enable row level security;
alter table public.switch_items enable row level security;

revoke all on public.notifications, public.approvals, public.product_switches, public.switch_items from anon, authenticated;
grant select on public.notifications, public.approvals, public.product_switches, public.switch_items to authenticated;

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_active_user());
create policy product_switches_read on public.product_switches for select to authenticated
  using (app.in_scope('sales.read', agent_id));
create policy switch_items_read on public.switch_items for select to authenticated
  using (exists (select 1 from public.product_switches w where w.id = switch_id));
create policy approvals_read on public.approvals for select to authenticated
  using ((entity_type = 'sales' and exists (select 1 from public.sales s where s.id = entity_id))
      or (entity_type = 'product_switches' and exists (select 1 from public.product_switches w where w.id = entity_id)));

select app.enable_change_log('public.notifications');
select app.enable_change_log('public.approvals');
select app.enable_change_log('public.product_switches');
select app.enable_change_log('public.switch_items', 'switch_id');

revoke execute on function app.notify(uuid, text, text, uuid, jsonb), app.approvers_for(uuid, uuid), app.agent_name(uuid),
  app.notify_new_sale(), app.notify_stock_issue(), app.notify_new_switch(), app.check_decider(uuid, uuid, boolean),
  app.issue_from_team(uuid, jsonb, text, uuid), app.current_product(uuid) from public;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon, authenticated, service_role;
revoke execute on function public.approve_sale(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.reject_sale(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.create_switch(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.approve_switch(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.reject_switch(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.approve_sale(uuid, jsonb) to authenticated;
grant execute on function public.reject_sale(uuid, text) to authenticated;
grant execute on function public.create_switch(jsonb) to authenticated;
grant execute on function public.approve_switch(uuid, jsonb) to authenticated;
grant execute on function public.reject_switch(uuid, text) to authenticated;
