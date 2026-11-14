"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t, type MessageKey } from "@/lib/i18n";
import { REFUND_REASONS } from "@/lib/refunds";
import { SALE_ERRORS } from "@/lib/sales";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendAlertEmailsLater } from "@/server/audit/actions";

/**
 * Refunds (Phase 12, BRD §6.5). Each runs AS the signed-in user through a database function that checks the
 * permission and scope (submit: refunds.submit; decide: Super Admin only, never one's own request; device return:
 * Stock Officer), so hiding a button is never the control.
 */
export type ActionResult = { ok?: true; error?: string; message?: string };

const uuid = z.string().uuid();

function dbError(message: string | undefined): string {
  const key = Object.keys(SALE_ERRORS).find((k) => message?.includes(k));
  return t(key ? SALE_ERRORS[key] : "users.errors.genericError");
}

function refresh(saleId?: string) {
  revalidatePath("/refunds");
  revalidatePath("/sales", "layout");
  revalidatePath("/stock", "layout");
  revalidatePath("/approvals");
  if (saleId) revalidatePath(`/sales/${saleId}`);
}

const submitSchema = z.object({
  client_request_id: uuid,
  sale_id: uuid,
  amount: z.number().positive().max(100000),
  reason: z.enum(REFUND_REASONS),
  note: z.string().trim().max(500),
});
export type RefundInput = z.infer<typeof submitSchema>;

export async function submitRefund(input: RefundInput): Promise<ActionResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  if (parsed.data.reason === "other" && parsed.data.note.length < 3) return { error: t("stock.errors.reason") };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc("create_refund", { p: { ...parsed.data, note: parsed.data.note || null } });
  if (error) return { error: dbError(error.message) };
  refresh(parsed.data.sale_id);
  return { ok: true, message: t("refunds.submitted") };
}

export async function decideRefund(id: string, approve: boolean, note: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { error: t("users.errors.checkFields") };
  const text = note.trim().slice(0, 500);
  if (!approve && text.length < 3) return { error: t("stock.errors.reason") };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc("decide_refund", { p_refund: id, p_approve: approve, p_note: text || null });
  if (error) return { error: dbError(error.message) };
  if (approve) await sendAlertEmailsLater(); // HIGH_REFUND_RATE alerts, when switched on
  refresh();
  return { ok: true, message: t((approve ? "refunds.approved" : "refunds.rejected") as MessageKey) };
}

const returnSchema = z.object({
  refundId: uuid,
  itemId: uuid,
  quantity: z.coerce.number().int().min(1).max(100),
});

/** Stock Officer: a device given on a refunded sale came back (form action for the Stock → Returns dialog). */
export async function recordRefundReturn(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = returnSchema.safeParse({ refundId: formData.get("refundId"), itemId: formData.get("itemId"), quantity: formData.get("quantity") });
  if (!parsed.success) return { error: t("stock.errors.quantity") };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc("refund_record_return", {
    p_refund: parsed.data.refundId,
    p_item: parsed.data.itemId,
    p_quantity: parsed.data.quantity,
    p_faulty: formData.get("faulty") === "true",
    p_note: note || null,
  });
  if (error) return { error: dbError(error.message) };
  refresh();
  return { ok: true, message: t("refunds.returned") };
}
