import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { formatPrefixes, parsePrefixes, parseSettingInput, SETTINGS, settingHint, settingLabel } from "@/lib/settings";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

describe("settings form", () => {
  it("covers every setting seeded by the database, with a label and hint", () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20261022090000_master_data.sql"), "utf8");
    const seeded = [...migration.matchAll(/^\s*\('([a-z_]+)',\s+'/gm)].map((m) => m[1]);
    expect(seeded.sort()).toEqual(SETTINGS.map((s) => s.key).sort());
    for (const s of SETTINGS) {
      expect(t(settingLabel(s.key))).not.toBe(settingLabel(s.key));
      expect(t(settingHint(s.key))).not.toBe(settingHint(s.key));
    }
  });

  it("reads mobile prefixes typed in any common form", () => {
    expect(parsePrefixes("063, 065")).toEqual(["63", "65"]);
    expect(parsePrefixes("63 65 63")).toEqual(["63", "65"]);
    expect(parsePrefixes("+25263")).toEqual(["63"]);
    expect(parsePrefixes("")).toEqual([]);
    expect(parsePrefixes("0634")).toBeUndefined();
    expect(parsePrefixes("6a")).toBeUndefined();
    expect(formatPrefixes(["63", "65"])).toBe("063, 065");
  });

  it("turns form input into the stored value", () => {
    expect(parseSettingInput("payroll_cutoff_day", form([["value", "4"]]))).toBe(4);
    expect(parseSettingInput("payroll_cutoff_day", form([["value", "4.5"]]))).toBeUndefined();
    expect(parseSettingInput("temp_base_salary", form([["value", "120.50"]]))).toBe(120.5);
    expect(parseSettingInput("temp_base_salary", form([["value", "12.345"]]))).toBeUndefined();
    expect(parseSettingInput("week_start_day", form([["value", "saturday"]]))).toBe("saturday");
    expect(parseSettingInput("week_start_day", form([["value", "funday"]]))).toBeUndefined();
    expect(parseSettingInput("weekend_days", form([["value", "saturday"], ["value", "friday"]]))).toEqual(["saturday", "friday"]);
    expect(parseSettingInput("weekend_days", form([]))).toEqual([]);
    expect(parseSettingInput("otp_enabled", form([["value", "true"]]))).toBe(true);
    expect(parseSettingInput("otp_enabled", form([]))).toBe(false);
  });
});
