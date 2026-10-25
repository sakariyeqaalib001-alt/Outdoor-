import "server-only";
import { businessToday } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionId } from "@/server/auth/session";

/** Read-only queries for Approvals, Product switch and Notifications (Phase 8). RLS limits every row. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export type PendingRow = {
  kind: "sale" | "switch";
  id: string;
  submitted_at: string;
  customer_name: string;
  agent_id: string;
  agent: string;
  team_id: string | null;
  team: string | null;
  detail: string; // "FTTH · SO-Home" or "FTTA → FTTH · SO-Home"
  customer_type: "new" | "retention" | null; // sales only
  amount: number | null; // sales only
  own: boolean; // the caller's own (Super Admin may only reject — cancel — it, D-38)
  allowed: string[]; // stock items allowed for this product — exactly one is given at approval (D-39); empty = none
};
export type StockItem = { id: string; name: string };

type Named = { id: string; name: string };

/** Everything waiting for the caller's decision: sales and switches of the teams they lead (Super Admin: all). */
export async function listPending(): Promise<{ rows: PendingRow[]; items: StockItem[]; available: Record<string, Record<string, number>> }> {
  const supabase = await client();
  const ids = await getSessionId(supabase);
  const me = ids?.userId ?? "";
  const today = businessToday();
  const [sales, switches, teams, items, report, locations, rules] = await Promise.all([
    supabase
      .from("sales")
      .select("id, submitted_at, customer_name, customer_type, agent_id, team_id, amount_collected, product_id, products(code), plans(name)")
      .eq("status", "pending_approval")
      .order("submitted_at"),
    supabase
      .from("product_switches")
      .select("id, submitted_at, customer_name, agent_id, team_id, to_product_id, from:products!product_switches_from_product_id_fkey(code), to:products!product_switches_to_product_id_fkey(code), plans(name)")
      .eq("status", "pending_approval")
      .order("submitted_at"),
    supabase.from("teams").select("id, name, team_leader_id"),
    supabase.from("stock_items").select("id, display_name").eq("is_active", true).order("sort_order"),
    supabase.rpc("stock_report", { p_from: today, p_to: today }),
    supabase.from("stock_locations").select("id, team_id").not("team_id", "is", null),
    supabase.from("product_equipment").select("product_id, stock_item_id"),
  ]);
  const { data: access } = await supabase.rpc("my_access");
  const isSuperAdmin = ((access as { roles?: string[] } | null)?.roles ?? []).includes("super_admin");
  // Safe diagnostics: error messages only (no customer data).
  for (const [name, r] of Object.entries({ sales, switches, teams, items, report, locations, rules })) {
    if (r.error) console.error(`[approvals] ${name} query failed: ${r.error.message}`);
  }
  const teamRows = (teams.data ?? []) as { id: string; name: string; team_leader_id: string | null }[];
  const teamName = Object.fromEntries(teamRows.map((tm) => [tm.id, tm.name]));
  const mine = new Set(teamRows.filter((tm) => tm.team_leader_id === me).map((tm) => tm.id));
  // A Team Leader decides only for the teams they lead (the database checks again).
  // Own items: never approvable; a Super Admin may still reject (cancel) them.
  const decidable = (team: string | null, agent: string) =>
    agent === me ? isSuperAdmin : isSuperAdmin || (team !== null && mine.has(team));

  type RawSale = { id: string; submitted_at: string; customer_name: string; customer_type: string; agent_id: string; team_id: string | null; amount_collected: number; product_id: string; products: { code: string }; plans: { name: string } };
  type RawSwitch = { id: string; submitted_at: string; customer_name: string; agent_id: string; team_id: string | null; to_product_id: string; from: { code: string }; to: { code: string }; plans: { name: string } };
  const allowedFor = (product: string) =>
    ((rules.data ?? []) as { product_id: string; stock_item_id: string }[]).filter((r) => r.product_id === product).map((r) => r.stock_item_id);
  const saleRows = ((sales.data ?? []) as unknown as RawSale[]).filter((s) => decidable(s.team_id, s.agent_id));
  const switchRows = ((switches.data ?? []) as unknown as RawSwitch[]).filter((s) => decidable(s.team_id, s.agent_id));

  const agentIds = [...new Set([...saleRows, ...switchRows].map((r) => r.agent_id))];
  const names: Record<string, string> = {};
  if (agentIds.length) {
    const { data } = await supabase.from("user_profiles").select("id, full_name").in("id", agentIds);
    for (const p of (data ?? []) as { id: string; full_name: string }[]) names[p.id] = p.full_name;
  }

  const rows: PendingRow[] = [
    ...saleRows.map((s) => ({
      kind: "sale" as const, id: s.id, submitted_at: s.submitted_at, customer_name: s.customer_name, agent_id: s.agent_id,
      agent: names[s.agent_id] ?? "—", team_id: s.team_id, team: s.team_id ? teamName[s.team_id] ?? null : null,
      detail: `${s.products.code} · ${s.plans.name}`, customer_type: s.customer_type as "new" | "retention", amount: Number(s.amount_collected), own: s.agent_id === me, allowed: allowedFor(s.product_id),
    })),
    ...switchRows.map((s) => ({
      kind: "switch" as const, id: s.id, submitted_at: s.submitted_at, customer_name: s.customer_name, agent_id: s.agent_id,
      agent: names[s.agent_id] ?? "—", team_id: s.team_id, team: s.team_id ? teamName[s.team_id] ?? null : null,
      detail: `${s.from.code} → ${s.to.code} · ${s.plans.name}`, customer_type: null, amount: null, own: s.agent_id === me, allowed: allowedFor(s.to_product_id),
    })),
  ].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));

  // Stock available per team and item (for the equipment boxes).
  const locToTeam = Object.fromEntries(((locations.data ?? []) as { id: string; team_id: string }[]).map((l) => [l.id, l.team_id]));
  const available: Record<string, Record<string, number>> = {};
  for (const r of (report.data ?? []) as { location_id: string; item_id: string; closing: number }[]) {
    const team = locToTeam[r.location_id];
    if (team) (available[team] ??= {})[r.item_id] = r.closing;
  }

  return {
    rows,
    items: ((items.data ?? []) as { id: string; display_name: string }[]).map((i) => ({ id: i.id, name: i.display_name })),
    available,
  };
}

