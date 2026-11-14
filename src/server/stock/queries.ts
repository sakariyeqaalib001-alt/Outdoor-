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

type SupervisorRow = { team_id: string; team_name: string; location_id: string; supervisor_id: string | null; supervisor_name: string | null };

/** "Ahmed Ali (Group A)", or "Group A (no Outdoor Supervisor)" when the team has none. */
function supervisorLabel(s: SupervisorRow): string {
  return s.supervisor_name ? `${s.supervisor_name} (${s.team_name})` : `${s.team_name} (${t("stock.noSupervisorShort")})`;
}

/**
 * Items, locations with display names, and the Outdoor Supervisors stock can be issued to (owner, 22 Oct 2026:
 * stock goes to the Supervisor, i.e. the Team Leader of a team). Names come from public.stock_supervisors,
 * because the Stock Officer may not read the user list.
 */
export async function getStockContext(): Promise<{ items: StockItem[]; locations: StockLocation[]; teams: TeamChoice[]; supervisors: TeamChoice[] }> {
  const supabase = await client();
  const [items, locations, supervisors] = await Promise.all([
    supabase.from("stock_items").select("id, code, display_name").eq("is_active", true).order("sort_order"),
    supabase.from("stock_locations").select("id, kind, team_id"),
    supabase.rpc("stock_supervisors"),
  ]);
  const rows = (supervisors.data ?? []) as SupervisorRow[];
  const byTeam = Object.fromEntries(rows.map((s) => [s.team_id, s]));
  const order = { central: 0, faulty: 1, team: 2 } as const;
  const locs = ((locations.data ?? []) as { id: string; kind: StockLocation["kind"]; team_id: string | null }[])
    .filter((l) => l.kind !== "team" || byTeam[l.team_id ?? ""])
    .map((l) => ({
      ...l,
      label: l.kind === "central" ? t("stock.central") : l.kind === "faulty" ? t("stock.faulty") : supervisorLabel(byTeam[l.team_id ?? ""]),
      leader_id: l.team_id ? byTeam[l.team_id]?.supervisor_id ?? null : null,
    }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  return {
    items: (items.data ?? []) as StockItem[],
    locations: locs,
    teams: rows.map((s) => ({ id: s.team_id, name: supervisorLabel(s) })),
    supervisors: rows.filter((s) => s.supervisor_id).map((s) => ({ id: s.team_id, name: supervisorLabel(s) })),
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

/** Start and end (exclusive) of a business-date range in EAT (UTC+3, no daylight saving), as ISO instants. */
function rangeBounds(from: string, to: string): [string, string] {
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

/** Movements of the given types within the business-date range, oldest first (RLS limits the rows). */
export async function listMovementsBetween(from: string, to: string, types: string[]): Promise<MovementRow[]> {
  const [start, end] = rangeBounds(from, to);
  const { data } = await (await client())
    .from("stock_movements")
    .select("id, movement_type, item_id, quantity, from_location_id, to_location_id, reason, actor_id, occurred_at")
    .in("movement_type", types)
    .gte("occurred_at", start)
    .lt("occurred_at", end)
    .order("occurred_at", { ascending: true })
    .limit(2000);
  return (data ?? []) as MovementRow[];
}

/** Stock issued to Outdoor Supervisors within the business-date range, oldest first. */
export async function listTransfersBetween(from: string, to: string): Promise<TransferRow[]> {
  const [start, end] = rangeBounds(from, to);
  const { data } = await (await client())
    .from("stock_transfers")
    .select("id, to_location_id, status, note, sent_at, decided_at, lines:stock_transfer_lines(item_id, quantity)")
    .gte("sent_at", start)
    .lt("sent_at", end)
    .order("sent_at", { ascending: true })
    .limit(1000);
  return (data ?? []) as TransferRow[];
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
