-- =====================================================================================
-- Sogasho Outdoor — database change 20261026090000_audit_cases
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/20261026090000_audit_cases.sql — do not edit; run "npm run db:sql-editor".
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
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026090000') then
    raise exception 'Already applied: 20261026090000_audit_cases. Nothing was changed.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261025150000') then
    raise exception 'Apply 20261025150000_team_leader_self_approval first. Nothing was changed.';
  end if;
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
-- =============================================================================
-- Phase 9 — Duplicate detection, audit cases and alerts (SDD §11, §18; FR-AUD-01…08; D-13, D-23, D-41)
--
-- audit_rules        : every rule with its enable flag and thresholds (Super Admin changes them, logged).
-- audit_cases        : investigations. Open → Under Review → Confirmed Issue / False Positive → Resolved.
-- audit_case_links   : what a case is about (events, sales, customers, agents). Append-only.
-- audit_case_history : every state change, assignment and note. Append-only.
-- email_outbox       : email copies of audit alerts, sent by the server (no phone or Index in any email).
--
-- Events are grouped into a case automatically (same customer — or, without a customer, same agent — within
-- 30 days) or a case is opened by hand. Only Super Admin or the assigned Auditor changes a case (FR-AUD-07);
-- nobody edits or deletes events, cases' identity, links or history (FR-AUD-05).
-- Effects (FR-AUD-08): Open / Under Review → linked agents on hold; Confirmed Issue → linked sales ineligible;
-- False Positive → none. Exposed to the eligibility service (Phase 10) as app.agent_audit_hold() and
-- app.sale_audit_state().
--
-- Owner choices (26 Oct 2026, D-41): MULTI_AGENT_ATTEMPT and POST_APPROVAL_EDIT on; BURST off; Team Leaders'
-- self-approved sales (D-40) recorded as SELF_APPROVED events only (no case, no hold). Refined the same day:
-- MULTI_AGENT_ATTEMPT counts New sales and blocked attempts only (a Retention by another agent is normal) and
-- holds only the agent who made the attempt; Super Admin corrections of a customer's phone / Index / name are
-- IDENTITY_CORRECTED events only (no case, no hold); events for the same customer / agent are serialised with
-- an advisory lock so concurrent events join one case.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create table public.audit_rules (
  code        text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,62}$'),
  name        text not null check (length(btrim(name)) between 3 and 80),
  description text not null check (length(btrim(description)) between 3 and 300),
  severity    text not null check (severity in ('info', 'low', 'medium', 'high')),
  enabled     boolean not null,
  can_disable boolean not null default true,       -- false = core rule required by the BRD (always on)
  opens_case  boolean not null,                    -- false = event only (no case, no hold)
  threshold   jsonb not null default '{}'::jsonb check (jsonb_typeof(threshold) = 'object'),
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint audit_rules_core_on check (can_disable or enabled)
);
create trigger audit_rules_touch before update on public.audit_rules for each row execute function app.touch_updated();
comment on table public.audit_rules is 'Audit rules with enable flags and thresholds (SDD §11.2). Changed only through public.audit_rule_update.';

