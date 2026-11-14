import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { notificationLink } from "@/lib/notifications";
import { REFUND_REASONS, REFUND_STATUSES, reasonComplete, validRefundAmount } from "@/lib/refunds";
import { SALE_ERRORS } from "@/lib/sales";
import { RULE_CODES, RULE_THRESHOLDS } from "@/lib/audit";

/** Phase 12 — refund rules mirrored on screen (the database enforces them again). */
describe("refund amount (FR-REF-06)", () => {
  it("must be above 0, not above the amount collected, whole cents", () => {
    expect(validRefundAmount(10, 30)).toBe(true);
    expect(validRefundAmount(30, 30)).toBe(true);
    expect(validRefundAmount(12.5, 30)).toBe(true);
    for (const bad of [0, -1, 30.01, 1.005, Number.NaN, Number.POSITIVE_INFINITY]) expect(validRefundAmount(bad, 30)).toBe(false);
  });
});

describe("refund reason (FR-REF-02)", () => {
  it("has the five BRD reasons; Other needs a note", () => {
    expect(REFUND_REASONS).toEqual(["out_of_boundary", "technical_delay", "refused", "no_signal", "other"]);
    expect(reasonComplete("no_signal", "")).toBe(true);
    expect(reasonComplete("other", "  ")).toBe(false);
    expect(reasonComplete("other", "Moved house")).toBe(true);
    expect(reasonComplete("bored", "x")).toBe(false);
  });

  it("every reason and status has a label", () => {
    for (const r of REFUND_REASONS) expect(t(`refunds.reasons.${r}`)).not.toBe(`refunds.reasons.${r}`);
    for (const s of REFUND_STATUSES) expect(t(`refunds.statuses.${s}`)).not.toBe(`refunds.statuses.${s}`);
  });
});

describe("refund messages and links", () => {
  it("every refund error from the database has a message", () => {
    for (const code of ["SALE_NOT_REFUNDABLE", "REFUND_EXISTS", "REFUND_AMOUNT", "REFUND_NOT_APPROVED", "RETURN_TOO_MANY"]) {
      expect(SALE_ERRORS[code]).toBeDefined();
      expect(t(SALE_ERRORS[code])).not.toBe(SALE_ERRORS[code]);
    }
  });

  it("refund notifications open the Refunds page; device returns open Stock → Returns", () => {
    expect(notificationLink("refund_pending", "x")).toBe("/refunds");
    expect(notificationLink("refund_approved", "x")).toBe("/refunds");
    expect(notificationLink("refund_rejected", "x")).toBe("/refunds");
    expect(notificationLink("refund_return", "x")).toBe("/stock/returns");
  });

  it("HIGH_REFUND_RATE is listed with editable thresholds matching the database limits", () => {
    expect(RULE_CODES).toContain("HIGH_REFUND_RATE");
    expect(RULE_THRESHOLDS.HIGH_REFUND_RATE?.map((f) => [f.key, f.min, f.max])).toEqual([["percent", 1, 100], ["refunds", 1, 50], ["days", 1, 365]]);
  });
});
