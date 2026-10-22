-- =====================================================================================
-- Sogasho Outdoor — database change 20261022150000_stock
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261022150000_stock.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022150000') then
    raise exception 'Already applied: 20261022150000_stock. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120000') then
    raise exception 'Apply 20261022120000_plans first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- Phase 6 — Stock ledger and team custody (SDD §12, BRD §6.12; owner decision D-35, 22 Oct 2026)
--
-- D-35 replaces serial tracking (D-12): stock is counted by QUANTITY per item (WiFi Router, PDCOM, CALIX).
--  * Locations: Central Store, Central Store — faulty, and one stock per TEAM (held by its Team Leader /
--    Supervisor). Agents hold no stock of their own; branches hold none (D-31).
--  * Receive (Stock Officer) → Central. Send (Stock Officer) Central → team: the stock is in transit until
--    the team's Team Leader / Supervisor (or Super Admin) accepts it.
--  * Each sale by a member of the team deducts the items the agent picked from the team's accepted stock
--    (app.issue_stock, called by sales in Phase 7). Never below zero.
--  * Returns are recorded by the Stock Officer only (team or customer → Central, or the faulty store).
--  * Adjustments: requested by the Stock Officer, approved by Super Admin (never by the requester).
--  * stock_movements is the append-only ledger; balances are always computed from it (no balance column).
--  * Every decrease takes a transaction lock on (location, item), so two deductions cannot overdraw.

update public.stock_items set is_serialized = false;
comment on column public.stock_items.is_serialized is 'Always false since D-35: stock is counted by quantity, no serial numbers.';

update public.permissions set description = 'Send stock to teams and record returns' where key = 'stock.transfer';
update public.permissions set description = 'Accept stock delivered to your team' where key = 'stock.acknowledge';

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create table public.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('central', 'faulty', 'team')),
  team_id    uuid unique references public.teams (id),
  created_at timestamptz not null default now(),
  constraint team_location_has_team check ((kind = 'team') = (team_id is not null))
);
create unique index stock_locations_one_central on public.stock_locations (kind) where kind in ('central', 'faulty');
comment on table public.stock_locations is 'Central Store, its faulty store, and one stock per team (D-35). Names come from the team.';

insert into public.stock_locations (kind) values ('central'), ('faulty');
insert into public.stock_locations (kind, team_id) select 'team', id from public.teams;

create or replace function app.create_team_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_locations (kind, team_id) values ('team', new.id) on conflict (team_id) do nothing;
  return new;
end;
$$;
revoke execute on function app.create_team_stock_location() from public;
create trigger teams_stock_location after insert on public.teams for each row execute function app.create_team_stock_location();

create or replace function app.location_of(p_kind text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.stock_locations where kind = p_kind and kind in ('central', 'faulty')
$$;

-- ---------------------------------------------------------------------------
-- The ledger (append-only)
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  movement_type    text not null check (movement_type in ('receipt', 'transfer_out', 'transfer_in', 'issue', 'return', 'adjustment')),
  item_id          uuid not null references public.stock_items (id),
  quantity         int not null check (quantity > 0),
  from_location_id uuid references public.stock_locations (id),
  to_location_id   uuid references public.stock_locations (id),
  ref_type         text check (ref_type in ('receipt', 'transfer', 'sale', 'switch', 'refund', 'return', 'adjustment')),
  ref_id           uuid,
  reason           text check (reason is null or length(reason) <= 500),
  actor_id         uuid,
  approved_by      uuid,
  occurred_at      timestamptz not null default now(),
  constraint movement_has_location check (from_location_id is not null or to_location_id is not null)
);
create index stock_movements_from_idx on public.stock_movements (from_location_id, item_id);
create index stock_movements_to_idx on public.stock_movements (to_location_id, item_id);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);
create index stock_movements_time_idx on public.stock_movements (occurred_at);
comment on table public.stock_movements is
  'Append-only stock ledger (FR-STK-06). A transfer_out leaves the sender at once; the receiver counts it only at transfer_in (acceptance).';

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function app.prevent_change();

-- Quantity that counts at a location: in = receipt / transfer_in / return / adjustment (to);
-- out = transfer_out / issue / return / adjustment (from). transfer_out's destination is "in transit".
create or replace function app.location_balance(p_location uuid, p_item uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
           when m.to_location_id = p_location and m.movement_type <> 'transfer_out' then m.quantity
           when m.from_location_id = p_location then -m.quantity
           else 0 end), 0)::int
  from public.stock_movements m
  where m.item_id = p_item and (m.to_location_id = p_location or m.from_location_id = p_location)
