import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionStatus = "ok" | "inactive" | "change_password" | "otp_required" | "no_profile";

export type SessionInfo = {
  status: SessionStatus;
  full_name?: string;
  employment_type?: "temporary" | "permanent";
  phone_hint?: string | null;
};

/** Where must the signed-in user go next? Decided in the database (public.my_session_status). */
export async function getSessionInfo(supabase: SupabaseClient): Promise<SessionInfo | null> {
  const { data, error } = await supabase.rpc("my_session_status");
  if (error || !data) return null;
  return data as SessionInfo;
}

/** The current sign-in session id (JWT claim) — OTP is bound to it. */
export async function getSessionId(supabase: SupabaseClient): Promise<{ userId: string; sessionId: string } | null> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; session_id?: string } | undefined;
  if (!claims?.sub || !claims.session_id) return null;
  return { userId: claims.sub, sessionId: claims.session_id };
}

export const ROUTE_FOR_STATUS: Record<SessionStatus, string> = {
  ok: "/",
  change_password: "/change-password",
  otp_required: "/verify",
  inactive: "/login?error=inactive",
  no_profile: "/login?error=inactive",
};
