-- Phase 8 change (D-40, owner decision 25 Oct 2026): a Team Leader / Outdoor Supervisor may approve their OWN sales
-- and give the device from their own team's stock — no Super Admin step. Their own product SWITCHES (and, from Phase 12,
-- refunds) still need Super Admin. Agents still never approve;
-- Super Admins still do not sell (D-38). Every decision stays recorded in `approvals` (who decided, and that it was
-- their own), so self-approved sales can be reviewed (audit rule in Phase 9).

-- Who may decide: retention.review AND (Super Admin, or the leader of the sale's team — now including their own).
-- A Super Admin's own item can only be rejected (cancelled), never approved.
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
  v_leads boolean := exists (select 1 from public.teams t where t.id = p_team and t.is_active and t.team_leader_id = v_me);
begin
  if not app.has_permission('retention.review') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_me = p_agent then
    if v_leads then return; end if;                 -- D-40: Team Leader decides own sale for their team
    if v_sa and not p_approve then return; end if;  -- Super Admin may cancel their own
    raise exception 'SELF_APPROVAL';
  end if;
  if v_sa or v_leads then return; end if;
  raise exception 'not allowed' using errcode = 'insufficient_privilege';
end;
$$;

-- Who is notified of a new SALE: the active leader of its team (also when it is the leader's own sale),
-- else every active Super Admin.
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
    where t.id = p_team and t.is_active and p.is_active
  )
  select id from leader
  union all
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active and not exists (select 1 from leader) and ur.user_id <> p_agent
$$;


-- Switches keep the D-38 rule: nobody decides their own switch (a Team Leader's own goes to Super Admin; a Super
-- Admin may only cancel their own).
create or replace function app.check_switch_decider(p_agent uuid, p_team uuid, p_approve boolean)
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

-- Who is notified of a new SWITCH: the team's leader unless it is the leader's own, else every active Super Admin.
create or replace function app.switch_approvers_for(p_agent uuid, p_team uuid)
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

create or replace function app.notify_new_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(a, 'switch_pending', 'product_switches', new.id,
    jsonb_build_object('customer', new.customer_name, 'agent', app.agent_name(new.agent_id)))
  from app.switch_approvers_for(new.agent_id, new.team_id) a;
  return new;
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
  perform app.check_switch_decider(v_switch.agent_id, v_switch.team_id, true);
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
  perform app.check_switch_decider(v_switch.agent_id, v_switch.team_id, false);
  if v_switch.status <> 'pending_approval' then raise exception 'ALREADY_DECIDED'; end if;
  update public.product_switches set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = p_switch;
  insert into public.approvals (entity_type, entity_id, decision, reason, decided_by)
  values ('product_switches', p_switch, 'rejected', btrim(p_reason), auth.uid());
  perform app.notify(v_switch.agent_id, 'switch_rejected', 'product_switches', p_switch,
    jsonb_build_object('customer', v_switch.customer_name, 'reason', btrim(p_reason)));
  perform app.log_activity('switches.reject', 'product_switches', p_switch);
end;
$$;

revoke execute on function app.check_decider(uuid, uuid, boolean), app.approvers_for(uuid, uuid),
  app.check_switch_decider(uuid, uuid, boolean), app.switch_approvers_for(uuid, uuid), app.notify_new_switch() from public;
