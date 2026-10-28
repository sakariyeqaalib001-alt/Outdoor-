import "server-only";
import type { CaseStatus } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only queries for the Audit screens (Phase 9). RLS limits every row to audit.read holders. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

type Supabase = Awaited<ReturnType<typeof client>>;

async function namesOf(supabase: Supabase, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return {};
  const { data } = await supabase.from("user_profiles").select("id, full_name").in("id", unique);
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
}

export type CaseRow = {
  id: string;
  case_no: number;
  title: string;
  rule_code: string | null;
  status: CaseStatus;
  outcome: CaseStatus | null;
  assigned_to: string | null;
  assignee: string | null;
  opened_at: string;
  last_event_at: string;
  events: number;
};

export async function listCases(status?: CaseStatus | "active"): Promise<CaseRow[]> {
  const supabase = await client();
  let query = supabase
    .from("audit_cases")
    .select("id, case_no, title, rule_code, status, outcome, assigned_to, opened_at, last_event_at")
    .order("last_event_at", { ascending: false })
    .limit(300);
  if (status === "active") query = query.in("status", ["open", "under_review"]);
  else if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) console.error(`[audit] cases query failed: ${error.message}`);
  const rows = (data ?? []) as Omit<CaseRow, "assignee" | "events">[];
  const [names, counts] = await Promise.all([
    namesOf(supabase, rows.map((r) => r.assigned_to)),
    rows.length
      ? supabase.from("audit_case_links").select("case_id").eq("entity_type", "audit_events").in("case_id", rows.map((r) => r.id))
      : Promise.resolve({ data: [] }),
  ]);
  const perCase: Record<string, number> = {};
  for (const l of (counts.data ?? []) as { case_id: string }[]) perCase[l.case_id] = (perCase[l.case_id] ?? 0) + 1;
  return rows.map((r) => ({ ...r, assignee: r.assigned_to ? names[r.assigned_to] ?? null : null, events: perCase[r.id] ?? 0 }));
}

export type EventRow = {
  id: string;
  occurred_at: string;
  rule_code: string;
  severity: string;
  actor: string | null;
  attempted_values: Record<string, unknown>;
  matched_entity_type: string | null;
  matched_entity_id: string | null;
  matched_customer: string | null;
  context: Record<string, unknown>;
  case_id: string | null;
  case_no: number | null;
  case_status: CaseStatus | null;
};

type RawEvent = Omit<EventRow, "actor" | "matched_customer" | "case_id" | "case_no" | "case_status"> & { actor_id: string | null };

