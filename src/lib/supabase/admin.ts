import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

/**
 * Server-only Supabase client with the SECRET key (bypasses RLS). Allowed uses only (T-17):
 *  - issuing an SMS OTP and recording its delivery (src/server/auth/otp.ts),
 *  - reading the phone number to send the OTP to,
 *  - user administration after a permission check (T-23),
 *  - sending queued audit-alert emails and recording the result (src/server/email/deliver.ts, T-25).
 * Never import this from a Client Component; never use it to act on behalf of a user's request.
 */
export function createSupabaseAdminClient() {
  const env = getSupabasePublicEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!env || !secretKey) return null;
  return createClient(env.url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
