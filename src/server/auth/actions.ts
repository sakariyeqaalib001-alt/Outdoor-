"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { parseIdentifier } from "@/lib/auth/identity";
import { checkNewPassword } from "@/lib/auth/password-policy";
import { t, type MessageKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendOtp, type SendOtpResult } from "./otp";
import { getSessionId, getSessionInfo, ROUTE_FOR_STATUS } from "./session";

export type FormState = { error?: string; notice?: string } | undefined;

const message = (key: MessageKey) => t(key);

const OTP_SEND_MESSAGES: Record<Exclude<SendOtpResult, "sent">, MessageKey> = {
  rate_limited: "auth.otpRateLimited",
  not_configured: "auth.smsNotConfigured",
  no_phone: "auth.smsNoPhone",
  failed: "auth.smsFailed",
};

/** After sign-in or password change: send the OTP if needed, then go where the status says. */
async function continueAfterAuth(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>): Promise<FormState> {
  const info = await getSessionInfo(supabase);
  if (!info || info.status === "inactive" || info.status === "no_profile") {
    await supabase.auth.signOut();
    return { error: message("auth.inactive") };
  }
  if (info.status === "otp_required") {
    const ids = await getSessionId(supabase);
    if (!ids) return { error: message("auth.genericError") };
    const sent = await sendOtp(ids.userId, ids.sessionId);
    // Always continue to the code screen; if the SMS failed, it explains why and offers "Send a new code".
    if (sent !== "sent") redirect(`/verify?sms=${sent}`);
  }
  redirect(ROUTE_FOR_STATUS[info.status]);
}

const signInSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ identifier: formData.get("identifier"), password: formData.get("password") });
  const identifier = parsed.success ? parseIdentifier(parsed.data.identifier) : null;
  if (!parsed.success || !identifier) return { error: message("auth.invalidCredentials") };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: message("auth.notConfigured") };

  const { data: lockedUntil } = await supabase.rpc("auth_lockout_until", { p_identifier: identifier.key });
  if (lockedUntil) return { error: message("auth.locked") };

  const { error } = await supabase.auth.signInWithPassword({
    email: identifier.authEmail,
    password: parsed.data.password,
  });
  if (error) {
    const { data: nowLocked } = await supabase.rpc("auth_record_failure", { p_identifier: identifier.key });
    return { error: message(nowLocked ? "auth.locked" : "auth.invalidCredentials") };
  }

  await supabase.rpc("auth_record_success");
  return continueAfterAuth(supabase);
}

export async function verifyOtp(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: message("auth.otpInvalid") };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: message("auth.notConfigured") };

  const { data: result, error } = await supabase.rpc("verify_otp", { p_code: code });
  if (error) return { error: message("auth.genericError") };
  switch (result) {
    case "ok":
      redirect("/");
    case "invalid":
      return { error: message("auth.otpInvalid") };
    case "expired":
      return { error: message("auth.otpExpired") };
    case "too_many_attempts":
      return { error: message("auth.otpTooManyAttempts") };
    default:
      return { error: message("auth.otpNoChallenge") };
  }
}

export async function resendOtp(): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: message("auth.notConfigured") };
  const info = await getSessionInfo(supabase);
  const ids = await getSessionId(supabase);
  if (!info || info.status !== "otp_required" || !ids) return { error: message("auth.genericError") };
  const sent = await sendOtp(ids.userId, ids.sessionId);
  if (sent === "sent") return { notice: message("auth.otpResent") };
  return { error: message(OTP_SEND_MESSAGES[sent]) };
}

const PASSWORD_MESSAGES: Record<NonNullable<ReturnType<typeof checkNewPassword>>, MessageKey> = {
  too_short: "auth.passwordTooShort",
  needs_letter: "auth.passwordNeedsLetter",
  needs_digit: "auth.passwordNeedsDigit",
  mismatch: "auth.passwordMismatch",
};

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = checkNewPassword(password, confirm);
  if (problem) return { error: message(PASSWORD_MESSAGES[problem]) };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: message("auth.notConfigured") };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: message(error.code === "same_password" ? "auth.passwordSameAsOld" : "auth.passwordRejected") };
  }
  const { error: markError } = await supabase.rpc("mark_password_changed");
  if (markError) return { error: message("auth.genericError") };
  return continueAfterAuth(supabase);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
