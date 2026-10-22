import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIME_ZONE,
  businessMonth,
  businessToday,
  formatBusinessDate,
  formatDateOnly,
  formatBusinessDateTime,
  formatMonthLabel,
} from "@/lib/dates";
import { formatUSD } from "@/lib/money";
import { t } from "@/lib/i18n";

describe("business dates (EAT, UTC+3)", () => {
  it("uses the EAT time zone", () => {
    expect(BUSINESS_TIME_ZONE).toBe("Africa/Mogadishu");
  });

  it("puts 31 Oct 23:50 EAT in October", () => {
    expect(businessMonth(new Date("2026-10-31T20:50:00Z"))).toBe("2026-10");
  });

  it("puts 1 Nov 00:10 EAT in November (D-30 after-midnight rule)", () => {
    expect(businessMonth(new Date("2026-10-31T21:10:00Z"))).toBe("2026-11");
  });

  it("formats DD/MM/YYYY in business time", () => {
    expect(formatBusinessDate(new Date("2026-10-31T21:10:00Z"))).toBe("01/11/2026");
    expect(formatBusinessDateTime(new Date("2026-10-31T21:10:00Z"))).toBe("01/11/2026 00:10");
  });

  it("formats calendar dates and gives today's date in EAT", () => {
    expect(formatDateOnly("2026-05-18")).toBe("18/05/2026");
    expect(businessToday(new Date("2026-10-31T21:10:00Z"))).toBe("2026-11-01");
    expect(businessToday(new Date("2026-10-31T20:50:00Z"))).toBe("2026-10-31");
  });

  it("labels months", () => {
    expect(formatMonthLabel("2026-10")).toBe("October 2026");
  });
});

describe("currency", () => {
  it("formats USD with 2 decimals", () => {
    expect(formatUSD(100)).toBe("$100.00");
    expect(formatUSD(1250.5)).toBe("$1,250.50");
  });
});

describe("translations", () => {
  it("returns messages and fills values", () => {
    expect(t("nav.dashboard")).toBe("Dashboard");
    expect(t("nav.comingInPhase", { phase: 7 })).toBe("Coming in Phase 7");
  });
});
