"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t } from "@/lib/i18n";
import { SALE_ERRORS } from "@/lib/sales";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Approvals and product switches (Phase 8, D-37, D-38). Each runs AS the signed-in user through a database
 * function that checks who may decide (Team Leader of the team, Super Admin fallback, never one's own),
 * deducts equipment from the team stock and records the decision.
 */
export type ActionResult = { ok?: true; error?: string; message?: string };

const uuid = z.string().uuid();
const itemsSchema = z.array(z.object({ item_id: uuid, quantity: z.number().int().min(1).max(100) })).max(20);

function dbError(message: string | undefined): string {
  const key = Object.keys(SALE_ERRORS).find((k) => message?.includes(k));
  return t(key ? SALE_ERRORS[key] : "users.errors.genericError");
}

async function rpc(fn: string, args: Record<string, unknown>, message: Parameters<typeof t>[0]): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: dbError(error.message) };
  revalidatePath("/approvals");
  revalidatePath("/sales", "layout");
  revalidatePath("/switches");
  return { ok: true, message: t(message) };
}

export async function decide(kind: "sale" | "switch", id: string, approve: boolean, items: unknown, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { error: t("users.errors.checkFields") };
  if (approve) {
    const parsed = itemsSchema.safeParse(items);
    if (!parsed.success) return { error: t("stock.errors.quantity") };
    return kind === "sale"
      ? rpc("approve_sale", { p_sale: id, p_items: parsed.data }, "approvals.approved")
      : rpc("approve_switch", { p_switch: id, p_items: parsed.data }, "approvals.approved");
  }
  const text = reason.trim().slice(0, 500);
  if (text.length < 3) return { error: t("stock.errors.reason") };
  return kind === "sale"
    ? rpc("reject_sale", { p_sale: id, p_reason: text }, "approvals.rejected")
    : rpc("reject_switch", { p_switch: id, p_reason: text }, "approvals.rejected");
}

const switchSchema = z.object({
  client_request_id: uuid,
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(25),
  index: z.string().trim().max(20),
  from_product_id: uuid,
  to_product_id: uuid,
  to_plan_id: uuid,
  city_id: uuid.nullable(),
  branch_id: uuid,
});
export type SwitchInput = z.infer<typeof switchSchema>;

const MISMATCH = {
  phone_or_index: "switches.mismatch.identity",
  name: "switches.mismatch.name",
  product: "switches.mismatch.product",
} as const;

export async function submitSwitch(input: SwitchInput): Promise<ActionResult & { switchId?: string }> {
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { data, error } = await supabase.rpc("create_switch", { p: parsed.data });
  if (error) return { error: dbError(error.message) };
  const result = data as { status: string; switch_id?: string; field?: keyof typeof MISMATCH };
  if (result.status === "mismatch") return { error: t(MISMATCH[result.field ?? "phone_or_index"] ?? MISMATCH.phone_or_index) };
  revalidatePath("/switches");
  return { ok: true, switchId: result.switch_id, message: t("switches.saved") };
}

export async function markAllRead(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.rpc("mark_notifications_read", { p_ids: null });
  revalidatePath("/notifications");
}