insert into public.audit_rules (code, name, description, severity, enabled, can_disable, opens_case, threshold, sort_order) values
  ('DUP_PHONE', 'Duplicate phone number', 'A New sale used a phone number that already belongs to a customer. The sale was blocked.', 'high', true, false, true, '{}', 10),
  ('DUP_INDEX', 'Duplicate Index Number', 'A New sale used an Index Number that already belongs to a customer. The sale was blocked.', 'high', true, false, true, '{}', 20),
  ('IDENTITY_CONFLICT', 'Identity conflict', 'A Retention sale used a phone and Index of different customers, or a name that does not match. The sale was blocked.', 'high', true, false, true, '{}', 30),
  ('SAME_MONTH', 'Second sale in the same month', 'A sale was attempted for a customer who already has a sale this month. The sale was blocked.', 'high', true, false, true, '{}', 40),
  ('SWITCH_MISMATCH', 'Product switch mismatch', 'A product switch used details that do not match one existing customer and product. The switch was blocked.', 'medium', true, false, true, '{}', 50),
  ('MULTI_AGENT_ATTEMPT', 'Several agents, same customer', 'A customer registered as New by one agent was attempted again by a different agent within a short period. Normal Retention sales are not counted.', 'medium', true, true, true, '{"agents": 2, "days": 30}', 60),
  ('BURST', 'Too many sales too fast', 'One agent registered many sales within a few minutes.', 'medium', false, true, true, '{"sales": 5, "minutes": 30}', 70),
  ('POST_APPROVAL_EDIT', 'Edit after approval', 'An approved sale itself was changed after approval.', 'medium', true, true, true, '{}', 80),
  ('IDENTITY_CORRECTED', 'Customer details corrected', 'Super Admin corrected the phone, Index or name of a customer with an approved sale, with a reason. Recorded for review only; no case, no hold.', 'low', true, true, false, '{}', 85),
  ('SELF_APPROVED', 'Self-approved sale', 'A Team Leader approved their own sale (allowed by D-40). Recorded for review only; no case, no hold.', 'low', true, true, false, '{}', 90);

-- ---------------------------------------------------------------------------
-- Cases, links, history
-- ---------------------------------------------------------------------------
create table public.audit_cases (
  id            uuid primary key default gen_random_uuid(),
  case_no       bigint generated always as identity unique,
  title         text not null check (length(btrim(title)) between 3 and 200),
  rule_code     text references public.audit_rules (code),   -- null = opened by hand
  group_key     text,                                         -- 'customer:<id>' / 'agent:<id>'; null = manual
  status        text not null default 'open'
                  check (status in ('open', 'under_review', 'confirmed_issue', 'false_positive', 'resolved')),
  outcome       text check (outcome in ('confirmed_issue', 'false_positive')),
  assigned_to   uuid references public.user_profiles (id),
  opened_by     uuid,                                         -- null = opened automatically
  opened_at     timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now(),
  constraint audit_cases_outcome check (case status
    when 'open' then outcome is null
    when 'under_review' then outcome is null
    when 'resolved' then outcome is not null
    else outcome = status end)
);
create index audit_cases_group_idx on public.audit_cases (group_key, status);
create index audit_cases_status_idx on public.audit_cases (status, last_event_at desc);
create index audit_cases_assigned_idx on public.audit_cases (assigned_to, status);
comment on table public.audit_cases is
  'Audit investigations (SDD §11.3, D-13). Changed only through the audit_case_* functions; never deleted.';

-- A case's identity never changes; only state, outcome, assignment and timestamps move (FR-AUD-05).
create or replace function app.audit_case_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.case_no <> old.case_no or new.title <> old.title
     or new.rule_code is distinct from old.rule_code or new.group_key is distinct from old.group_key
     or new.opened_by is distinct from old.opened_by or new.opened_at <> old.opened_at then
    raise exception 'AUDIT_CASE_IMMUTABLE' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger audit_cases_guard before update on public.audit_cases for each row execute function app.audit_case_guard();
create trigger audit_cases_no_delete before delete on public.audit_cases for each row execute function app.prevent_change();
create trigger audit_cases_no_truncate before truncate on public.audit_cases for each statement execute function app.prevent_change();

create table public.audit_case_links (
  case_id     uuid not null references public.audit_cases (id),
  entity_type text not null check (entity_type in ('audit_events', 'sales', 'customers', 'user_profiles', 'product_switches')),
  entity_id   uuid not null,
  added_at    timestamptz not null default now(),
  added_by    uuid,
  primary key (case_id, entity_type, entity_id)
);
create index audit_case_links_entity_idx on public.audit_case_links (entity_type, entity_id);
create trigger audit_case_links_append_only before update or delete on public.audit_case_links for each row execute function app.prevent_change();
create trigger audit_case_links_no_truncate before truncate on public.audit_case_links for each statement execute function app.prevent_change();
comment on table public.audit_case_links is 'What a case is about: events, sales, customers, agents (user_profiles). Append-only.';

