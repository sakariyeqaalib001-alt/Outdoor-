"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t, type MessageKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSettingInput, SETTING_KEYS, type SettingKey } from "@/lib/settings";

/**
 * Settings and master data (Phase 5, SDD §9). Every change runs AS the signed-in user through a
 * SECURITY DEFINER function that checks settings.manage / prices.manage, validates and logs it.
 * No secret key is used here.
 */
export type SettingsResult = { ok?: true; error?: string; message?: string } | undefined;

const DB_ERRORS: Record<string, MessageKey> = {
  "not allowed": "users.errors.notAllowed",
  NAME_TAKEN: "settings.errors.nameTaken",
  DATE_TAKEN: "settings.errors.dateTaken",
  INVALID_SETTING: "settings.errors.invalidValue",
  BAND_ORDER: "settings.errors.bandOrder",
  PRICE_OVERLAP: "settings.errors.priceOverlap",
  PRODUCT_INACTIVE: "settings.errors.productInactive",
  PLAN_INACTIVE: "settings.errors.planInactive",
  INVALID_PLAN: "settings.errors.invalidPlan",
  INVALID_PRICE: "settings.errors.invalidPrice",
  INVALID_DATES: "settings.errors.invalidDates",
};

function dbError(message: string | undefined): string {
  const key = Object.keys(DB_ERRORS).find((k) => message?.includes(k));
  return t(key ? DB_ERRORS[key] : "users.errors.genericError");
}

async function rpc(fn: string, args: Record<string, unknown>, paths: string[]): Promise<SettingsResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: t("auth.notConfigured") };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: dbError(error.message) };
  for (const path of paths) revalidatePath(path);
  return { ok: true, message: t("settings.saved") };
}

const uuid = z.string().uuid();
const optionalUuid = z.preprocess((v) => (v === "" || v === "all" || v == null ? null : v), z.string().uuid().nullable());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = z.preprocess((v) => (v === "" || v == null ? null : v), date.nullable());
const name = z.string().trim().min(2).max(80);
const active = (formData: FormData) => formData.get("active") === "true";
const checkFields = { error: t("users.errors.checkFields") };

export async function saveSetting(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const key = String(formData.get("key") ?? "");
  if (!SETTING_KEYS.includes(key as SettingKey)) return checkFields;
  const value = parseSettingInput(key as SettingKey, formData);
  if (value === undefined) return { error: t("settings.errors.invalidValue") };
  return rpc("admin_set_setting", { p_key: key, p_value: value }, ["/settings"]);
}

const placeSchema = z.object({ id: optionalUuid, cityId: uuid, name });

export async function savePlace(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const kind = formData.get("kind");
  if (kind !== "branch" && kind !== "district") return checkFields;
  const parsed = placeSchema.safeParse({ id: formData.get("id"), cityId: formData.get("cityId"), name: formData.get("name") });
  if (!parsed.success) return checkFields;
  const { id, cityId, name: placeName } = parsed.data;
  return rpc(
    kind === "branch" ? "admin_save_branch" : "admin_save_district",
    { p_id: id, p_city: cityId, p_name: placeName, p_active: active(formData) },
    [kind === "branch" ? "/settings/branches" : "/settings/districts"]
  );
}

export async function renameCustomerType(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z.object({ code: z.enum(["new", "retention"]), name: z.string().trim().min(2).max(40) }).safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
  });
  if (!parsed.success) return checkFields;
  return rpc("admin_rename_customer_type", { p_code: parsed.data.code, p_name: parsed.data.name }, ["/settings/lists"]);
}

export async function saveStockItem(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z.object({ id: uuid, name: z.string().trim().min(2).max(60) }).safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) return checkFields;
  return rpc("admin_save_stock_item", { p_id: parsed.data.id, p_display_name: parsed.data.name, p_active: active(formData) }, [
    "/settings/lists",
  ]);
}

export async function saveHoliday(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z.object({ id: optionalUuid, date, name }).safeParse({
    id: formData.get("id"),
    date: formData.get("date"),
    name: formData.get("name"),
  });
  if (!parsed.success) return checkFields;
  return rpc("admin_save_holiday", { p_id: parsed.data.id, p_date: parsed.data.date, p_name: parsed.data.name }, ["/settings/holidays"]);
}

export async function deleteHoliday(id: string): Promise<SettingsResult> {
  if (!uuid.safeParse(id).success) return checkFields;
  return rpc("admin_delete_holiday", { p_id: id }, ["/settings/holidays"]);
}

export async function saveProduct(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z
    .object({ id: optionalUuid, code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/), name: z.string().trim().min(2).max(60) })
    .safeParse({ id: formData.get("id"), code: formData.get("code") ?? "KEEP", name: formData.get("name") });
  if (!parsed.success) return checkFields;
  return rpc("admin_save_product", { p_id: parsed.data.id, p_code: parsed.data.code, p_name: parsed.data.name, p_active: active(formData) }, [
    "/products",
  ]);
}

const mbps = z.coerce.number().int().min(1).max(100000);
const amount = z.coerce.number().min(0).max(100000);

export async function savePlan(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z
    .object({ id: optionalUuid, productId: uuid, name: z.string().trim().min(2).max(60), download: mbps, upload: mbps, data: z.string().trim().max(40) })
    .safeParse({
      id: formData.get("id"),
      productId: formData.get("productId"),
      name: formData.get("name"),
      download: formData.get("download"),
      upload: formData.get("upload"),
      data: formData.get("data") ?? "",
    });
  if (!parsed.success) return checkFields;
  const p = parsed.data;
  return rpc(
    "admin_save_plan",
    { p_id: p.id, p_product: p.productId, p_name: p.name, p_download_mbps: p.download, p_upload_mbps: p.upload, p_data_allowance: p.data, p_active: active(formData) },
    ["/products"]
  );
}

export async function savePlanPrice(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const parsed = z
    .object({ id: optionalUuid, planId: uuid, recharge: amount.positive(), installation: amount, from: date, to: optionalDate })
    .safeParse({
      id: formData.get("id"),
      planId: formData.get("planId"),
      recharge: formData.get("recharge"),
      installation: formData.get("installation") || 0,
      from: formData.get("from"),
      to: formData.get("to"),
    });
  if (!parsed.success) return checkFields;
  const p = parsed.data;
  return rpc(
    "admin_save_plan_price",
    { p_id: p.id, p_plan: p.planId, p_recharge: p.recharge, p_installation: p.installation, p_effective_from: p.from, p_effective_to: p.to },
    ["/products"]
  );
}