$$;

-- Write one movement. Decreases lock (location, item) for the rest of the transaction and refuse to go
-- below zero (FR-STK-05). Only the functions below call this.
create or replace function app.record_movement(
  p_type text, p_item uuid, p_quantity int, p_from uuid, p_to uuid,
  p_ref_type text, p_ref_id uuid, p_reason text default null, p_approved_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if not exists (select 1 from public.stock_items where id = p_item) then raise exception 'UNKNOWN_ITEM'; end if;
  if p_from is not null then
    perform pg_advisory_xact_lock(hashtext('stock:' || p_from::text || ':' || p_item::text));
    if app.location_balance(p_from, p_item) < p_quantity then
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;
  insert into public.stock_movements (movement_type, item_id, quantity, from_location_id, to_location_id, ref_type, ref_id, reason, actor_id, approved_by)
  values (p_type, p_item, p_quantity, p_from, p_to, p_ref_type, p_ref_id, nullif(btrim(p_reason), ''), auth.uid(), p_approved_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deliveries to teams
-- ---------------------------------------------------------------------------
create table public.stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  to_location_id  uuid not null references public.stock_locations (id),
  status          text not null default 'sent' check (status in ('sent', 'accepted', 'cancelled')),
  note            text check (note is null or length(note) <= 500),
  sent_by         uuid,
  sent_at         timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz
);
create index stock_transfers_to_idx on public.stock_transfers (to_location_id, status);
comment on table public.stock_transfers is 'Stock sent from Central to a team; counts for the team only after acceptance (FR-STK-08, D-35).';

create table public.stock_transfer_lines (
  transfer_id uuid not null references public.stock_transfers (id),
  item_id     uuid not null references public.stock_items (id),
  quantity    int not null check (quantity > 0),
  primary key (transfer_id, item_id)
);
create trigger stock_transfer_lines_append_only
  before update or delete on public.stock_transfer_lines
  for each row execute function app.prevent_change();

-- ---------------------------------------------------------------------------
-- Adjustments (Stock Officer requests, Super Admin approves)
-- ---------------------------------------------------------------------------
create table public.stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.stock_locations (id),
  item_id         uuid not null references public.stock_items (id),
  quantity_change int not null check (quantity_change <> 0 and abs(quantity_change) <= 100000),
  reason          text not null check (length(btrim(reason)) between 3 and 500),
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 500)
);
create index stock_adjustments_status_idx on public.stock_adjustments (status, requested_at);
comment on table public.stock_adjustments is 'Corrections such as lost or damaged stock: reason required, Super Admin approval (FR-STK-07).';

-- ---------------------------------------------------------------------------
-- Who may see a location (RLS helper)
--   stock.read at "all": every location · "city": teams of the caller's city · "team"/"own": the team the
--   caller leads or belongs to (agents see their team's stock, since their sales deduct from it).
-- ---------------------------------------------------------------------------
create or replace function app.can_read_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case app.permission_scope('stock.read')
    when 'all' then true
    when 'city' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      join public.user_profiles me on me.id = auth.uid()
      where l.id = p_location and me.city_id is not null and t.city_id = me.city_id)
    when 'team' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = p_location
        and (t.team_leader_id = auth.uid() or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = auth.uid())))
    when 'own' then exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = p_location
        and (t.team_leader_id = auth.uid() or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = auth.uid())))
    else false
  end
$$;

-- The team stock a user's sales deduct from (their team, or the team they lead). Null when none.
create or replace function app.team_location_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.stock_locations l
  join public.teams t on t.id = l.team_id and t.is_active
  where t.id = coalesce(
    (select tm.team_id from public.team_members tm where tm.user_id = p_user),
    (select t2.id from public.teams t2 where t2.team_leader_id = p_user and t2.is_active order by t2.created_at limit 1))
$$;

