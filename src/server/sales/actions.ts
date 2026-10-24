"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t } from "@/lib/i18n";
import { duplicateMessage, MONTHS_PAID_MAX, SALE_ERRORS } from "@/lib/sales";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sales registration (Phase 7). The form's values go to public.create_sale, which runs AS the signed-in
 * user and does every check again (permission, identity, same month, price, stock). The agent and the
 * date are never taken from the form (FR-SALE-09, D-30).
 */
export type SubmitResult =
  | { ok: true; saleId: string; saleMonth: string; saleStatus: string; existing: boolean }
  | { ok: false; error: string; duplicate?: boolean };

const uuid = z.string().uuid();
const saleSchema = z.object({
  client_request_id: uuid,
  customer_type: z.enum(["new", "retention"]),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(25),
  index: z.string().trim().max(20),
  city_id: uuid.nullable(),
  district_id: uuid,
  area: z.string().trim().min(1).max(100),
  branch_id: uuid,
  plan_id: uuid,
  months_paid: z.number().int().min(1).max(MONTHS_PAID_MAX),
  free_month: z.boolean(),
  items: z.array(z.object({ item_id: uuid, quantity: z.number().int().min(1).max(100) })).max(20),
});
export type SaleInput = z.infer<typeof saleSchema>;

function dbError(message: string | undefined): string {
  const key = Object.keys(SALE_ERRORS).find((k) => message?.includes(k));
  return t(key ? SALE_ERRORS[key] : "users.errors.genericError");
}

export async function submitSale(input: SaleInput): Promise<SubmitResult> {
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("users.errors.checkFields") };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: t("auth.notConfigured") };

  const { data, error } = await supabase.rpc("create_sale", { p: parsed.data });
  if (error) return { ok: false, error: dbError(error.message) };
  const result = data as { status: string; sale_id?: string; sale_month?: string; sale_status?: string; existing?: boolean; rule?: string; field?: string };
  if (result.status === "duplicate") {
    return { ok: false, duplicate: true, error: t(duplicateMessage(result.rule ?? "", result.field ?? "")) };
  }
  revalidatePath("/sales");
  return { ok: true, saleId: result.sale_id!, saleMonth: result.sale_month!, saleStatus: result.sale_status!, existing: Boolean(result.existing) };
}

export type IdentityResult = { ok?: true; error?: string; message?: string } | undefined;

/** Super Admin: change a customer's phone or Index with a reason (FR-SALE-16). */
export async function changeIdentifier(_prev: IdentityResult, formData: FormData): Promise<IdentityResult> {
  const parsed = z
    .object({ customerId: uuid, kind: z.enum(["phone", "index"]), value: z.string().trim().min(1).max(25), reason: z.string().trim().min(3).max(500) })
    .safeParse({ customerId: formData.get("customerId"), kind: formData.get("kind"), value: formData.get("value"), reason: formData.get("reason") });
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const p = parsed.data;
  const { error } = await supabase.rpc("change_customer_identifier", { p_customer: p.customerId, p_kind: p.kind, p_value: p.value, p_reason: p.reason });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/customers");
  return { ok: true, message: t("sales.identityChanged") };
}
