import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only queries for the Users screens. They run as the signed-in user, so RLS limits every row. */

export type City = { id: string; name: string };
export type Branch = { id: string; name: string; city_id: string };
export type Role = { key: string; name: string; description: string };
export type TeamOption = { id: string; name: string; city_id: string; team_leader_id: string | null; is_active: boolean };

export type UserRow = {
  id: string;
  full_name: string;
  employment_type: "temporary" | "permanent";
  login_phone_e164: string | null;
  email: string | null;
  is_active: boolean;
  must_change_password: boolean;
  start_date: string;
  end_date: string | null;
  city_id: string | null;
  roles: string[];
  team_id: string | null;
};

export type Lookups = { cities: City[]; branches: Branch[]; roles: Role[]; teams: TeamOption[] };

export async function getLookups(): Promise<Lookups> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { cities: [], branches: [], roles: [], teams: [] };
  const [cities, branches, roles, teams] = await Promise.all([
    supabase.from("cities").select("id, name").eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name, city_id").eq("is_active", true).order("name"),
    supabase.from("roles").select("key, name, description").order("sort_order"),
    supabase.from("teams").select("id, name, city_id, team_leader_id, is_active").order("name"),
  ]);
  return {
    cities: (cities.data ?? []) as City[],
    branches: (branches.data ?? []) as Branch[],
    roles: (roles.data ?? []) as Role[],
    teams: (teams.data ?? []) as TeamOption[],
  };
}

export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("user_profiles")
    .select(
      "id, full_name, employment_type, login_phone_e164, email, is_active, must_change_password, start_date, end_date, city_id, user_roles(role_key), team_members(team_id)"
    )
    .order("full_name");
  type Raw = Omit<UserRow, "roles" | "team_id"> & {
    user_roles: { role_key: string }[] | null;
    team_members: { team_id: string } | { team_id: string }[] | null;
  };
  return ((data ?? []) as Raw[]).map(({ user_roles, team_members, ...rest }) => {
    const membership = Array.isArray(team_members) ? team_members[0] : team_members;
    return { ...rest, roles: (user_roles ?? []).map((r) => r.role_key), team_id: membership?.team_id ?? null };
  });
}

export type MatrixData = {
  roles: Role[];
  permissions: { key: string; module: string; description: string }[];
  grants: Record<string, Record<string, string>>; // role -> permission -> scope
};

export async function getMatrix(): Promise<MatrixData> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { roles: [], permissions: [], grants: {} };
  const [roles, permissions, grants] = await Promise.all([
    supabase.from("roles").select("key, name, description").order("sort_order"),
    supabase.from("permissions").select("key, module, description").order("sort_order"),
    supabase.from("role_permissions").select("role_key, permission_key, scope"),
  ]);
  const map: Record<string, Record<string, string>> = {};
  for (const g of (grants.data ?? []) as { role_key: string; permission_key: string; scope: string }[]) {
    (map[g.role_key] ??= {})[g.permission_key] = g.scope;
  }
  return { roles: (roles.data ?? []) as Role[], permissions: permissions.data ?? [], grants: map };
}
