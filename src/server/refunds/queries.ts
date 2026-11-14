import "server-only";
import type { RefundReason, RefundStatus } from "@/lib/refunds";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only queries for refunds (Phase 12). RLS limits every row to what the caller may see. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export type RefundRow = {
  id: string;
  sale_id: string;
  agent_id: string;
  customer_name: string;
  product: string;
  branch: string;
  amount: number;
  amount_collected: number;
  reason: RefundReason;
  note: string | null;
  status: RefundStatus;
  requested_by: string;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  counting_month: string | null;
  payroll_effect: "excluded" | "adjustment" | null;
  requester: string;
  agent: string;
  decider: string | null;
  equipment: { item: string; given: number; returned: number }[];
};

const COLUMNS = `id, sale_id, agent_id, customer_name, amount, amount_collected, reason, note, status, requested_by, requested_at,
  decided_by, decided_at, decision_note, counting_month, payroll_effect, products(code), branches(name)`;

type Raw = Omit<RefundRow, "product" | "branch" | "requester" | "agent" | "decider" | "equipment" | "amount" | "amount_collected"> & {
  amount: string | number;
  amount_collected: string | number;
  decided_by: string | null;
  products: { code: string };
  branches: { name: string };
};

async function enrich(rows: Raw[]): Promise<RefundRow[]> {
  if (rows.length === 0) return [];
  const supabase = await client();
  const people = [...new Set(rows.flatMap((r) => [r.requested_by, r.agent_id, r.decided_by]).filter((x): x is string => !!x))];
  const [names, equipment] = await Promise.all([
    supabase.from("user_profiles").select("id, full_name").in("id", people),
    supabase.rpc("refund_equipment", { p_refunds: rows.map((r) => r.id) }),
  ]);
  if (equipment.error) console.error(`[refunds] equipment query failed: ${equipment.error.message}`);
  const name = Object.fromEntries(((names.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const items: Record<string, RefundRow["equipment"]> = {};
  for (const e of (equipment.data ?? []) as { refund_id: string; item: string; given: number; returned: number }[]) {
    (items[e.refund_id] ??= []).push({ item: e.item, given: e.given, returned: e.returned });
  }
  return rows.map((r) => ({
    id: r.id, sale_id: r.sale_id, agent_id: r.agent_id, customer_name: r.customer_name, product: r.products.code, branch: r.branches.name,
    amount: Number(r.amount), amount_collected: Number(r.amount_collected), reason: r.reason, note: r.note, status: r.status,
    requested_by: r.requested_by, requested_at: r.requested_at, decided_at: r.decided_at, decision_note: r.decision_note,
    counting_month: r.counting_month, payroll_effect: r.payroll_effect,
    requester: name[r.requested_by] ?? "—", agent: name[r.agent_id] ?? "—", decider: r.decided_by ? name[r.decided_by] ?? "—" : null,
    equipment: items[r.id] ?? [],
  }));
}

/** Waiting refunds (oldest first) and the latest 200 decided ones. */
export async function listRefunds(): Promise<{ waiting: RefundRow[]; decided: RefundRow[] }> {
  const supabase = await client();
  const [waiting, decided] = await Promise.all([
    supabase.from("refunds").select(COLUMNS).eq("status", "pending").order("requested_at"),
    supabase.from("refunds").select(COLUMNS).neq("status", "pending").order("decided_at", { ascending: false }).limit(200),
  ]);
  for (const [n, r] of Object.entries({ waiting, decided })) if (r.error) console.error(`[refunds] ${n} query failed: ${r.error.message}`);
  const [w, d] = await Promise.all([enrich((waiting.data ?? []) as unknown as Raw[]), enrich((decided.data ?? []) as unknown as Raw[])]);
  return { waiting: w, decided: d };
}

/** Every refund request of one sale (newest first). */
export async function saleRefunds(saleId: string): Promise<RefundRow[]> {
  const { data } = await (await client()).from("refunds").select(COLUMNS).eq("sale_id", saleId).order("requested_at", { ascending: false });
  return enrich((data ?? []) as unknown as Raw[]);
}

/** Number of refunds waiting (Super Admin: all of them). */
export async function waitingRefundCount(): Promise<number> {
  const { count } = await (await client()).from("refunds").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count ?? 0;
}

export type CollectRow = { refund_id: string; decided_at: string; customer_name: string; team: string | null; agent: string | null; item_id: string; item: string; given: number; returned: number };

/** Stock Officer: approved refunds whose devices have not all come back. */
export async function refundsToCollect(): Promise<CollectRow[]> {
  const { data, error } = await (await client()).rpc("refunds_to_collect");
  if (error) {
    console.error(`[refunds] to-collect query failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as CollectRow[];
}
