import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appLink, EmailNotConfiguredError, emailText, getEmailProvider } from "./provider";

const BATCH = 20;
const MAX_ATTEMPTS = 5;

type Row = { id: string; to_email: string; subject: string; body: string; link_path: string; attempts: number };

/**
 * Send waiting audit-alert emails from public.email_outbox (T-25). Runs on the server with the secret key,
 * after the user's action has finished (next/server `after`) or from the Audit screen. Each row is claimed
 * (pending → sending) before sending so two runs never send the same email. Failures keep a safe summary
 * (HTTP status only) and are retried up to 5 times; nothing personal is logged.
 */
export async function deliverPendingEmails(): Promise<{ sent: number; failed: number; configured: boolean }> {
  let provider;
  try {
    provider = getEmailProvider();
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) return { sent: 0, failed: 0, configured: false };
    throw e;
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return { sent: 0, failed: 0, configured: false };

  const { data, error } = await admin
    .from("email_outbox")
    .select("id, to_email, subject, body, link_path, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(BATCH);
  if (error) {
    console.error(`[email] queue read failed: ${error.message}`);
    return { sent: 0, failed: 0, configured: true };
  }

  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as Row[]) {
    const { data: claimed } = await admin
      .from("email_outbox")
      .update({ status: "sending", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("id");
    if (!claimed?.length) continue;
    try {
      await provider.send({ to: row.to_email, subject: row.subject, text: emailText(row.body, appLink(row.link_path)) });
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      sent++;
    } catch (e) {
      const summary = (e instanceof Error ? e.message : "send failed").slice(0, 300);
      await admin.from("email_outbox").update({ status: "failed", last_error: summary }).eq("id", row.id);
      console.error(`[email] send failed (${provider.name}): ${summary}`);
      failed++;
    }
  }
  return { sent, failed, configured: true };
}
