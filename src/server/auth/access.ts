import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Scope = "own" | "team" | "city" | "all";
export type Access = { roles: string[]; permissions: Record<string, Scope> };

const NO_ACCESS: Access = { roles: [], permissions: {} };

/** The signed-in user's roles and permission scopes (from public.my_access). Display only — the database enforces. */
export async function getAccess(supabase?: SupabaseClient | null): Promise<Access> {
  const client = supabase ?? (await createSupabaseServerClient());
  if (!client) return NO_ACCESS;
  const { data, error } = await client.rpc("my_access");
  if (error || !data) return NO_ACCESS;
  return data as Access;
}

export function can(access: Access, permission: string | string[]): boolean {
  const keys = Array.isArray(permission) ? permission : [permission];
  return keys.some((key) => key in access.permissions);
}
