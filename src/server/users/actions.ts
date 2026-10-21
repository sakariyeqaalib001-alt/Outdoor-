"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { agentAuthEmail } from "@/lib/auth/identity";
import { temporaryPassword } from "@/lib/auth/temp-password";
import { t, type MessageKey } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * User administration (Phase 4, SDD §7, FR-USER-01…10). Every action checks the caller's permission
 * in the database first; profile, role and team changes run AS the caller through SECURITY DEFINER
 * functions that check again. The secret key is used only for Supabase Auth operations the database
 * cannot do: creating the sign-in account, setting a temporary password, and blocking sign-in (T-17).
 */
export type AdminResult = { ok?: true; error?: string; password?: string; message?: string } | undefined;

const DB_ERRORS: Record<string, MessageKey> = {
  "not allowed": "users.errors.notAllowed",
  TEAM_NOT_IN_CITY: "users.errors.teamNotInCity",
  ROLE_REQUIRED: "users.errors.roleRequired",
  UNKNOWN_ROLE: "users.errors.genericError",
  CANNOT_REMOVE_OWN_SUPER_ADMIN: "users.errors.ownSuperAdmin",
  LAST_SUPER_ADMIN: "users.errors.lastSuperAdmin",
  CANNOT_DEACTIVATE_SELF: "users.errors.deactivateSelf",
  LEADER_NEEDS_TEAM_LEADER_ROLE: "users.errors.leaderRole",
  SUPER_ADMIN_LOCKED: "users.errors.superAdminLocked",
  PHONE_REQUIRED: "users.errors.phoneRequired",
  PHONE_TAKEN: "users.errors.phoneTaken",
  USER_NOT_FOUND: "users.errors.genericError",
  TEAM_NOT_FOUND: "users.errors.genericError",
};

function dbError(message: string | undefined): string {
  const key = Object.keys(DB_ERRORS).find((k) => message?.includes(k));
  if (key) return t(DB_ERRORS[key]);
  if (message?.includes("duplicate key") && message.includes("teams_name")) return t("users.errors.teamNameTaken");
  return t("users.errors.genericError");
}

async function callerWith(permission: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") } as const;
  const { data: allowed } = await supabase.rpc("has_permission", { p_permission: permission });
  if (allowed !== true) return { error: t("users.errors.notAllowed") } as const;
  return { supabase } as const;
}

const uuid = z.string().uuid();
const optionalUuid = z.preprocess((v) => (v === "" || v === "none" ? null : v), z.string().uuid().nullable());
const userFields = {
  fullName: z.string().trim().min(2).max(120),
  cityId: uuid,
  teamId: optionalUuid,
  startDate: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  roles: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
};

function readUserForm(formData: FormData) {
  return {
    fullName: formData.get("fullName"),
    cityId: formData.get("cityId"),
    teamId: formData.get("teamId"),
    startDate: formData.get("startDate"),
    roles: formData.getAll("roles"),
  };
}

const createSchema = z.object({
  ...userFields,
  employmentType: z.enum(["temporary", "permanent"]),
  email: z.string().trim().toLowerCase().optional(),
  phone: z.string().trim().optional(),
});

export async function createUser(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  const caller = await callerWith("users.manage");
  if ("error" in caller) return { error: caller.error };

  const parsed = createSchema.safeParse({
    ...readUserForm(formData),
    employmentType: formData.get("employmentType"),
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
  });
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  const input = parsed.data;

  // D-32: everyone has a mobile number — the sign-in SMS code goes there.
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (!phone) return { error: t("users.errors.phoneRequired") };
  const metadata: Record<string, string> = { full_name: input.fullName, employment_type: input.employmentType, phone_e164: phone };
  let authEmail: string;
  if (input.employmentType === "permanent") {
    if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return { error: t("users.errors.emailRequired") };
    authEmail = input.email;
  } else {
    authEmail = agentAuthEmail(phone);
  }

  // Mobile numbers are unique per account type (the database enforces it; this gives a clear message).
  const { data: sameNumber } = await caller.supabase
    .from("user_profiles")
    .select("id")
    .eq("employment_type", input.employmentType)
    .eq("login_phone_e164", phone)
    .limit(1);
  if (sameNumber?.length) return { error: t("users.errors.phoneTaken") };

  const admin = createSupabaseAdminClient();
  if (!admin) return { error: t("auth.notConfigured") };

  const password = temporaryPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (createError || !created.user) {
    return { error: t(createError?.message?.toLowerCase().includes("already") ? "users.errors.alreadyExists" : "users.errors.genericError") };
  }

  const { error } = await caller.supabase.rpc("admin_update_user", {
    p_user: created.user.id,
    p_full_name: input.fullName,
    p_city: input.cityId,
    p_start_date: input.startDate,
    p_roles: input.roles,
    p_team: input.teamId,
  });
  revalidatePath("/users");
  if (error) return { error: `${t("users.createdButNotAssigned")} ${dbError(error.message)}`, password };
  return { ok: true, password, message: t("users.created") };
}

const updateSchema = z.object({ userId: uuid, ...userFields, phone: z.string().trim().min(1) });

