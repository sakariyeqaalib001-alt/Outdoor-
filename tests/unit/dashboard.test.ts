import { describe, expect, it } from "vitest";
import {
  achievement,
  agentRows,
  bandOf,
  bandOfPercent,
  cityRows,
  Figures,
  filterPayload,
  filterQuery,
  lastMonths,
  monthPace,
  parseFilters,
  type FigureRow,
} from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { VIEWS } from "@/lib/dashboard";

const H = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const A1 = "33333333-3333-4333-8333-333333333333";
const A2 = "44444444-4444-4444-8444-444444444444";
const GONE = "55555555-5555-4555-8555-555555555555";

const row = (bucket: FigureRow["bucket"], dim: FigureRow["dim"], key: string | null, units: number, revenue = units * 25): FigureRow => ({
  bucket, dim, key, label: key, parent: null, units, revenue: String(revenue), new_units: units, retention_units: 0, on_hold_units: 0,
});

describe("filters from the page address", () => {
  it("defaults to this month and drops unknown values", () => {
    expect(parseFilters({})).toEqual({ period: "month" });
    expect(parseFilters({ period: "forever", city_id: "Hargeisa", agent_id: ["x", "y"] })).toEqual({ period: "month" });
  });

  it("keeps a valid custom range and ids; a broken range falls back to this month", () => {
    expect(parseFilters({ period: "custom", from: "2026-10-01", to: "2026-10-31", city_id: H })).toEqual({ period: "custom", from: "2026-10-01", to: "2026-10-31", city_id: H });
    expect(parseFilters({ period: "custom", from: "2026-10-31", to: "2026-10-01" })).toEqual({ period: "month" });
  });

  it("writes them back without defaults, and sends them to the database", () => {
    expect(filterQuery({ period: "month" })).toBe("");
    expect(filterQuery({ period: "ytd", city_id: H }, { bucket: "overall" })).toBe(`?period=ytd&city_id=${H}&bucket=overall`);
    expect(filterPayload({ period: "custom", from: "2026-10-01", to: "2026-10-02", agent_id: A1 })).toEqual({ period: "custom", from: "2026-10-01", to: "2026-10-02", agent_id: A1 });
  });
});

describe("figures, targets and bands", () => {
  const figures = new Figures([row("month", "total", null, 25), row("month", "city", H, 20), row("month", "city", B, 5), row("month", "agent", A1, 21), row("month", "agent", GONE, 4), row("overall", "total", null, 60)]);

  it("missing combinations are zero", () => {
    expect(figures.get("month").units).toBe(25);
    expect(figures.get("month").revenue).toBe(625);
    expect(figures.get("last_month").units).toBe(0);
    expect(figures.get("month", "city", "nope").units).toBe(0);
  });

  it("target achievement = actual ÷ target × 100; no target → no percentage", () => {
    expect(achievement(15, 20)).toBe(75);
    expect(achievement(5, 0)).toBeNull();
  });

  it("bands: ≥ 20 met, 15–19 baseline, < 15 underperforming (FR-CONF-07)", () => {
    expect([bandOf(20, 20, 15), bandOf(19, 20, 15), bandOf(15, 20, 15), bandOf(14, 20, 15)]).toEqual(["met", "baseline", "baseline", "under"]);
    expect([bandOfPercent(100, 20, 15), bandOfPercent(75, 20, 15), bandOfPercent(74, 20, 15), bandOfPercent(null, 20, 15)]).toEqual(["met", "baseline", "under", null]);
  });

  it("city target = people with a target × target units (D-42)", () => {
    const people = [
      { user_id: A1, full_name: "Agent One", city_id: H, team_name: "A", is_team_leader: false },
      { user_id: A2, full_name: "Leader Two", city_id: H, team_name: "A", is_team_leader: true },
    ];
    const cities = [{ id: H, name: "Hargeisa" }, { id: B, name: "Berbera" }];
    const rows = cityRows(figures, people, cities, { nationwide: true, targetApplies: true, targetUnits: 20, baselineUnits: 15 });
    expect(rows.map((r) => [r.name, r.target, r.month.units, r.pct, r.band])).toEqual([["Hargeisa", 40, 20, 50, "under"], ["Berbera", 0, 5, null, null]]);
    // A team view hides cities with no people and no sales; a branch/product filter removes the target.
    expect(cityRows(figures, people, [{ id: "x", name: "Borama" }], { nationwide: false, targetApplies: true, targetUnits: 20, baselineUnits: 15 })).toEqual([]);
    expect(cityRows(figures, people, cities, { nationwide: true, targetApplies: false, targetUnits: 20, baselineUnits: 15 })[0].target).toBe(0);
  });

  it("agents: everyone with a target plus anyone else who sold, by units", () => {
    const people = [
      { user_id: A1, full_name: "Agent One", city_id: H, team_name: "A", is_team_leader: false },
      { user_id: A2, full_name: "Agent Two", city_id: H, team_name: "A", is_team_leader: false },
    ];
    const rows = agentRows(figures, "month", people, { targetUnits: 20, baselineUnits: 15 });
    expect(rows.map((r) => [r.id, r.units, r.target, r.band])).toEqual([[A1, 21, 20, "met"], [GONE, 4, null, null], [A2, 0, 20, "under"]]);
  });
});

describe("dates", () => {
  it("last months end with the current one, across the year", () => {
    expect(lastMonths("2027-02", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("month pace", () => {
    expect(monthPace("2026-11-15")).toEqual({ day: 15, days: 30, pct: 50 });
    expect(monthPace("2028-02-29").days).toBe(29);
  });
});

describe("views", () => {
  it("every view has a translated name", () => {
    for (const v of VIEWS) expect(t(v.label)).not.toBe(v.label);
  });
});
