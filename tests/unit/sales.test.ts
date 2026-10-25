import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { amountCollected, duplicateMessage, freeMonthQualifies, isValidIndex, recentMonths, SALE_ERRORS } from "@/lib/sales";

describe("sales helpers (D-36)", () => {
  it("compute amount = recharge × months + installation; free month = 2 months", () => {
    expect(amountCollected(25, 0, 1, false)).toBe(25);
    expect(amountCollected(25, 10, 3, false)).toBe(85);
    expect(amountCollected(25, 0, 7, true)).toBe(50);
  });

  it("allow the free month only when 2 months reach the setting", () => {
    expect(freeMonthQualifies(25, 50)).toBe(true);
    expect(freeMonthQualifies(20, 50)).toBe(false);
  });

  it("validate the Index Number as exactly 8 digits", () => {
    expect(isValidIndex("50091293")).toBe(true);
    for (const bad of ["5009129", "500912934", "5009129A", ""]) expect(isValidIndex(bad)).toBe(false);
  });

  it("list the current month and the 12 before it, across years", () => {
    const months = recentMonths("2026-02");
    expect(months).toHaveLength(13);
    expect(months.slice(0, 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });
});

describe("sales messages", () => {
  const migration = ["20261024090000_sales.sql", "20261025090000_approvals_switches.sql"]
    .map((f) => readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations", f), "utf8"))
    .join("\n");

  it("have a readable message for every error the sales functions can raise", () => {
    const codes = new Set([...migration.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    for (const code of codes) {
      expect(SALE_ERRORS[code], code).toBeDefined();
      expect(t(SALE_ERRORS[code])).not.toBe(SALE_ERRORS[code]);
    }
  });

  it("explain every duplicate rule", () => {
    for (const [rule, field] of [["DUP_PHONE", "phone"], ["DUP_PHONE", "phone_and_index"], ["DUP_INDEX", "index"], ["SAME_MONTH", "month"],
      ["IDENTITY_CONFLICT", "name"], ["IDENTITY_CONFLICT", "former_number"], ["IDENTITY_CONFLICT", "phone_and_index"]]) {
      const key = duplicateMessage(rule, field);
      expect(t(key), `${rule}/${field}`).toMatch(/^Blocked:/);
    }
  });
});