export async function updateUser(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  const caller = await callerWith("users.manage");
  if ("error" in caller) return { error: caller.error };
  const parsed = updateSchema.safeParse({ ...readUserForm(formData), userId: formData.get("userId"), phone: formData.get("phone") });
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  const input = parsed.data;
  const phone = normalizePhone(input.phone);
  if (!phone) return { error: t("users.errors.phoneRequired") };

  const phoneError = await saveMobileNumber(caller.supabase, input.userId, phone);
  if (phoneError) return { error: phoneError };

  const { error } = await caller.supabase.rpc("admin_update_user", {
    p_user: input.userId,
    p_full_name: input.fullName,
    p_city: input.cityId,
    p_start_date: input.startDate,
    p_roles: input.roles,
    p_team: input.teamId,
  });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/users");
  return { ok: true, message: t("users.saved") };
}

/**
 * D-32: save the mobile number (database checks permission, format and uniqueness). A temporary agent
 * signs in with it, so their Supabase Auth sign-in address follows; if that fails, the number is put back.
 */
async function saveMobileNumber(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  phone: string
): Promise<string | null> {
  const { data: previous, error } = await supabase.rpc("admin_set_user_phone", { p_user: userId, p_phone: phone });
  if (error) return dbError(error.message);
  if (previous === phone) return null;

  const { data: profile } = await supabase.from("user_profiles").select("employment_type").eq("id", userId).single();
  if (profile?.employment_type !== "temporary") return null;

  const admin = createSupabaseAdminClient();
  const { error: authError } = admin
    ? await admin.auth.admin.updateUserById(userId, { email: agentAuthEmail(phone), email_confirm: true })
    : { error: new Error("not configured") };
  if (authError) {
    if (previous) await supabase.rpc("admin_set_user_phone", { p_user: userId, p_phone: previous });
    return t("users.errors.genericError");
  }
  return null;
}

export async function setUserActive(userId: string, active: boolean): Promise<AdminResult> {
  if (!uuid.safeParse(userId).success) return { error: t("users.errors.genericError") };
  const caller = await callerWith("users.disable");
  if ("error" in caller) return { error: caller.error };
  // 1) Database first: immediately blocks every query of that user through RLS (app.is_active_user).
  const { error } = await caller.supabase.rpc("admin_set_user_active", { p_user: userId, p_active: active });
  if (error) return { error: dbError(error.message) };
  // 2) Supabase Auth: block (or allow) new sign-ins and token refreshes.
  const admin = createSupabaseAdminClient();
  if (admin) await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  revalidatePath("/users");
  return { ok: true, message: t(active ? "users.reactivated" : "users.deactivated") };
}

export async function resetPassword(userId: string): Promise<AdminResult> {
  if (!uuid.safeParse(userId).success) return { error: t("users.errors.genericError") };
  const caller = await callerWith("users.manage");
  if ("error" in caller) return { error: caller.error };
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: t("auth.notConfigured") };
  const password = temporaryPassword();
  const { error: authError } = await admin.auth.admin.updateUserById(userId, { password });
  if (authError) return { error: t("users.errors.genericError") };
  const { error } = await caller.supabase.rpc("admin_require_password_change", { p_user: userId });
  if (error) return { error: dbError(error.message) };
  return { ok: true, password, message: t("users.passwordReset") };
}

const teamSchema = z.object({
  teamId: optionalUuid,
  name: z.string().trim().min(2).max(80),
  cityId: uuid,
  leaderId: optionalUuid,
  active: z.boolean(),
});

export async function saveTeam(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  const caller = await callerWith("teams.manage");
  if ("error" in caller) return { error: caller.error };
  const parsed = teamSchema.safeParse({
    teamId: formData.get("teamId") ?? null,
    name: formData.get("name"),
    cityId: formData.get("cityId"),
    leaderId: formData.get("leaderId"),
    active: formData.get("active") !== "false",
  });
  if (!parsed.success) return { error: t("users.errors.checkFields") };
  const input = parsed.data;
  const { error } = await caller.supabase.rpc("admin_save_team", {
    p_id: input.teamId,
    p_name: input.name,
    p_city: input.cityId,
    p_leader: input.leaderId,
    p_active: input.active,
  });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/users/teams");
  return { ok: true, message: t("users.teamSaved") };
}

const SCOPES = ["own", "team", "city", "all"] as const;

export async function setRolePermission(role: string, permission: string, scope: string | null): Promise<AdminResult> {
  if (!/^[a-z_]+$/.test(role) || !/^[a-z]+(\.[a-z_]+)+$/.test(permission)) {
    return { error: t("users.errors.genericError") };
  }
  if (scope !== null && !SCOPES.includes(scope as (typeof SCOPES)[number])) return { error: t("users.errors.genericError") };
  const caller = await callerWith("roles.manage");
  if ("error" in caller) return { error: caller.error };
  const { error } = await caller.supabase.rpc("admin_set_role_permission", {
    p_role: role,
    p_permission: permission,
    p_scope: scope,
  });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/users/roles");
  return { ok: true };
}