-- ---------------------------------------------------------------------------
-- Operations (API). Each checks its permission, validates, writes the ledger and the activity log.
-- p_lines: [{"item_id": "...", "quantity": 3}, ...] — one line per item.
-- ---------------------------------------------------------------------------
create or replace function app.read_lines(p_lines jsonb)
returns table (item_id uuid, quantity int)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 20 then
    raise exception 'INVALID_LINES';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity')::numeric <> trunc((e ->> 'quantity')::numeric)
       or (e ->> 'quantity')::numeric not between 1 and 100000 or (e ->> 'item_id') is null
  ) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines) then
    raise exception 'DUPLICATE_ITEM';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where not exists (select 1 from public.stock_items i where i.id::text = e ->> 'item_id' and i.is_active)
  ) then
    raise exception 'UNKNOWN_ITEM';
  end if;
  return query select (e ->> 'item_id')::uuid, (e ->> 'quantity')::int from jsonb_array_elements(p_lines) e;
end;
$$;

-- Receive into Central (stock.receive).
create or replace function public.stock_receive(p_lines jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid := gen_random_uuid();
  v_line record;
begin
  if not app.has_permission('stock.receive') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('receipt', v_line.item_id, v_line.quantity, null, app.location_of('central'), 'receipt', v_ref, p_note);
  end loop;
  perform app.log_activity('stock.receive', 'stock_movements', v_ref, jsonb_build_object('lines', p_lines));
  return v_ref;
end;
$$;

-- Send from Central to a team (stock.transfer). Leaves Central at once; the team counts it on acceptance.
create or replace function public.stock_send(p_team uuid, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to uuid;
  v_id uuid;
  v_line record;
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select l.id into v_to from public.stock_locations l join public.teams t on t.id = l.team_id where t.id = p_team and t.is_active;
  if v_to is null then raise exception 'TEAM_NOT_FOUND'; end if;

  insert into public.stock_transfers (to_location_id, note, sent_by) values (v_to, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  for v_line in select * from app.read_lines(p_lines) loop
    insert into public.stock_transfer_lines (transfer_id, item_id, quantity) values (v_id, v_line.item_id, v_line.quantity);
    perform app.record_movement('transfer_out', v_line.item_id, v_line.quantity, app.location_of('central'), v_to, 'transfer', v_id);
  end loop;
  perform app.log_activity('stock.send', 'stock_transfers', v_id);
  return v_id;
end;
$$;

-- Accept a delivery: the receiving team's Team Leader / Supervisor (stock.acknowledge), or Super Admin.
create or replace function public.stock_accept(p_transfer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_line record;
begin
  select * into v_transfer from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (
    (app.is_active_user() and app.is_super_admin(auth.uid()))
    or (app.has_permission('stock.acknowledge') and exists (
      select 1 from public.stock_locations l join public.teams t on t.id = l.team_id
      where l.id = v_transfer.to_location_id and t.team_leader_id = auth.uid()))
  ) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_transfer.status <> 'sent' then raise exception 'ALREADY_DECIDED'; end if;

  for v_line in select item_id, quantity from public.stock_transfer_lines where transfer_id = p_transfer loop
    perform app.record_movement('transfer_in', v_line.item_id, v_line.quantity, null, v_transfer.to_location_id, 'transfer', p_transfer);
  end loop;
  update public.stock_transfers set status = 'accepted', decided_by = auth.uid(), decided_at = now() where id = p_transfer;
  perform app.log_activity('stock.accept', 'stock_transfers', p_transfer);
end;
$$;

-- Cancel a delivery not yet accepted (stock.transfer): the stock goes back to Central.
create or replace function public.stock_cancel(p_transfer uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_line record;
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_transfer from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_transfer.status <> 'sent' then raise exception 'ALREADY_DECIDED'; end if;

  for v_line in select item_id, quantity from public.stock_transfer_lines where transfer_id = p_transfer loop
    perform app.record_movement('transfer_in', v_line.item_id, v_line.quantity, null, app.location_of('central'), 'transfer', p_transfer, p_reason);
  end loop;
  update public.stock_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_transfer;
  perform app.log_activity('stock.cancel', 'stock_transfers', p_transfer, jsonb_build_object('reason', p_reason));
end;
$$;

-- Return (Stock Officer only, stock.transfer): from a team, or from a customer (p_team null), to Central
-- or — when faulty — to the faulty store. Reason codes: faulty, refund, switch, retention_rejected, other.
create or replace function public.stock_return(
  p_team uuid, p_item uuid, p_quantity int, p_reason_code text, p_note text default null, p_faulty boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
  v_ref uuid := gen_random_uuid();
begin
  if not app.has_permission('stock.transfer') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_reason_code is null or p_reason_code not in ('faulty', 'refund', 'switch', 'retention_rejected', 'other') then
    raise exception 'REASON_REQUIRED';
  end if;
  if p_reason_code = 'other' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'REASON_REQUIRED'; end if;
  if p_team is not null then
    select l.id into v_from from public.stock_locations l where l.team_id = p_team;
    if v_from is null then raise exception 'TEAM_NOT_FOUND'; end if;
  end if;
  perform app.record_movement('return', p_item, p_quantity, v_from,
    app.location_of(case when coalesce(p_faulty, false) or p_reason_code = 'faulty' then 'faulty' else 'central' end),
    'return', v_ref, p_reason_code || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  perform app.log_activity('stock.return', 'stock_movements', v_ref, jsonb_build_object('reason', p_reason_code, 'from_team', p_team));
  return v_ref;
end;
$$;

create or replace function public.stock_request_adjustment(p_location uuid, p_item uuid, p_change int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission('stock.adjust.request') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.stock_locations where id = p_location) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.stock_items where id = p_item) then raise exception 'UNKNOWN_ITEM'; end if;
  if p_change is null or p_change = 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  insert into public.stock_adjustments (location_id, item_id, quantity_change, reason, requested_by)
  values (p_location, p_item, p_change, btrim(p_reason), auth.uid()) returning id into v_id;
  perform app.log_activity('stock.adjust_request', 'stock_adjustments', v_id);
  return v_id;
end;
$$;

-- Approve or reject (stock.adjust.approve). Nobody decides their own request.
create or replace function public.stock_decide_adjustment(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adj public.stock_adjustments;
begin
  if not app.has_permission('stock.adjust.approve') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_adj from public.stock_adjustments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_adj.status <> 'requested' then raise exception 'ALREADY_DECIDED'; end if;
  if v_adj.requested_by = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if p_approve then
    if v_adj.quantity_change > 0 then
      perform app.record_movement('adjustment', v_adj.item_id, v_adj.quantity_change, null, v_adj.location_id, 'adjustment', p_id, v_adj.reason, auth.uid());
    else
      perform app.record_movement('adjustment', v_adj.item_id, -v_adj.quantity_change, v_adj.location_id, null, 'adjustment', p_id, v_adj.reason, auth.uid());
    end if;
  end if;
  update public.stock_adjustments
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  perform app.log_activity(case when p_approve then 'stock.adjust_approve' else 'stock.adjust_reject' end, 'stock_adjustments', p_id);
end;
$$;

-- Issue to a customer (internal: called by the sale / switch functions of Phases 7–8, never by the API).
-- Deducts from the seller's team stock; refuses when the seller has no team or the stock is short.
create or replace function app.issue_stock(p_seller uuid, p_lines jsonb, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := app.team_location_of(p_seller);
  v_line record;
begin
  if v_from is null then raise exception 'NO_TEAM_STOCK'; end if;
  for v_line in select * from app.read_lines(p_lines) loop
    perform app.record_movement('issue', v_line.item_id, v_line.quantity, v_from, null, p_ref_type, p_ref_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: per location and item, for a period (EAT dates): opening, in/out by type, closing; plus stock in
-- transit to the location. SECURITY INVOKER: RLS limits it to the locations the caller may see.
-- ---------------------------------------------------------------------------
create or replace function public.stock_report(p_from date, p_to date)
returns table (
  location_id uuid, item_id uuid,
  opening int, received int, transferred_in int, transferred_out int, issued int,
  returned_in int, returned_out int, adjusted int, closing int, in_transit int
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Africa/Mogadishu') as t0,
           ((p_to + 1)::timestamp at time zone 'Africa/Mogadishu') as t1
  ),
  legs as (
    -- each movement seen from each location it touches; sign = effect on that location
    select m.to_location_id as loc, m.item_id, m.movement_type, m.quantity as qty, m.occurred_at
    from public.stock_movements m where m.to_location_id is not null and m.movement_type <> 'transfer_out'
    union all
    select m.from_location_id, m.item_id, m.movement_type, -m.quantity, m.occurred_at
    from public.stock_movements m where m.from_location_id is not null
  ),
  per as (
    select l.loc, l.item_id,
      coalesce(sum(l.qty) filter (where l.occurred_at < b.t0), 0) as opening,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'receipt'), 0) as received,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'transfer_in'), 0) as transferred_in,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'transfer_out'), 0) as transferred_out,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'issue'), 0) as issued,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'return' and l.qty > 0), 0) as returned_in,
      coalesce(-sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'return' and l.qty < 0), 0) as returned_out,
      coalesce(sum(l.qty) filter (where l.occurred_at >= b.t0 and l.occurred_at < b.t1 and l.movement_type = 'adjustment'), 0) as adjusted,
      coalesce(sum(l.qty) filter (where l.occurred_at < b.t1), 0) as closing
    from legs l cross join bounds b
    group by l.loc, l.item_id
  ),
  transit as (
    select t.to_location_id as loc, tl.item_id, sum(tl.quantity) as qty
    from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id
    where t.status = 'sent'
    group by t.to_location_id, tl.item_id
  )
  select coalesce(p.loc, tr.loc), coalesce(p.item_id, tr.item_id),
         coalesce(p.opening, 0)::int, coalesce(p.received, 0)::int, coalesce(p.transferred_in, 0)::int,
         coalesce(p.transferred_out, 0)::int, coalesce(p.issued, 0)::int, coalesce(p.returned_in, 0)::int,
         coalesce(p.returned_out, 0)::int, coalesce(p.adjusted, 0)::int, coalesce(p.closing, 0)::int,
         coalesce(tr.qty, 0)::int
  from per p full join transit tr on tr.loc = p.loc and tr.item_id = p.item_id
  where app.can_read_location(coalesce(p.loc, tr.loc))
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.stock_locations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_adjustments enable row level security;

