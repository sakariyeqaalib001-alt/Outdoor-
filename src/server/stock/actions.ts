"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t, type MessageKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Stock operations (Phase 6, SDD §12, D-35). Each runs AS the signed-in user through a database function
 * that checks the permission (stock.receive / stock.transfer / stock.acknowledge / stock.adjust.*),
 * refuses negative balances and writes the append-only ledger. No secret key is used.
 */
export type StockResult = { ok?: true; error?: string; message?: string } | undefined;

const DB_ERRORS: Record<string, MessageKey> = {
  "not allowed": "users.errors.notAllowed",
  INSUFFICIENT_STOCK: "stock.errors.insufficient",
  INVALID_QUANTITY: "stock.errors.quantity",
  INVALID_LINES: "stock.errors.noLines",
  DUPLICATE_ITEM: "stock.errors.duplicate",
  UNKNOWN_ITEM: "stock.errors.unknownItem",
  TEAM_NOT_FOUND: "stock.errors.team",
  ALREADY_DECIDED: "stock.errors.alreadyDecided",
  REASON_REQUIRED: "stock.errors.reason",
  SELF_APPROVAL: "stock.errors.selfApproval",
};

function dbError(message: string | undefined): string {
  const key = Object.keys(DB_ERRORS).find((k) => message?.includes(k));
  return t(key ? DB_ERRORS[key] : "users.errors.genericError");
}

async function rpc(fn: string, args: Record<string, unknown>, message: MessageKey): Promise<StockResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: dbError(error.message) };
  revalidatePath("/stock", "layout");
  return { ok: true, message: t(message) };
}

const uuid = z.string().uuid();
const checkFields = { error: t("users.errors.checkFields") };

/** Form fields "qty_<itemId>" → [{ item_id, quantity }] for the items with a quantity above 0. */
function readLines(formData: FormData): { item_id: string; quantity: number }[] | null {
  const out: { item_id: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const raw = String(value).trim();
    if (raw === "" || raw === "0") continue;
    if (!/^\d{1,6}$/.test(raw) || !uuid.safeParse(key.slice(4)).success) return null;
    out.push({ item_id: key.slice(4), quantity: Number(raw) });
  }
  return out;
}

const note = (formData: FormData) => String(formData.get("note") ?? "").trim().slice(0, 500) || null;

export async function receiveStock(_prev: StockResult, formData: FormData): Promise<StockResult> {
  const lines = readLines(formData);
  if (!lines) return { error: t("stock.errors.quantity") };
  if (lines.length === 0) return { error: t("stock.errors.noLines") };
  return rpc("stock_receive", { p_lines: lines, p_note: note(formData) }, "stock.receivedOk");
}

export async function sendStock(_prev: StockResult, formData: FormData): Promise<StockResult> {
  const team = uuid.safeParse(formData.get("teamId"));
  const lines = readLines(formData);
  if (!team.success) return checkFields;
  if (!lines) return { error: t("stock.errors.quantity") };
  if (lines.length === 0) return { error: t("stock.errors.noLines") };
  return rpc("stock_send", { p_team: team.data, p_lines: lines, p_note: note(formData) }, "stock.sent");
}

export async function acceptTransfer(id: string): Promise<StockResult> {
  if (!uuid.safeParse(id).success) return checkFields;
  return rpc("stock_accept", { p_transfer: id }, "stock.accepted");
}

export async function cancelTransfer(id: string, reason: string): Promise<StockResult> {
  if (!uuid.safeParse(id).success) return checkFields;
  return rpc("stock_cancel", { p_transfer: id, p_reason: reason.trim().slice(0, 500) }, "stock.cancelled");
}

const returnSchema = z.object({
  teamId: z.preprocess((v) => (v === "customer" || v === "" ? null : v), uuid.nullable()),
  itemId: uuid,
  quantity: z.coerce.number().int().min(1).max(100000),
  reason: z.enum(["faulty", "refund", "switch", "retention_rejected", "other"]),
});

export async function recordReturn(_prev: StockResult, formData: FormData): Promise<StockResult> {
  const parsed = returnSchema.safeParse({
    teamId: formData.get("teamId"),
    itemId: formData.get("itemId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return checkFields;
  const p = parsed.data;
  return rpc(
    "stock_return",
    { p_team: p.teamId, p_item: p.itemId, p_quantity: p.quantity, p_reason_code: p.reason, p_note: note(formData), p_faulty: formData.get("faulty") === "true" },
    "stock.returned"
  );
}

const adjustmentSchema = z.object({
  locationId: uuid,
  itemId: uuid,
  change: z.coerce.number().int().min(-100000).max(100000).refine((n) => n !== 0),
  reason: z.string().trim().min(3).max(500),
});

export async function requestAdjustment(_prev: StockResult, formData: FormData): Promise<StockResult> {
  const parsed = adjustmentSchema.safeParse({
    locationId: formData.get("locationId"),
    itemId: formData.get("itemId"),
    change: formData.get("change"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return checkFields;
  const p = parsed.data;
  return rpc("stock_request_adjustment", { p_location: p.locationId, p_item: p.itemId, p_change: p.change, p_reason: p.reason }, "stock.adjustmentRequested");
}

export async function decideAdjustment(id: string, approve: boolean, decisionNote: string): Promise<StockResult> {
  if (!uuid.safeParse(id).success) return checkFields;
  return rpc(
    "stock_decide_adjustment",
    { p_id: id, p_approve: approve, p_note: decisionNote.trim().slice(0, 500) || null },
    approve ? "stock.adjustmentApproved" : "stock.adjustmentRejected"
  );
}
