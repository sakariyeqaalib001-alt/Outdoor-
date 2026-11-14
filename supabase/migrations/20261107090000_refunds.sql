-- Phase 12 — Refunds (BRD §6.5 FR-REF-01…08, BR-03, D-15, D-40; SDD §10.5; Roadmap Phase 12; T-28).
--
-- refunds                       : one request per sale at a time (pending or approved); rejected ones stay as history
--                                 and a new request may follow. Snapshot of customer name, product, branch and the
--                                 amount collected; phone and Index stay on the customer (never copied).
-- payroll_pending_adjustments   : the payroll hook (FR-REF-07). A refund approved after the sale's counting month was
--                                 finalized creates a negative adjustment waiting for the next payroll run (Phase 16
--                                 consumes it). Before finalization the sale simply stops being eligible.
-- public.create_refund          : agents (own sales), Team Leaders (team, their own included), Super Admin (all).
-- public.decide_refund          : Super Admin only (refunds.approve); never a refund one requested. Approve sets the
--                                 sale to 'reversed' (never deleted); reject changes nothing.
-- public.refund_record_return   : Stock Officer (stock.transfer) records the device coming back, linked to the refund.
-- public.refunds_to_collect     : approved refunds whose devices have not all come back (Stock → Returns).
-- public.refund_equipment       : given / returned per refund the caller may see (Refunds page).
-- HIGH_REFUND_RATE              : audit rule, off by default (agent refund rate over a window).
-- Also: opening-stock reconciliation counts devices returned by customers (Phase 11 fix).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  sale_id           uuid not null references public.sales (id),
  agent_id          uuid not null references public.user_profiles (id),   -- the sale's agent (scope)
  team_id           uuid references public.teams (id),
  customer_id       uuid not null references public.customers (id),
  customer_name     text not null,                                       -- as on the sale
  product_id        uuid not null references public.products (id),
  branch_id         uuid not null references public.branches (id),       -- the sale's branch (FR-SALE-22)
  amount_collected  numeric(10, 2) not null,                             -- the sale's amount (snapshot)
  amount            numeric(10, 2) not null check (amount > 0),
  reason            text not null check (reason in ('out_of_boundary', 'technical_delay', 'refused', 'no_signal', 'other')),
  note              text check (note is null or length(note) <= 500),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by      uuid not null references public.user_profiles (id),
  requested_at      timestamptz not null default now(),
  decided_by        uuid references public.user_profiles (id),
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or length(decision_note) <= 500),
  counting_month    date,                                                -- the sale's counting month at approval
  payroll_effect    text check (payroll_effect in ('excluded', 'adjustment')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint refunds_request_unique unique (client_request_id),
  constraint refunds_amount_max check (amount <= amount_collected),
  constraint refunds_other_note check (reason <> 'other' or length(btrim(coalesce(note, ''))) >= 3),
  constraint refunds_decided check ((status = 'pending') = (decided_by is null and decided_at is null)),
  constraint refunds_effect check ((status = 'approved') = (payroll_effect is not null and counting_month is not null))
);
-- One live refund per sale (FR-REF / SDD §8.3); a rejected request stays as history (T-28).
create unique index refunds_one_per_sale on public.refunds (sale_id) where status in ('pending', 'approved');
create index refunds_status_idx on public.refunds (status, requested_at desc);
create index refunds_agent_idx on public.refunds (agent_id, requested_at desc);
create trigger refunds_touch before update on public.refunds for each row execute function app.touch_updated();
comment on table public.refunds is
  'Refund requests (BRD §6.5). Written only by public.create_refund / public.decide_refund; approval reverses the sale (never deletes it).';

-- Decided refunds never change again.
create or replace function app.refund_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'refunds cannot be deleted'; end if;
  if old.status <> 'pending' then raise exception 'a decided refund cannot be changed'; end if;
  if new.sale_id <> old.sale_id or new.amount <> old.amount or new.reason <> old.reason
     or new.requested_by <> old.requested_by or new.requested_at <> old.requested_at then
    raise exception 'a refund request cannot be edited';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger refunds_guard before update or delete on public.refunds for each row execute function app.refund_guard();

create table public.payroll_pending_adjustments (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null check (source_type in ('refund')),
  source_id      uuid not null,
  sale_id        uuid not null references public.sales (id),
  agent_id       uuid not null references public.user_profiles (id),
  original_month date not null,                     -- the finalized counting month the sale was paid in
  units_delta    int not null check (units_delta < 0),
  revenue_delta  numeric(10, 2) not null check (revenue_delta < 0),
  reason         text not null,
  created_at     timestamptz not null default now(),
  constraint payroll_pending_source_unique unique (source_type, source_id)
);
create trigger payroll_pending_adjustments_append_only before update or delete on public.payroll_pending_adjustments
  for each row execute function app.prevent_change();