create table public.audit_case_history (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.audit_cases (id),
  at          timestamptz not null default now(),
  actor_id    uuid,                                         -- null = the system
  action      text not null check (action in ('opened', 'status', 'assigned', 'note', 'linked')),
  from_status text,
  to_status   text,
  assigned_to uuid,
  note        text not null check (length(btrim(note)) between 1 and 1000)
);
create index audit_case_history_case_idx on public.audit_case_history (case_id, at);
create trigger audit_case_history_append_only before update or delete on public.audit_case_history for each row execute function app.prevent_change();
create trigger audit_case_history_no_truncate before truncate on public.audit_case_history for each statement execute function app.prevent_change();
comment on table public.audit_case_history is 'Every state change, assignment and note on a case, with who and when. Append-only.';

-- ---------------------------------------------------------------------------
-- Notifications: audit kinds (SDD §18) + email outbox
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('sale_pending', 'sale_approved',
  'sale_rejected', 'switch_pending', 'switch_approved', 'switch_rejected', 'stock_to_accept', 'audit_alert', 'audit_case_assigned'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('sales', 'product_switches', 'stock_transfers', 'audit_cases'));

create table public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications (id),
  user_id         uuid not null references public.user_profiles (id),
  to_email        text,
  subject         text not null check (length(subject) <= 200),
  body            text not null check (length(body) <= 2000),
  link_path       text not null check (link_path ~ '^/[a-z0-9/_-]*$'),
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0 check (attempts between 0 and 20),
  last_error      text check (last_error is null or length(last_error) <= 300),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index email_outbox_status_idx on public.email_outbox (status, created_at);
comment on table public.email_outbox is
  'Email copies of audit alerts (D-23). Sent by the server with the secret key (T-25). No phone or Index in any email.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.super_admins()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ur.user_id from public.user_roles ur join public.user_profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin' and p.is_active
$$;

create or replace function app.rule_enabled(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.audit_rules where code = p_code), false)
$$;

