import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client for Server Components and Server Actions, acting AS the signed-in user
 * (publishable key + the user's session cookie), so Row Level Security applies to every query.
 */
export async function createSupabaseServerClient() {
  // Per-request data: tell Next.js before the Supabase client reads the clock (Cache Components rule).
  await connection();
  const env = getSupabasePublicEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes them.
        }
      },
    },
  });
}