export type SwitchFormData = { myCity: string | null; canOverrideCity: boolean; cities: Named[]; branches: (Named & { city_id: string })[]; products: { id: string; code: string }[]; plans: { id: string; product_id: string; name: string }[] };

export async function getSwitchFormData(canOverrideCity: boolean): Promise<SwitchFormData> {
  const supabase = await client();
  const ids = await getSessionId(supabase);
  const [me, cities, branches, products, plans] = await Promise.all([
    supabase.from("user_profiles").select("city_id").eq("id", ids?.userId ?? "").maybeSingle(),
    supabase.from("cities").select("id, name").eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name, city_id").eq("is_active", true).order("name"),
    supabase.from("products").select("id, code").in("code", ["FTTA", "FTTH"]).eq("is_active", true).order("sort_order"),
    supabase.from("plans").select("id, product_id, name").eq("is_active", true).order("sort_order"),
  ]);
  return {
    myCity: (me.data as { city_id: string | null } | null)?.city_id ?? null,
    canOverrideCity,
    cities: (cities.data ?? []) as Named[],
    branches: (branches.data ?? []) as (Named & { city_id: string })[],
    products: (products.data ?? []) as { id: string; code: string }[],
    plans: (plans.data ?? []) as { id: string; product_id: string; name: string }[],
  };
}

export type SwitchRow = { id: string; submitted_at: string; customer_name: string; status: "pending_approval" | "approved" | "rejected"; change: string };

export async function listSwitches(): Promise<SwitchRow[]> {
  const { data } = await (await client())
    .from("product_switches")
    .select("id, submitted_at, customer_name, status, from:products!product_switches_from_product_id_fkey(code), to:products!product_switches_to_product_id_fkey(code), plans(name)")
    .order("submitted_at", { ascending: false })
    .limit(200);
  type Raw = { id: string; submitted_at: string; customer_name: string; status: SwitchRow["status"]; from: { code: string }; to: { code: string }; plans: { name: string } };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id, submitted_at: r.submitted_at, customer_name: r.customer_name, status: r.status, change: `${r.from.code} → ${r.to.code} · ${r.plans.name}`,
  }));
}

export type Decision = { decision: "approved" | "rejected"; reason: string | null; decided_at: string; by: string | null };

/** Approve / reject history of a sale or switch. */
export async function listDecisions(entityType: "sales" | "product_switches", id: string): Promise<Decision[]> {
  const supabase = await client();
  const { data } = await supabase.from("approvals").select("decision, reason, decided_at, decided_by").eq("entity_type", entityType).eq("entity_id", id).order("decided_at");
  const rows = (data ?? []) as { decision: Decision["decision"]; reason: string | null; decided_at: string; decided_by: string }[];
  const names: Record<string, string> = {};
  if (rows.length) {
    const { data: people } = await supabase.from("user_profiles").select("id, full_name").in("id", [...new Set(rows.map((r) => r.decided_by))]);
    for (const p of (people ?? []) as { id: string; full_name: string }[]) names[p.id] = p.full_name;
  }
  return rows.map((r) => ({ decision: r.decision, reason: r.reason, decided_at: r.decided_at, by: names[r.decided_by] ?? null }));
}

export type NotificationRow = { id: string; kind: string; entity_type: string; entity_id: string; data: Record<string, string>; created_at: string; read_at: string | null };

export async function listNotifications(limit = 100): Promise<NotificationRow[]> {
  const { data } = await (await client()).from("notifications").select("id, kind, entity_type, entity_id, data, created_at, read_at").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as NotificationRow[];
}

export async function unreadCount(): Promise<number> {
  const { count } = await (await client()).from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}
