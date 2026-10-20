/**
 * Supabase connection settings from environment variables (.env.local on the owner's computer;
 * host settings later). Never hard-code values. The publishable key is safe for the browser;
 * the secret key is server-only (see ./admin.ts).
 */
export type SupabasePublicEnv = { url: string; publishableKey: string };

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
