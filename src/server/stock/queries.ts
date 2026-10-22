import "server-only";
import { t } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only stock queries (Phase 6, D-35). They run as the signed-in user, so RLS limits every row. */

export type StockItem = { id: string; code: string; display_name: string };
export type StockLocation = { id: string; kind: "central" | "faulty" | "team"; team_id: string | null; label: string; leader_id: string | null };
export type TeamChoice = { id: string; name: string };
export type TransferRow = {
  id: string;
  to_location_id: string;
  status: "sent" | "accepted" | "cancelled";
  note: string | null;
  sent_at: string;
  decided_at: string | null;
  lines: { item_id: string; quantity: number }[];
};
export type AdjustmentRow = {
  id: string;
  location_id: string;
  item_id: string;
  quantity_change: number;
  reason: string;
  status: "requested" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
};
export type MovementRow = {
  id: string;
  movement_type: string;
  item_id: string;
  quantity: number;
  from_location_id: string | null;
  to_location_id: string | null;
  reason: string | null;
  actor_id: string | null;
  occurred_at: string;
};
export type ReportRow = {
  location_id: string;
  item_id: string;
  opening: number;
  received: number;
  transferred_in: number;
  transferred_out: number;
  issued: number;
  returned_in: number;
  returned_out: number;
  adjusted: number;
  closing: number;
  in_transit: number;
};

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

/** Items, locations (with display names) and active teams. */
export async function getStockContext(): Promise<{ items: StockItem[]; locations: StockLocation[]; teams: TeamChoice[] }> {
  const supabase = await client();
  const [items, locations, teams] = await Promise.all([
    supabase.from("stock_items").select("id, code, display_name").eq("is_active", true).order("sort_order"),
    supabase.from("stock_locations").select("id, kind, team_id"),
    supabase.from("teams").select("id, name, team_leader_id, is_active").order("name"),
  ]);
  const teamRows = (teams.data ?? []) as { id: string; name: string; team_leader_id: string | null; is_active: boolean }[];
  const teamById = Object.fromEntries(teamRows.map((tm) => [tm.id, tm]));
  const order = { central: 0, faulty: 1, team: 2 } as const;
  const locs = ((locations.data ?? []) as { id: string; kind: StockLocation["kind"]; team_id: string | null }[])
    .map((l) => ({
      ...l,
      label: l.kind === "central" ? t("stock.central") : l.kind === "faulty" ? t("stock.faulty") : teamById[l.team_id ?? ""]?.name ?? "—",
      leader_id: l.team_id ? teamById[l.team_id]?.team_leader_id ?? null : null,
    }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  return {
    items: (items.data ?? []) as StockItem[],
    locations: locs,
    teams: teamRows.filter((tm) => tm.is_active).map(({ id, name }) => ({ id, name })),
  };
}

export async function listTransfers(): Promise<TransferRow[]> {
  const { data } = await (await client())
    .from("stock_transfers")
    .select("id, to_location_id, status, note, sent_at, decided_at, lines:stock_transfer_lines(item_id, quantity)")
    .order("sent_at", { ascending: false })
    .limit(200);
  return (data ?? []) as TransferRow[];
}

export async function listAdjustments(): Promise<AdjustmentRow[]> {
  const { data } = await (await client())
    .from("stock_adjustments")
    .select("id, location_id, item_id, quantity_change, reason, status, requested_by, requested_at, decision_note")
    .order("requested_at", { ascending: false })
    .limit(200);
  return (data ?? []) as AdjustmentRow[];
}

export async function listMovements(): Promise<MovementRow[]> {
  const { data } = await (await client())
    .from("stock_movements")
    .select("id, movement_type, item_id, quantity, from_location_id, to_location_id, reason, actor_id, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(300);
  return (data ?? []) as MovementRow[];
}

export async function getReport(from: string, to: string): Promise<ReportRow[]> {
  const { data } = await (await client()).rpc("stock_report", { p_from: from, p_to: to });
  return (data ?? []) as ReportRow[];
}

/** Names of the people behind the rows (only those the caller may see; others stay unnamed). */
export async function namesOf(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return {};
  const { data } = await (await client()).from("user_profiles").select("id, full_name").in("id", unique);
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
}
