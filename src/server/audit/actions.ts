"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { AUDIT_ERRORS, CASE_STATUSES, RULE_CODES } from "@/lib/audit";
import { t } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, getAccess } from "@/server/auth/access";
import { deliverPendingEmails } from "@/server/email/deliver";

/**
 * Audit cases and rules (Phase 9). Each runs AS the signed-in user through a database function that checks
 * who may act (Super Admin, or the Auditor assigned to the case) and writes the history. Waiting alert emails
 * are sent after the response (T-25).
 */
export type ActionResult = { ok?: true; error?: string; message?: string; id?: string };

const uuid = z.string().uuid();
const note = z.string().trim().min(3).max(1000);

function dbError(message: string | undefined): string {
  const key = Object.keys(AUDIT_ERRORS).find((k) => message?.includes(k));
  return t(key ? AUDIT_ERRORS[key] : "users.errors.genericError");
}

/** Send waiting alert emails once the response is finished (never blocks or fails the user's action). */
export async function sendAlertEmailsLater(): Promise<void> {
  after(async () => {
    try {
      await deliverPendingEmails();
    } catch (e) {
      console.error(`[email] delivery run failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  });
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>, message: Parameters<typeof t>[0]): Promise<ActionResult & { data?: T }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: dbError(error.message) };
  revalidatePath("/audit", "layout");
  await sendAlertEmailsLater();
  return { ok: true, message: t(message), data: data as T };
}

export async function setCaseStatus(caseId: string, status: string, text: string): Promise<ActionResult> {
  const parsed = z.object({ caseId: uuid, status: z.enum(CASE_STATUSES), note }).safeParse({ caseId, status, note: text });
  if (!parsed.success) return { error: t(text.trim().length < 3 ? "audit.errors.note" : "users.errors.checkFields") };
  return rpc("audit_case_set_status", { p_case: caseId, p_status: status, p_note: parsed.data.note }, "audit.saved");
}

export async function addCaseNote(caseId: string, text: string): Promise<ActionResult> {
  const parsed = z.object({ caseId: uuid, note }).safeParse({ caseId, note: text });
  if (!parsed.success) return { error: t("audit.errors.note") };
  return rpc("audit_case_add_note", { p_case: caseId, p_note: parsed.data.note }, "audit.noteAdded");
}

export async function assignCase(caseId: string, userId: string | null, text: string): Promise<ActionResult> {
  const parsed = z.object({ caseId: uuid, userId: uuid.nullable(), note: z.string().trim().max(1000) }).safeParse({ caseId, userId, note: text });
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  return rpc("audit_case_assign", { p_case: caseId, p_user: userId, p_note: parsed.data.note || null }, "audit.assignedSaved");
}

export async function createCase(title: string, text: string, saleId: string | null): Promise<ActionResult> {
  const parsed = z.object({ title: z.string().trim().min(3).max(200), note, saleId: uuid.nullable() }).safeParse({ title, note: text, saleId });
  if (!parsed.success) return { error: t(title.trim().length < 3 ? "audit.errors.title" : "audit.errors.note") };
  const r = await rpc<string>("audit_case_create", { p_title: parsed.data.title, p_note: parsed.data.note, p_sale: saleId }, "audit.caseCreated");
  if (saleId) revalidatePath(`/sales/${saleId}`);
  return { ok: r.ok, error: r.error, message: r.message, id: r.data };
}

export async function updateRule(code: string, enabled: boolean, threshold: Record<string, number>): Promise<ActionResult> {
  const parsed = z
    .object({ code: z.enum(RULE_CODES), enabled: z.boolean(), threshold: z.record(z.string(), z.number().int().min(0).max(100000)) })
    .safeParse({ code, enabled, threshold });
  if (!parsed.success) return { error: t("audit.errors.threshold") };
  return rpc("audit_rule_update", { p_code: code, p_enabled: enabled, p_threshold: parsed.data.threshold }, "audit.ruleSaved");
}

/** Super Admin: send waiting alert emails now and report the result. */
export async function sendEmailsNow(): Promise<ActionResult> {
  const access = await getAccess();
  if (!can(access, "audit.manage") || access.permissions["audit.manage"] !== "all") return { error: t("audit.errors.forbidden") };
  const r = await deliverPendingEmails();
  revalidatePath("/audit", "layout");
  if (!r.configured) return { error: t("audit.email.notConfigured") };
  return { ok: true, message: t("audit.email.sentResult", { sent: String(r.sent), failed: String(r.failed) }) };
}
