import type { MessageKey } from "@/lib/i18n";

/**
 * Business settings edited on Settings → General (SDD §8.3 app_settings). The database
 * (public.admin_set_setting) checks every value again; this file only shapes the form.
 */
export const WEEK_DAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

type Kind = "whole" | "amount" | "prefixes" | "day" | "days" | "boolean";

export const SETTINGS = [
  { key: "temp_base_salary", kind: "amount", group: "payroll" },
  { key: "incentive_threshold", kind: "whole", group: "payroll" },
  { key: "incentive_rate", kind: "amount", group: "payroll" },
  { key: "payroll_cutoff_day", kind: "whole", group: "payroll" },
  { key: "free_month_amount", kind: "amount", group: "sales" },
  { key: "allowed_phone_prefixes", kind: "prefixes", group: "sales" },
  { key: "performance_target_units", kind: "whole", group: "performance" },
  { key: "performance_baseline_units", kind: "whole", group: "performance" },
  { key: "week_start_day", kind: "day", group: "calendar" },
  { key: "weekend_days", kind: "days", group: "calendar" },
  { key: "otp_enabled", kind: "boolean", group: "security" },
] as const satisfies ReadonlyArray<{ key: string; kind: Kind; group: string }>;

export type SettingKey = (typeof SETTINGS)[number]["key"];
export type SettingGroup = (typeof SETTINGS)[number]["group"];
export const SETTING_KEYS: readonly string[] = SETTINGS.map((s) => s.key);
export const SETTING_GROUPS: SettingGroup[] = ["payroll", "sales", "performance", "calendar", "security"];

export const settingLabel = (key: SettingKey) => `settings.keys.${key}` as MessageKey;
export const settingHint = (key: SettingKey) => `settings.hints.${key}` as MessageKey;
export const dayLabel = (day: WeekDay) => `settings.days.${day}` as MessageKey;

export function kindOf(key: SettingKey): Kind {
  return SETTINGS.find((s) => s.key === key)!.kind;
}

/** "063, 065" or "63 65" → ["63", "65"]; undefined if any entry is not a 2-digit mobile prefix. */
export function parsePrefixes(input: string): string[] | undefined {
  const parts = input
    .split(/[\s,;]+/)
    .map((p) => p.replace(/^\+?252/, "").replace(/^0/, ""))
    .filter(Boolean);
  if (parts.some((p) => !/^[1-9][0-9]$/.test(p))) return undefined;
  return [...new Set(parts)];
}

/** Display form of stored prefixes: ["63", "65"] → "063, 065". */
export function formatPrefixes(value: unknown): string {
  return Array.isArray(value) ? value.map((p) => `0${p}`).join(", ") : "";
}

/** Turn the submitted form into the JSON value for the setting; undefined when it cannot be read. */
export function parseSettingInput(key: SettingKey, formData: FormData): unknown {
  const raw = String(formData.get("value") ?? "").trim();
  switch (kindOf(key)) {
    case "whole":
      return /^\d+$/.test(raw) ? Number(raw) : undefined;
    case "amount":
      return /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : undefined;
    case "prefixes":
      return parsePrefixes(raw);
    case "day":
      return (WEEK_DAYS as readonly string[]).includes(raw) ? raw : undefined;
    case "days": {
      const days = formData.getAll("value").map(String);
      return days.every((d) => (WEEK_DAYS as readonly string[]).includes(d)) ? WEEK_DAYS.filter((d) => days.includes(d)) : undefined;
    }
    case "boolean":
      return formData.get("value") === "true";
  }
}
