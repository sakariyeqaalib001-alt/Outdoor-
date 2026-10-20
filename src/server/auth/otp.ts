import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSmsProvider, SmsNotConfiguredError } from "@/server/sms/provider";

export type SendOtpResult = "sent" | "rate_limited" | "not_configured" | "failed";

/**
 * Issue a new OTP for this sign-in session and deliver it by SMS (T-15, T-17).
 * The plain code exists only in memory here; the database keeps a hash.
 */
export async function sendOtp(userId: string, sessionId: string): Promise<SendOtpResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return "not_configured";

  let provider;
  try {
    provider = getSmsProvider();
  } catch (error) {
    if (error instanceof SmsNotConfiguredError) return "not_configured";
    throw error;
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("login_phone_e164")
    .eq("id", userId)
    .single();
  if (!profile?.login_phone_e164) return "failed";

  const { data, error } = await admin
    .rpc("issue_otp_challenge", { p_user_id: userId, p_session_id: sessionId })
    .single<{ challenge_id: string; code: string; expires_at: string }>();
  if (error) return error.message.includes("OTP_RATE_LIMIT") ? "rate_limited" : "failed";

  try {
    const { providerMessageId } = await provider.sendOtp(profile.login_phone_e164, data.code);
    await admin.rpc("record_otp_delivery", {
      p_challenge_id: data.challenge_id,
      p_sent: true,
      p_provider_message_id: providerMessageId,
    });
    return "sent";
  } catch (error) {
    await admin.rpc("record_otp_delivery", { p_challenge_id: data.challenge_id, p_sent: false });
    // Safe diagnostic: provider + reason only (never the code, phone number or credentials).
    console.error(`[sms:${provider.name}] OTP delivery failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return error instanceof SmsNotConfiguredError ? "not_configured" : "failed";
  }
}
