-- Phase 7 change (D-37, owner decision 24 Oct 2026): EVERY sale — New and Retention — waits for approval by the
-- agent's Team Leader / Outdoor Supervisor (Super Admin as fallback; never by the seller), and the Supervisor
-- records the equipment given at approval (Phase 8), because the team's stock is in the Supervisor's hands (D-35).
--
--  * public.create_sale: every sale is saved as 'pending_approval' (approved_at empty); the form no longer sends
--    equipment — any "items" in the request are ignored; no stock moves at registration.
--  * Unchanged: identity checks, durable duplicate events, same-month rule (pending sales count), idempotency,
--    server time (D-30), price snapshot (D-34), months paid / free month (D-36).
--  * Phase 8 adds the approval screen: approve with equipment (stock deducted then, refused if short) or reject
--    with a reason; a rejected New sale releases the customer's phone and Index when the customer has no other
--    sale (D-37).

comment on table public.sale_items is 'Equipment given on a sale (D-35 quantities), recorded by the Supervisor at approval (D-37, Phase 8).';

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
      select customer_id into v_phone_owner from public.customer_identifiers where kind = 'phone' and value = v_phone;
      select customer_id into v_index_owner from public.customer_identifiers where kind = 'index' and value = v_index;
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