async function decorateEvents(supabase: Supabase, rows: RawEvent[]): Promise<EventRow[]> {
  const ids = rows.map((r) => r.id);
  const customers = [...new Set(rows.filter((r) => r.matched_entity_type === "customers" && r.matched_entity_id).map((r) => r.matched_entity_id!))];
  const [names, links, people] = await Promise.all([
    namesOf(supabase, rows.map((r) => r.actor_id)),
    ids.length ? supabase.from("audit_case_links").select("case_id, entity_id").eq("entity_type", "audit_events").in("entity_id", ids) : Promise.resolve({ data: [] }),
    customers.length ? supabase.from("customers").select("id, full_name").in("id", customers) : Promise.resolve({ data: [] }),
  ]);
  const caseOfEvent = Object.fromEntries(((links.data ?? []) as { case_id: string; entity_id: string }[]).map((l) => [l.entity_id, l.case_id]));
  const caseIds = [...new Set(Object.values(caseOfEvent))];
  const { data: cases } = caseIds.length
    ? await supabase.from("audit_cases").select("id, case_no, status").in("id", caseIds)
    : { data: [] };
  const caseInfo = Object.fromEntries(((cases ?? []) as { id: string; case_no: number; status: CaseStatus }[]).map((c) => [c.id, c]));
  const customerName = Object.fromEntries(((people.data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  return rows.map(({ actor_id, ...r }) => {
    const caseId = caseOfEvent[r.id] ?? null;
    return {
      ...r,
      actor: actor_id ? names[actor_id] ?? null : null,
      matched_customer: r.matched_entity_type === "customers" && r.matched_entity_id ? customerName[r.matched_entity_id] ?? null : null,
      case_id: caseId,
      case_no: caseId ? caseInfo[caseId]?.case_no ?? null : null,
      case_status: caseId ? caseInfo[caseId]?.status ?? null : null,
    };
  });
}

const EVENT_COLUMNS = "id, occurred_at, rule_code, severity, actor_id, attempted_values, matched_entity_type, matched_entity_id, context";

export async function listEvents(rule?: string): Promise<EventRow[]> {
  const supabase = await client();
  let query = supabase.from("audit_events").select(EVENT_COLUMNS).order("occurred_at", { ascending: false }).limit(300);
  if (rule) query = query.eq("rule_code", rule);
  const { data, error } = await query;
  if (error) console.error(`[audit] events query failed: ${error.message}`);
  return decorateEvents(supabase, (data ?? []) as RawEvent[]);
}

export type HistoryRow = { at: string; actor: string | null; action: string; from_status: CaseStatus | null; to_status: CaseStatus | null; assignee: string | null; note: string };
export type LinkedSale = { id: string; customer_name: string; status: string; sale_month: string; agent: string | null; audit: string | null };
export type CaseDetail = Omit<CaseRow, "events"> & {
  history: HistoryRow[];
  events: EventRow[];
  sales: LinkedSale[];
  customers: { id: string; name: string }[];
  agents: { id: string; name: string; onHold: boolean }[];
};

export async function getCase(id: string): Promise<CaseDetail | null> {
  const supabase = await client();
  const { data: row } = await supabase
    .from("audit_cases")
    .select("id, case_no, title, rule_code, status, outcome, assigned_to, opened_at, last_event_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;
  const c = row as Omit<CaseRow, "assignee" | "events">;
  const [{ data: history }, { data: links }] = await Promise.all([
    supabase.from("audit_case_history").select("at, actor_id, action, from_status, to_status, assigned_to, note").eq("case_id", id).order("at"),
    supabase.from("audit_case_links").select("entity_type, entity_id").eq("case_id", id),
  ]);
  const linked = (links ?? []) as { entity_type: string; entity_id: string }[];
  const of = (type: string) => linked.filter((l) => l.entity_type === type).map((l) => l.entity_id);
  const hist = (history ?? []) as { at: string; actor_id: string | null; action: string; from_status: CaseStatus | null; to_status: CaseStatus | null; assigned_to: string | null; note: string }[];

  const [eventsRaw, salesRaw, customersRaw, holds] = await Promise.all([
    of("audit_events").length ? supabase.from("audit_events").select(EVENT_COLUMNS).in("id", of("audit_events")).order("occurred_at") : Promise.resolve({ data: [] }),
    of("sales").length ? supabase.from("sales").select("id, customer_name, status, sale_month, agent_id").in("id", of("sales")) : Promise.resolve({ data: [] }),
    of("customers").length ? supabase.from("customers").select("id, full_name").in("id", of("customers")) : Promise.resolve({ data: [] }),
    // Other open cases of the linked agents (hold effect, FR-AUD-08).
    of("user_profiles").length
      ? supabase.from("audit_case_links").select("entity_id, audit_cases!inner(status)").eq("entity_type", "user_profiles").in("entity_id", of("user_profiles")).in("audit_cases.status", ["open", "under_review"])
      : Promise.resolve({ data: [] }),
  ]);
  const sales = (salesRaw.data ?? []) as { id: string; customer_name: string; status: string; sale_month: string; agent_id: string }[];
  const names = await namesOf(supabase, [c.assigned_to, ...hist.map((h) => h.actor_id), ...hist.map((h) => h.assigned_to), ...of("user_profiles"), ...sales.map((s) => s.agent_id)]);
  const onHold = new Set(((holds.data ?? []) as { entity_id: string }[]).map((h) => h.entity_id));
  const confirmedSales = new Set<string>();
  if (sales.length) {
    const { data: sl } = await supabase
      .from("audit_case_links")
      .select("entity_id, audit_cases!inner(outcome, status)")
      .eq("entity_type", "sales")
      .in("entity_id", sales.map((s) => s.id));
    for (const l of (sl ?? []) as unknown as { entity_id: string; audit_cases: { outcome: string | null; status: string } }[]) {
      if (l.audit_cases.outcome === "confirmed_issue") confirmedSales.add(l.entity_id);
    }
  }

  return {
    ...c,
    assignee: c.assigned_to ? names[c.assigned_to] ?? null : null,
    history: hist.map((h) => ({
      at: h.at, actor: h.actor_id ? names[h.actor_id] ?? null : null, action: h.action, from_status: h.from_status, to_status: h.to_status,
      assignee: h.assigned_to ? names[h.assigned_to] ?? null : null, note: h.note,
    })),
    events: await decorateEvents(supabase, (eventsRaw.data ?? []) as RawEvent[]),
    sales: sales.map((s) => ({
      id: s.id, customer_name: s.customer_name, status: s.status, sale_month: s.sale_month, agent: names[s.agent_id] ?? null,
      audit: confirmedSales.has(s.id) ? "confirmed_issue" : onHold.has(s.agent_id) || ["open", "under_review"].includes(c.status) ? "on_hold" : null,
    })),
    customers: ((customersRaw.data ?? []) as { id: string; full_name: string }[]).map((x) => ({ id: x.id, name: x.full_name })),
    agents: of("user_profiles").map((u) => ({ id: u, name: names[u] ?? "—", onHold: onHold.has(u) })),
  };
}

/** Active Auditors and Super Admins a case can be assigned to. */
export async function assignableUsers(): Promise<{ id: string; name: string }[]> {
  const supabase = await client();
  const { data } = await supabase.from("user_roles").select("user_id, role_key").in("role_key", ["auditor", "super_admin"]);
  const ids = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase.from("user_profiles").select("id, full_name, is_active").in("id", ids).eq("is_active", true).order("full_name");
  return ((people ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, name: p.full_name }));
}

export type RuleRow = { code: string; severity: string; enabled: boolean; can_disable: boolean; opens_case: boolean; threshold: Record<string, number>; updated_at: string };

export async function listRules(): Promise<RuleRow[]> {
  const { data } = await (await client())
    .from("audit_rules")
    .select("code, severity, enabled, can_disable, opens_case, threshold, updated_at")
    .order("sort_order");
  return (data ?? []) as RuleRow[];
}

export async function emailSummary(): Promise<{ pending: number; failed: number; sent: number } | null> {
  const { data, error } = await (await client()).rpc("email_outbox_summary");
  if (error) return null;
  return data as { pending: number; failed: number; sent: number };
}

/** Audit flag of one sale for the sale page (audit.read holders only — RLS returns nothing to others). */
export async function saleAuditCases(saleId: string): Promise<{ id: string; case_no: number; status: CaseStatus; outcome: CaseStatus | null }[]> {
  const { data } = await (await client())
    .from("audit_case_links")
    .select("audit_cases!inner(id, case_no, status, outcome)")
    .eq("entity_type", "sales")
    .eq("entity_id", saleId);
  return ((data ?? []) as unknown as { audit_cases: { id: string; case_no: number; status: CaseStatus; outcome: CaseStatus | null } }[]).map((l) => l.audit_cases);
}