revoke all on public.stock_locations, public.stock_movements, public.stock_transfers, public.stock_transfer_lines,
  public.stock_adjustments from anon, authenticated;
grant select on public.stock_locations, public.stock_movements, public.stock_transfers, public.stock_transfer_lines,
  public.stock_adjustments to authenticated;

create policy stock_locations_read on public.stock_locations for select to authenticated using (app.is_active_user());
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (app.can_read_location(from_location_id) or app.can_read_location(to_location_id));
create policy stock_transfers_read on public.stock_transfers for select to authenticated
  using (app.can_read_location(to_location_id) or app.has_permission('stock.transfer'));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated
  using (exists (select 1 from public.stock_transfers t where t.id = transfer_id));
create policy stock_adjustments_read on public.stock_adjustments for select to authenticated
  using (app.can_read_location(location_id) or app.has_permission('stock.adjust.request') or app.has_permission('stock.adjust.approve'));

select app.enable_change_log('public.stock_locations');
select app.enable_change_log('public.stock_movements');
select app.enable_change_log('public.stock_transfers');
select app.enable_change_log('public.stock_transfer_lines', 'transfer_id');
select app.enable_change_log('public.stock_adjustments');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function app.location_of(text), app.location_balance(uuid, uuid),
  app.record_movement(text, uuid, int, uuid, uuid, text, uuid, text, uuid), app.can_read_location(uuid),
  app.team_location_of(uuid), app.read_lines(jsonb), app.issue_stock(uuid, jsonb, text, uuid) from public;
grant execute on function app.can_read_location(uuid) to authenticated;

revoke execute on function public.stock_receive(jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_send(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_accept(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.stock_cancel(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_return(uuid, uuid, int, text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.stock_request_adjustment(uuid, uuid, int, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_decide_adjustment(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function public.stock_report(date, date) from public, anon, authenticated, service_role;

grant execute on function public.stock_receive(jsonb, text) to authenticated;
grant execute on function public.stock_send(uuid, jsonb, text) to authenticated;
grant execute on function public.stock_accept(uuid) to authenticated;
grant execute on function public.stock_cancel(uuid, text) to authenticated;
grant execute on function public.stock_return(uuid, uuid, int, text, text, boolean) to authenticated;
grant execute on function public.stock_request_adjustment(uuid, uuid, int, text) to authenticated;
grant execute on function public.stock_decide_adjustment(uuid, boolean, text) to authenticated;
grant execute on function public.stock_report(date, date) to authenticated;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261022150000', 'stock');

commit;

select 'Applied 20261022150000_stock successfully' as result;