-- Record a rule hit from inside the system (triggers, checks). Skipped when the rule is switched off.
-- The actor is the session user (may be null for maintenance run in the SQL Editor).
create or replace function app.rule_event(p_rule text, p_attempted jsonb, p_matched_type text, p_matched_id uuid, p_context jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.rule_enabled(p_rule) then return null; end if;
  insert into public.audit_events (rule_code, severity, actor_id, attempted_values, matched_entity_type, matched_entity_id, context)
  select p_rule, r.severity, auth.uid(), coalesce(p_attempted, '{}'::jsonb), p_matched_type, p_matched_id, coalesce(p_context, '{}'::jsonb)
  from public.audit_rules r where r.code = p_rule
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.case_link(p_case uuid, p_type text, p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_case_links (case_id, entity_type, entity_id, added_by)
  select p_case, p_type, p_id, auth.uid() where p_id is not null
  on conflict do nothing
$$;

-- Link a sale with its agent and customer.
create or replace function app.case_link_sale(p_case uuid, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  select agent_id, customer_id into v_sale from public.sales where id = p_sale;
  if not found then return; end if;
  perform app.case_link(p_case, 'sales', p_sale);
  perform app.case_link(p_case, 'user_profiles', v_sale.agent_id);
  perform app.case_link(p_case, 'customers', v_sale.customer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Automatic grouping of events into cases + Super Admin alert (FR-AUD-02, SDD §11.3)
-- ---------------------------------------------------------------------------
create or replace function app.on_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.audit_rules;
  v_customer uuid;
  v_agent uuid;
  v_key text;
  v_case uuid;
  v_no bigint;
  v_new boolean := false;
begin
  select * into r from public.audit_rules where code = new.rule_code;
  if not found or not r.opens_case then return null; end if;

  v_customer := case when new.matched_entity_type = 'customers' then new.matched_entity_id end;
  v_agent := coalesce(nullif(new.context ->> 'agent_id', '')::uuid, new.actor_id);
  v_key := coalesce('customer:' || v_customer, 'agent:' || v_agent, 'event:' || new.id);
  -- Two events for the same customer / agent at the same moment wait for each other, so they join one case.
  perform pg_advisory_xact_lock(hashtext('audit_case:' || v_key));

  select id, case_no into v_case, v_no from public.audit_cases
   where group_key = v_key and status in ('open', 'under_review') and last_event_at >= new.occurred_at - interval '30 days'
   order by opened_at desc limit 1
   for update;

  if v_case is null then
    insert into public.audit_cases (title, rule_code, group_key, last_event_at)
    values (r.name, r.code, v_key, new.occurred_at)
    returning id, case_no into v_case, v_no;
    insert into public.audit_case_history (case_id, action, to_status, note)
    values (v_case, 'opened', 'open', 'Opened automatically: ' || r.name);
    v_new := true;
  else
    update public.audit_cases set last_event_at = greatest(last_event_at, new.occurred_at), updated_at = now() where id = v_case;
    insert into public.audit_case_history (case_id, action, note) values (v_case, 'linked', 'New event added: ' || r.name);
  end if;

  perform app.case_link(v_case, 'audit_events', new.id);
  perform app.case_link(v_case, 'customers', v_customer);
  if v_agent is not null and exists (select 1 from public.user_profiles where id = v_agent) then
    perform app.case_link(v_case, 'user_profiles', v_agent);
  end if;
  if nullif(new.context ->> 'sale_id', '') is not null then
    perform app.case_link_sale(v_case, (new.context ->> 'sale_id')::uuid);
  end if;
  if new.matched_entity_type = 'sales' then perform app.case_link_sale(v_case, new.matched_entity_id); end if;

  -- In-app (and email) alert to every active Super Admin and the assigned Auditor. No phone or Index.
  perform app.notify(u.id, 'audit_alert', 'audit_cases', v_case,
    jsonb_build_object('rule', r.code, 'rule_name', r.name, 'case_no', v_no::text, 'new_case', v_new::text))
  from (select app.super_admins() as id
        union
        select assigned_to from public.audit_cases where id = v_case and assigned_to is not null) u;
  return null;
end;
$$;
create trigger audit_events_case after insert on public.audit_events for each row execute function app.on_audit_event();

-- Email copy of audit notifications (subject + body without phone or Index; the link is added at send time).
create or replace function app.queue_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_subject text;
  v_body text;
begin
  if new.kind not in ('audit_alert', 'audit_case_assigned') then return null; end if;
  select email into v_email from auth.users where id = new.user_id;
  if new.kind = 'audit_alert' then
    v_subject := 'Audit alert: ' || coalesce(new.data ->> 'rule_name', 'rule') || ' (case #' || coalesce(new.data ->> 'case_no', '?') || ')';
    v_body := 'A new audit alert needs review in Sogasho Outdoor.' || chr(10) || 'Rule: ' || coalesce(new.data ->> 'rule_name', '-')
      || chr(10) || 'Case: #' || coalesce(new.data ->> 'case_no', '?')
      || chr(10) || 'A duplicate attempt is a risk indicator, not proof of fraud. Open the case to review it.';
  else
    v_subject := 'Audit case #' || coalesce(new.data ->> 'case_no', '?') || ' assigned to you';
    v_body := 'An audit case was assigned to you in Sogasho Outdoor.' || chr(10) || 'Case: #' || coalesce(new.data ->> 'case_no', '?')
      || ' - ' || coalesce(new.data ->> 'title', '');
  end if;
  insert into public.email_outbox (notification_id, user_id, to_email, subject, body, link_path, status)
  values (new.id, new.user_id, v_email, left(v_subject, 200), left(v_body, 2000), '/audit/cases/' || new.entity_id,
    -- Agents' internal sign-in addresses (T-16) cannot receive email.
    case when v_email is null or v_email ilike '%@phone.%' then 'skipped' else 'pending' end);
  return null;
end;
$$;
create trigger notifications_email after insert on public.notifications for each row execute function app.queue_email();

-- ---------------------------------------------------------------------------
-- Additional rules (SDD §11.2)
-- ---------------------------------------------------------------------------
-- MULTI_AGENT_ATTEMPT: a customer's New sale and blocked attempts (duplicates, conflicts, mismatches) come from
-- ≥ N different agents within D days. Retention sales are NOT counted (a renewal with another agent is normal).
-- Checked when an attempt is blocked; one event per customer per window; only the attempting agent is linked
-- (put on hold) — the others are listed in the event.
create or replace function app.check_multi_agent(p_customer uuid, p_agent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_days int;
  v_min int;
  v_agents uuid[];
begin
  if p_customer is null or not app.rule_enabled('MULTI_AGENT_ATTEMPT') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'MULTI_AGENT_ATTEMPT';
  v_days := coalesce((v_t ->> 'days')::int, 30);
  v_min := coalesce((v_t ->> 'agents')::int, 2);
  if exists (select 1 from public.audit_events where rule_code = 'MULTI_AGENT_ATTEMPT' and matched_entity_type = 'customers'
             and matched_entity_id = p_customer and occurred_at >= now() - make_interval(days => v_days)) then
    return;
  end if;
  select array_agg(distinct a) into v_agents from (
    select agent_id as a from public.sales
     where customer_id = p_customer and customer_type = 'new' and submitted_at >= now() - make_interval(days => v_days)
    union all
    select actor_id from public.audit_events
     where matched_entity_type = 'customers' and matched_entity_id = p_customer and actor_id is not null
       and rule_code in ('DUP_PHONE', 'DUP_INDEX', 'IDENTITY_CONFLICT', 'SAME_MONTH', 'SWITCH_MISMATCH')
       and occurred_at >= now() - make_interval(days => v_days)
  ) x where a is not null;
  if coalesce(cardinality(v_agents), 0) < v_min then return; end if;
  perform app.rule_event('MULTI_AGENT_ATTEMPT',
    jsonb_build_object('agents', cardinality(v_agents), 'days', v_days,
      'agent_names', (select jsonb_agg(full_name order by full_name) from public.user_profiles where id = any (v_agents))),
    'customers', p_customer, jsonb_build_object('source', 'check_multi_agent', 'agent_id', p_agent));
end;
$$;

-- BURST: ≥ N sales by one agent within M minutes. One event per agent per window.
create or replace function app.check_burst(p_agent uuid, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_n int;
  v_m int;
  v_count int;
begin
  if not app.rule_enabled('BURST') then return; end if;
  select threshold into v_t from public.audit_rules where code = 'BURST';
  v_n := coalesce((v_t ->> 'sales')::int, 5);
  v_m := coalesce((v_t ->> 'minutes')::int, 30);
  select count(*) into v_count from public.sales where agent_id = p_agent and submitted_at >= now() - make_interval(mins => v_m);
  if v_count < v_n then return; end if;
  if exists (select 1 from public.audit_events where rule_code = 'BURST' and context ->> 'agent_id' = p_agent::text
             and occurred_at >= now() - make_interval(mins => v_m)) then
    return;
  end if;
  perform app.rule_event('BURST', jsonb_build_object('sales', v_count, 'minutes', v_m), null, null,
    jsonb_build_object('source', 'check_burst', 'agent_id', p_agent, 'sale_id', p_sale));
end;
$$;

create or replace function app.on_sale_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_burst(new.agent_id, new.id);
  return null;
end;
$$;
create trigger sales_audit_rules after insert on public.sales for each row execute function app.on_sale_insert();

create or replace function app.on_attempt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule_code in ('DUP_PHONE', 'DUP_INDEX', 'IDENTITY_CONFLICT', 'SAME_MONTH', 'SWITCH_MISMATCH')
     and new.matched_entity_type = 'customers' then
    perform app.check_multi_agent(new.matched_entity_id, new.actor_id);
  end if;
  return null;
end;
$$;
create trigger audit_events_multi_agent after insert on public.audit_events for each row execute function app.on_attempt_event();

-- IDENTITY_CORRECTED: a customer's phone / Index / name corrected (Super Admin, with a reason) after one of
-- their sales was approved. Event only — no case, no hold (D-41).
create or replace function app.identity_corrected(p_customer uuid, p_attempted jsonb, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  select id, agent_id into v_sale from public.sales where customer_id = p_customer and status = 'approved'
   order by approved_at desc nulls last limit 1;
  if not found then return; end if;
  perform app.rule_event('IDENTITY_CORRECTED', p_attempted, 'customers', p_customer,
    jsonb_build_object('source', p_source, 'agent_id', v_sale.agent_id, 'sale_id', v_sale.id));
end;
$$;

create or replace function app.on_identifier_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_current and not new.is_current and new.replaced_at is not null then
    perform app.identity_corrected(new.customer_id,
      jsonb_build_object('field', new.kind, 'old_value', old.value, 'reason', new.replace_reason), 'change_customer_identifier');
  end if;
  return null;
end;
$$;
create trigger customer_identifiers_post_approval after update on public.customer_identifiers
  for each row execute function app.on_identifier_replaced();

create or replace function app.on_customer_renamed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name then
    perform app.identity_corrected(new.id, jsonb_build_object('field', 'name', 'old_value', old.full_name, 'new_value', new.full_name), 'customers');
  end if;
  return null;
end;
$$;
create trigger customers_post_approval after update on public.customers for each row execute function app.on_customer_renamed();

-- POST_APPROVAL_EDIT: an approved sale itself changed (the system never does this) → case + hold.
create or replace function app.on_approved_sale_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if old.status <> 'approved' or new.status <> 'approved' then return null; end if;
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new) - 'updated_at' - 'updated_by') n
  where n.value is distinct from (to_jsonb(old) -> n.key);
  if v_changed is null then return null; end if;
  perform app.rule_event('POST_APPROVAL_EDIT', jsonb_build_object('field', 'sale', 'changed', to_jsonb(v_changed)), 'customers', new.customer_id,
    jsonb_build_object('source', 'sales', 'agent_id', new.agent_id, 'sale_id', new.id));
  return null;
end;
$$;
create trigger sales_post_approval after update on public.sales for each row execute function app.on_approved_sale_changed();

-- SELF_APPROVED: a Team Leader approved their own sale (D-40). Event only.
create or replace function app.on_sale_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  if new.entity_type <> 'sales' or new.decision <> 'approved' then return null; end if;
  select agent_id, customer_id into v_sale from public.sales where id = new.entity_id;
  if v_sale.agent_id = new.decided_by then
    perform app.rule_event('SELF_APPROVED', jsonb_build_object('items', new.items), 'sales', new.entity_id,
      jsonb_build_object('source', 'approve_sale', 'agent_id', v_sale.agent_id, 'customer_id', v_sale.customer_id));
  end if;
  return null;
end;
$$;
create trigger approvals_self_approved after insert on public.approvals for each row execute function app.on_sale_decision();

-- ---------------------------------------------------------------------------
-- Effects for the eligibility service (Phase 10) and payroll (Phase 16) — FR-AUD-08
-- ---------------------------------------------------------------------------
create or replace function app.agent_audit_hold(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
    where l.entity_type = 'user_profiles' and l.entity_id = p_agent and c.status in ('open', 'under_review'))
$$;
comment on function app.agent_audit_hold(uuid) is 'True while the agent is linked to an Open or Under Review case (payroll line on hold).';

-- 'confirmed_issue' (ineligible) / 'on_hold' / null.
create or replace function app.sale_audit_state(p_sale uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
                 where l.entity_type = 'sales' and l.entity_id = p_sale and c.outcome = 'confirmed_issue') then 'confirmed_issue'
    when exists (select 1 from public.audit_case_links l join public.audit_cases c on c.id = l.case_id
                 where l.entity_type = 'sales' and l.entity_id = p_sale and c.status in ('open', 'under_review'))
      or app.agent_audit_hold((select agent_id from public.sales where id = p_sale)) then 'on_hold'
  end
$$;
comment on function app.sale_audit_state(uuid) is 'Audit effect on a sale: confirmed_issue = ineligible, on_hold = payroll hold, null = none.';

-- ---------------------------------------------------------------------------
-- Case management — Super Admin, or the Auditor assigned to the case (FR-AUD-07)
-- ---------------------------------------------------------------------------
create or replace function app.can_manage_case(p_assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user() and coalesce(app.in_scope('audit.manage', p_assigned), false)
$$;

create or replace function app.case_note(p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  return left(btrim(p_note), 1000);
end;
$$;

create or replace function public.audit_case_set_status(p_case uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.audit_cases;
  v_note text;
begin
  select * into v_case from public.audit_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app.can_manage_case(v_case.assigned_to) then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  v_note := app.case_note(p_note);
  if not ((v_case.status = 'open' and p_status = 'under_review')
       or (v_case.status = 'under_review' and p_status in ('confirmed_issue', 'false_positive'))
       or (v_case.status in ('confirmed_issue', 'false_positive') and p_status = 'resolved')) then
    raise exception 'INVALID_TRANSITION';
  end if;
  update public.audit_cases
     set status = p_status,
         outcome = case when p_status in ('confirmed_issue', 'false_positive') then p_status else outcome end,
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
         updated_at = now()
   where id = p_case;
  insert into public.audit_case_history (case_id, actor_id, action, from_status, to_status, note)
  values (p_case, auth.uid(), 'status', v_case.status, p_status, v_note);
  perform app.log_activity('audit.case_status', 'audit_cases', p_case, jsonb_build_object('from', v_case.status, 'to', p_status));
end;
$$;

create or replace function public.audit_case_add_note(p_case uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned uuid;
begin
  select assigned_to into v_assigned from public.audit_cases where id = p_case;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app.can_manage_case(v_assigned) then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  insert into public.audit_case_history (case_id, actor_id, action, note) values (p_case, auth.uid(), 'note', app.case_note(p_note));
end;
$$;

-- Super Admin assigns (or unassigns, p_user null) a case to an active Auditor or Super Admin.
create or replace function public.audit_case_assign(p_case uuid, p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.audit_cases;
  v_name text;
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_case from public.audit_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_case.status = 'resolved' then raise exception 'CASE_RESOLVED'; end if;
  if p_user is not null and not exists (
    select 1 from public.user_profiles p join public.user_roles ur on ur.user_id = p.id
    where p.id = p_user and p.is_active and ur.role_key in ('auditor', 'super_admin')) then
    raise exception 'ASSIGNEE_INVALID';
  end if;
  if p_user is not distinct from v_case.assigned_to then return; end if;
  update public.audit_cases set assigned_to = p_user, updated_at = now() where id = p_case;
  select full_name into v_name from public.user_profiles where id = p_user;
  insert into public.audit_case_history (case_id, actor_id, action, assigned_to, note)
  values (p_case, auth.uid(), 'assigned', p_user,
    coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), case when p_user is null then 'Unassigned' else 'Assigned to ' || v_name end));
  if p_user is not null and p_user <> auth.uid() then
    perform app.notify(p_user, 'audit_case_assigned', 'audit_cases', p_case,
      jsonb_build_object('case_no', v_case.case_no::text, 'title', v_case.title));
  end if;
  perform app.log_activity('audit.case_assign', 'audit_cases', p_case, jsonb_build_object('assigned_to', p_user));
end;
$$;

-- Manual case (Super Admin), optionally about one sale (its agent and customer are linked too).
create or replace function public.audit_case_create(p_title text, p_note text, p_sale uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then raise exception 'TITLE_REQUIRED'; end if;
  if p_sale is not null and not exists (select 1 from public.sales where id = p_sale) then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_cases (title, opened_by) values (v_title, auth.uid()) returning id into v_case;
  insert into public.audit_case_history (case_id, actor_id, action, to_status, note)
  values (v_case, auth.uid(), 'opened', 'open', app.case_note(p_note));
  if p_sale is not null then perform app.case_link_sale(v_case, p_sale); end if;
  perform app.log_activity('audit.case_create', 'audit_cases', v_case, jsonb_build_object('sale', p_sale));
  return v_case;
end;
$$;

-- Rules: enable / disable and thresholds (Super Admin, settings.manage; logged). Core rules stay on.
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
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'THRESHOLD_INVALID';
  end;
  update public.audit_rules set enabled = coalesce(p_enabled, false), threshold = v_t, updated_by = auth.uid() where code = p_code;
  perform app.log_activity('audit.rule_update', 'audit_rules', null,
    jsonb_build_object('code', p_code, 'enabled', coalesce(p_enabled, false), 'threshold', v_t));
end;
$$;

-- Email queue status for the audit screen (counts only).
create or replace function public.email_outbox_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() or app.permission_scope('audit.manage') is distinct from 'all' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (select jsonb_build_object(
    'pending', count(*) filter (where status in ('pending', 'sending')),
    'failed', count(*) filter (where status = 'failed'),
    'sent', count(*) filter (where status = 'sent'))
    from public.email_outbox);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — reads only; every write goes through the functions and triggers above.
-- ---------------------------------------------------------------------------
alter table public.audit_rules enable row level security;
alter table public.audit_cases enable row level security;
alter table public.audit_case_links enable row level security;
alter table public.audit_case_history enable row level security;
alter table public.email_outbox enable row level security;
revoke all on public.audit_rules, public.audit_cases, public.audit_case_links, public.audit_case_history, public.email_outbox
  from anon, authenticated, service_role;
grant select on public.audit_rules, public.audit_cases, public.audit_case_links, public.audit_case_history to authenticated, service_role;
-- The server's email sender (secret key, T-25) reads the queue and records the result.
grant select, update on public.email_outbox to service_role;

create policy audit_rules_read on public.audit_rules for select to authenticated
  using (app.is_active_user() and (app.has_permission('audit.read') or app.has_permission('settings.manage')));
create policy audit_cases_read on public.audit_cases for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
create policy audit_case_links_read on public.audit_case_links for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
create policy audit_case_history_read on public.audit_case_history for select to authenticated
  using (app.is_active_user() and app.has_permission('audit.read'));
-- email_outbox: no policy for authenticated — nobody reads it through the API except the server.

select app.enable_change_log('public.audit_rules', 'code');
select app.enable_change_log('public.audit_cases');
select app.enable_change_log('public.audit_case_links', 'case_id');
select app.enable_change_log('public.audit_case_history');
select app.enable_change_log('public.email_outbox', 'id', 'to_email');

revoke execute on function app.audit_case_guard(), app.super_admins(), app.rule_enabled(text),
  app.rule_event(text, jsonb, text, uuid, jsonb), app.case_link(uuid, text, uuid), app.case_link_sale(uuid, uuid),
  app.on_audit_event(), app.queue_email(), app.check_multi_agent(uuid, uuid), app.check_burst(uuid, uuid),
  app.on_sale_insert(), app.on_attempt_event(), app.identity_corrected(uuid, jsonb, text), app.on_identifier_replaced(),
  app.on_customer_renamed(), app.on_approved_sale_changed(), app.on_sale_decision(), app.agent_audit_hold(uuid),
  app.sale_audit_state(uuid), app.can_manage_case(uuid), app.case_note(text) from public;

revoke execute on function public.audit_case_set_status(uuid, text, text), public.audit_case_add_note(uuid, text),
  public.audit_case_assign(uuid, uuid, text), public.audit_case_create(text, text, uuid),
  public.audit_rule_update(text, boolean, jsonb), public.email_outbox_summary() from public, anon, authenticated, service_role;
grant execute on function public.audit_case_set_status(uuid, text, text), public.audit_case_add_note(uuid, text),
  public.audit_case_assign(uuid, uuid, text), public.audit_case_create(text, text, uuid),
  public.audit_rule_update(text, boolean, jsonb), public.email_outbox_summary() to authenticated;
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('20261026090000', 'audit_cases');

commit;

select 'Applied 20261026090000_audit_cases successfully' as result;