comment on table public.payroll_pending_adjustments is
  'Corrections for months already finalized (FR-REF-07, FR-PAY-13): consumed by the next payroll run (Phase 16). Finalized payroll is never edited.';

-- ---------------------------------------------------------------------------
-- Payroll hook
-- ---------------------------------------------------------------------------
-- Is this counting month finalized? No payroll runs exist before Phase 16, so nothing is finalized yet;
-- Phase 16 replaces this function to read payroll_runs.
create or replace function app.month_finalized(p_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;
comment on function app.month_finalized(date) is 'True when the payroll month is finalized (Phase 16 replaces this; false until then).';

-- The month an approved sale counts in (same rule as app.eligible_sale_facts, BRD §8.2): the sale month when approved
-- before the payroll cutoff day of the next month (EAT), otherwise the business month of approval.
create or replace function app.sale_counting_month(p_sale_month date, p_approved_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_approved_at < ((p_sale_month + interval '1 month'
            + make_interval(days => coalesce((select (value #>> '{}')::int from public.app_settings where key = 'payroll_cutoff_day'), 3)))::timestamp
            at time zone 'Africa/Mogadishu')
    then p_sale_month
    else app.business_month(p_approved_at)
  end
$$;

-- ---------------------------------------------------------------------------
-- Notifications: refund kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('sale_pending', 'sale_approved',
  'sale_rejected', 'switch_pending', 'switch_approved', 'switch_rejected', 'stock_to_accept', 'audit_alert', 'audit_case_assigned',
  'refund_pending', 'refund_approved', 'refund_rejected', 'refund_return'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('sales', 'product_switches', 'stock_transfers', 'audit_cases', 'refunds'));

-- Active users holding a permission at scope 'all' (e.g. Stock Officers for stock.transfer).
create or replace function app.users_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_key = ur.role_key
  join public.user_profiles p on p.id = ur.user_id
  where rp.permission_key = p_permission and rp.scope = 'all' and p.is_active
$$;

create or replace function app.notify_new_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'refund_pending', 'refunds', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.requested_by)))
  from app.super_admins() a
  where a <> new.requested_by;
  return null;
end;
$$;
create trigger refunds_notify after insert on public.refunds for each row execute function app.notify_new_refund();

-- ---------------------------------------------------------------------------
-- Visibility (used by RLS and the helper functions)
-- ---------------------------------------------------------------------------
create or replace function app.refund_visible(p_agent uuid, p_requester uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user() and (
    p_requester = auth.uid()
    or app.in_scope('refunds.submit', p_agent)
    or app.in_scope('sales.read', p_agent)
    or app.has_permission('refunds.approve'))
$$;

-- ---------------------------------------------------------------------------
-- Submit (FR-REF-01…03, 06)
-- ---------------------------------------------------------------------------
-- p: { client_request_id, sale_id, amount, reason, note? }. Returns { refund_id, existing }.
create or replace function public.create_refund(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_request uuid;
  v_existing public.refunds;
  v_sale public.sales;
  v_amount numeric;
  v_reason text := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_id uuid;
begin
  if not app.has_permission('refunds.submit') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  begin
    v_request := (p ->> 'client_request_id')::uuid;
  exception when others then
    raise exception 'INVALID_REQUEST';
  end;
  if v_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_existing from public.refunds where client_request_id = v_request;
  if found then
    if v_existing.requested_by <> v_me then raise exception 'INVALID_REQUEST'; end if;
    return jsonb_build_object('refund_id', v_existing.id, 'existing', true);
  end if;

  begin
    select * into v_sale from public.sales where id = (p ->> 'sale_id')::uuid for update;
  exception when invalid_text_representation then
    raise exception 'NOT_FOUND';
  end;
  if v_sale.id is null or not app.in_scope('refunds.submit', v_sale.agent_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_sale.status <> 'approved' then raise exception 'SALE_NOT_REFUNDABLE'; end if;
  if exists (select 1 from public.refunds where sale_id = v_sale.id and status in ('pending', 'approved')) then
    raise exception 'REFUND_EXISTS';
  end if;

  begin
    v_amount := (p ->> 'amount')::numeric;
  exception when others then
    raise exception 'REFUND_AMOUNT';
  end;
  if v_amount is null or v_amount <= 0 or v_amount > v_sale.amount_collected or v_amount <> round(v_amount, 2) then
    raise exception 'REFUND_AMOUNT';
  end if;
  if v_reason is null or v_reason not in ('out_of_boundary', 'technical_delay', 'refused', 'no_signal', 'other') then
    raise exception 'REASON_REQUIRED';
  end if;
  if v_reason = 'other' and (v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;

  insert into public.refunds (client_request_id, sale_id, agent_id, team_id, customer_id, customer_name, product_id, branch_id,
    amount_collected, amount, reason, note, requested_by)
  values (v_request, v_sale.id, v_sale.agent_id, v_sale.team_id, v_sale.customer_id, v_sale.customer_name, v_sale.product_id,
    v_sale.branch_id, v_sale.amount_collected, v_amount, v_reason, v_note, v_me)
  returning id into v_id;
  perform app.log_activity('refund.submit', 'refunds', v_id,
    jsonb_build_object('sale_id', v_sale.id, 'amount', v_amount, 'reason', v_reason));
  return jsonb_build_object('refund_id', v_id, 'existing', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- HIGH_REFUND_RATE (SDD §11.2): off by default
-- ---------------------------------------------------------------------------
insert into public.audit_rules (code, name, description, severity, enabled, can_disable, opens_case, threshold, sort_order) values
  ('HIGH_REFUND_RATE', 'High refund rate', 'Approved refunds of one agent''s sales reached a high share of the agent''s approved sales within a period.',
   'medium', false, true, true, '{"percent": 20, "refunds": 3, "days": 30}', 95);

-- Rate = refunds approved in the window ÷ sales approved in the window (at least the refunds). One event per agent per window.
create or replace function app.check_refund_rate(p_agent uuid, p_refund uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_pct int;
  v_min int;
  v_days int;
  v_refunds int;
  v_sales int;
begin
  if not app.rule_enabled('HIGH_REFUND_RATE') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'HIGH_REFUND_RATE';
  v_pct := coalesce((v_t ->> 'percent')::int, 20);
  v_min := coalesce((v_t ->> 'refunds')::int, 3);
  v_days := coalesce((v_t ->> 'days')::int, 30);
  select count(*) into v_refunds from public.refunds
   where agent_id = p_agent and status = 'approved' and decided_at >= now() - make_interval(days => v_days);
  if v_refunds < v_min then return; end if;
  select count(*) into v_sales from public.sales
   where agent_id = p_agent and status in ('approved', 'reversed') and approved_at >= now() - make_interval(days => v_days);
  v_sales := greatest(v_sales, v_refunds);
  if v_refunds * 100 < v_pct * v_sales then return; end if;
  if exists (select 1 from public.audit_events where rule_code = 'HIGH_REFUND_RATE' and context ->> 'agent_id' = p_agent::text
             and occurred_at >= now() - make_interval(days => v_days)) then
    return;
  end if;
  perform app.rule_event('HIGH_REFUND_RATE',
    jsonb_build_object('refunds', v_refunds, 'sales', v_sales, 'percent', round(v_refunds * 100.0 / v_sales), 'days', v_days),
    null, null, jsonb_build_object('source', 'decide_refund', 'agent_id', p_agent, 'refund_id', p_refund));
end;
$$;

-- Thresholds editable like the other rules (adds HIGH_REFUND_RATE to Phase 9's function).
create or replace function public.audit_rule_update(p_code text, p_enabled boolean, p_threshold jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.audit_rules;
  v_t jsonb := '{}'::jsonb;
  v_a int;
  v_b int;
  v_c int;
begin
  if not app.is_active_user() or not app.has_permission('settings.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.audit_rules where code = p_code for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not r.can_disable and not coalesce(p_enabled, false) then raise exception 'RULE_REQUIRED'; end if;
  begin
    if p_code = 'MULTI_AGENT_ATTEMPT' then
      v_a := (p_threshold ->> 'agents')::int; v_b := (p_threshold ->> 'days')::int;
      if v_a is null or v_a not between 2 and 10 or v_b is null or v_b not between 1 and 90 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('agents', v_a, 'days', v_b);
    elsif p_code = 'BURST' then
      v_a := (p_threshold ->> 'sales')::int; v_b := (p_threshold ->> 'minutes')::int;
      if v_a is null or v_a not between 2 and 50 or v_b is null or v_b not between 5 and 1440 then raise exception 'THRESHOLD_INVALID'; end if;
      v_t := jsonb_build_object('sales', v_a, 'minutes', v_b);
    elsif p_code = 'HIGH_REFUND_RATE' then
      v_a := (p_threshold ->> 'percent')::int; v_b := (p_threshold ->> 'refunds')::int; v_c := (p_threshold ->> 'days')::int;
      if v_a is null or v_a not between 1 and 100 or v_b is null or v_b not between 1 and 50 or v_c is null or v_c not between 1 and 365 then
        raise exception 'THRESHOLD_INVALID';
      end if;
      v_t := jsonb_build_object('percent', v_a, 'refunds', v_b, 'days', v_c);
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'THRESHOLD_INVALID';
  end;
  update public.audit_rules set enabled = coalesce(p_enabled, false), threshold = v_t, updated_by = auth.uid() where code = p_code;
  perform app.log_activity('audit.rule_update', 'audit_rules', null,
    jsonb_build_object('code', p_code, 'enabled', coalesce(p_enabled, false), 'threshold', v_t));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decide (Super Admin only — BR-03, FR-REF-03…05, 07; UAT-07, 17)
-- ---------------------------------------------------------------------------
create or replace function public.decide_refund(p_refund uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_refund public.refunds;
  v_sale public.sales;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_month date;
  v_effect text;
begin
  if app.permission_scope('refunds.approve') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_approve is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_refund from public.refunds where id = p_refund for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_refund.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if v_refund.requested_by = v_me or v_refund.agent_id = v_me then raise exception 'SELF_APPROVAL'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;

  if not p_approve then
    if v_note is null or length(v_note) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.refunds set status = 'rejected', decided_by = v_me, decided_at = now(), decision_note = v_note, updated_by = v_me
     where id = p_refund;
    perform app.log_activity('refund.reject', 'refunds', p_refund, jsonb_build_object('sale_id', v_refund.sale_id));
    perform app.notify(u, 'refund_rejected', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name, 'reason', v_note))
    from (select distinct unnest(array[v_refund.requested_by, v_refund.agent_id]) as u) x;
    return;
  end if;

  select * into v_sale from public.sales where id = v_refund.sale_id for update;
  if v_sale.status <> 'approved' then raise exception 'SALE_NOT_REFUNDABLE'; end if;
  v_month := app.sale_counting_month(v_sale.sale_month, v_sale.approved_at);
  v_effect := case when app.month_finalized(v_month) then 'adjustment' else 'excluded' end;

  -- The sale stays; it is marked reversed and drops out of eligible sales (FR-REF-05, BRD §8.2).
  update public.sales set status = 'reversed', updated_by = v_me where id = v_sale.id;
  update public.refunds set status = 'approved', decided_by = v_me, decided_at = now(), decision_note = v_note,
         counting_month = v_month, payroll_effect = v_effect, updated_by = v_me
   where id = p_refund;
  if v_effect = 'adjustment' then
    insert into public.payroll_pending_adjustments (source_type, source_id, sale_id, agent_id, original_month, units_delta, revenue_delta, reason)
    values ('refund', p_refund, v_sale.id, v_sale.agent_id, v_month, -1, -v_sale.amount_collected,
            'Refund approved after ' || to_char(v_month, 'FMMonth YYYY') || ' was finalized');
  end if;
  perform app.log_activity('refund.approve', 'refunds', p_refund,
    jsonb_build_object('sale_id', v_sale.id, 'amount', v_refund.amount, 'counting_month', v_month, 'payroll_effect', v_effect));
  perform app.notify(u, 'refund_approved', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name))
  from (select distinct unnest(array[v_refund.requested_by, v_refund.agent_id]) as u) x;
  -- Devices given on the sale should come back to the Stock Officer (FR-REF-08).
  if exists (select 1 from public.sale_items where sale_id = v_sale.id) then
    perform app.notify(u, 'refund_return', 'refunds', p_refund, jsonb_build_object('customer', v_refund.customer_name))
    from app.users_with_permission('stock.transfer') u;
  end if;
  perform app.check_refund_rate(v_sale.agent_id, p_refund);
end;
$$;

-- ---------------------------------------------------------------------------
-- Equipment coming back (FR-REF-08, FR-STK-10: Stock Officer only)
-- ---------------------------------------------------------------------------
create or replace function app.refund_returned(p_refund uuid, p_item uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(quantity), 0)::int from public.stock_movements
  where ref_type = 'refund' and ref_id = p_refund and item_id = p_item and movement_type = 'return'
$$;

create or replace function public.refund_record_return(p_refund uuid, p_item uuid, p_quantity int, p_faulty boolean default false, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
  v_given int;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.permission_scope('stock.transfer') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_refund from public.refunds where id = p_refund for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_refund.status <> 'approved' then raise exception 'REFUND_NOT_APPROVED'; end if;
  select quantity into v_given from public.sale_items where sale_id = v_refund.sale_id and stock_item_id = p_item;
  if v_given is null then raise exception 'UNKNOWN_ITEM'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'INVALID_QUANTITY'; end if;
  if app.refund_returned(p_refund, p_item) + p_quantity > v_given then raise exception 'RETURN_TOO_MANY'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'REASON_REQUIRED'; end if;
  perform app.record_movement('return', p_item, p_quantity, null,
    app.location_of(case when coalesce(p_faulty, false) then 'faulty' else 'central' end),
    'refund', p_refund, 'refund' || coalesce(': ' || v_note, ''));
  perform app.log_activity('stock.return', 'refunds', p_refund,
    jsonb_build_object('reason', 'refund', 'item_id', p_item, 'quantity', p_quantity, 'faulty', coalesce(p_faulty, false)));
end;
$$;

-- Approved refunds with devices still to come back (Stock Officer list). No phone or Index.
create or replace function public.refunds_to_collect()
returns table (refund_id uuid, decided_at timestamptz, customer_name text, team text, agent text, item_id uuid, item text, given int, returned int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.permission_scope('stock.transfer') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.id, r.decided_at, r.customer_name, t.name, p.full_name, si.stock_item_id, i.display_name, si.quantity,
           app.refund_returned(r.id, si.stock_item_id)
    from public.refunds r
    join public.sale_items si on si.sale_id = r.sale_id
    join public.stock_items i on i.id = si.stock_item_id
    left join public.teams t on t.id = r.team_id
    left join public.user_profiles p on p.id = r.agent_id
    where r.status = 'approved' and app.refund_returned(r.id, si.stock_item_id) < si.quantity
    order by r.decided_at, i.sort_order;
end;
$$;

-- Given / returned per refund for the Refunds page (only refunds the caller may see).
create or replace function public.refund_equipment(p_refunds uuid[])
returns table (refund_id uuid, item text, given int, returned int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, i.display_name, si.quantity, app.refund_returned(r.id, si.stock_item_id)
  from public.refunds r
  join public.sale_items si on si.sale_id = r.sale_id
  join public.stock_items i on i.id = si.stock_item_id
  where r.id = any (p_refunds) and app.refund_visible(r.agent_id, r.requested_by)
  order by i.sort_order
$$;

-- ---------------------------------------------------------------------------
-- Opening stock (Phase 11 fix): devices returned by customers reduce "issued" (net with customers).
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
      coalesce(sum(m.quantity) filter (where m.movement_type = 'issue'), 0)
        - coalesce(sum(m.quantity) filter (where m.movement_type = 'return' and m.from_location_id is null), 0) as issued,
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

-- ---------------------------------------------------------------------------
-- RLS, grants, change history
-- ---------------------------------------------------------------------------
alter table public.refunds enable row level security;
alter table public.payroll_pending_adjustments enable row level security;
revoke all on public.refunds, public.payroll_pending_adjustments from anon, authenticated;
grant select on public.refunds, public.payroll_pending_adjustments to authenticated;

create policy refunds_read on public.refunds for select to authenticated
  using (app.refund_visible(agent_id, requested_by));
create policy payroll_pending_read on public.payroll_pending_adjustments for select to authenticated
  using (app.permission_scope('payroll.read') = 'all' or app.has_permission('refunds.approve'));

select app.enable_change_log('public.refunds');
select app.enable_change_log('public.payroll_pending_adjustments');

revoke execute on function app.refund_guard(), app.month_finalized(date), app.sale_counting_month(date, timestamptz),
  app.users_with_permission(text), app.notify_new_refund(), app.refund_visible(uuid, uuid), app.check_refund_rate(uuid, uuid),
  app.refund_returned(uuid, uuid) from public;
grant execute on function app.refund_visible(uuid, uuid) to authenticated;

revoke execute on function public.create_refund(jsonb), public.decide_refund(uuid, boolean, text),
  public.refund_record_return(uuid, uuid, int, boolean, text), public.refunds_to_collect(), public.refund_equipment(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_refund(jsonb), public.decide_refund(uuid, boolean, text),
  public.refund_record_return(uuid, uuid, int, boolean, text), public.refunds_to_collect(), public.refund_equipment(uuid[])
  to authenticated;
