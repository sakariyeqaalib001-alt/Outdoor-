-- Phase 8 change (D-39, owner decision 25 Oct 2026): the equipment given at approval depends on the product.
--   FTTA          → exactly 1 WiFi Router
--   FTTH, FTTB    → exactly 1 PDCOM or 1 CALIX
--   LTE           → no equipment from stock
-- Product switches follow the product switched TO. The rule is data (product_equipment), checked in
-- approve_sale / approve_switch before any stock moves.

create table public.product_equipment (
  product_id    uuid not null references public.products (id),
  stock_item_id uuid not null references public.stock_items (id),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  primary key (product_id, stock_item_id)
);
comment on table public.product_equipment is
  'Equipment allowed per product (D-39). A product with rows needs exactly one of them at approval; a product without rows takes none.';

insert into public.product_equipment (product_id, stock_item_id)
select p.id, i.id
from (values ('FTTA', 'WIFI_ROUTER'), ('FTTH', 'PDCOM'), ('FTTH', 'CALIX'), ('FTTB', 'PDCOM'), ('FTTB', 'CALIX')) as r (product, item)
join public.products p on p.code = r.product
join public.stock_items i on i.code = r.item;

alter table public.product_equipment enable row level security;
revoke all on public.product_equipment from anon, authenticated;
grant select on public.product_equipment to authenticated;
create policy product_equipment_read on public.product_equipment for select to authenticated using (app.is_active_user());
select app.enable_change_log('public.product_equipment', 'product_id');

-- Exactly one allowed device when the product has a rule; none when it has none.
create or replace function app.check_equipment(p_product uuid, p_items jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needs boolean := exists (select 1 from public.product_equipment where product_id = p_product);
  v_count int := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  if not v_needs then
    if v_count > 0 then raise exception 'EQUIPMENT_NOT_ALLOWED'; end if;
    return;
  end if;
  if v_count = 0 then raise exception 'EQUIPMENT_REQUIRED'; end if;
  if v_count > 1 or (p_items -> 0 ->> 'quantity') is distinct from '1' then raise exception 'EQUIPMENT_ONE'; end if;
  if not exists (
    select 1 from public.product_equipment
    where product_id = p_product and stock_item_id::text = (p_items -> 0 ->> 'item_id')
  ) then
    raise exception 'EQUIPMENT_NOT_ALLOWED';
  end if;
end;
$$;
revoke execute on function app.check_equipment(uuid, jsonb) from public;

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
  perform app.check_equipment(v_sale.product_id, v_items); -- D-39

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
  perform app.check_equipment(v_switch.to_product_id, v_items); -- D-39
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
