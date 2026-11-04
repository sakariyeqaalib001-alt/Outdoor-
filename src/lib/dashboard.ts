import type { MessageKey } from "@/lib/i18n";

/**
 * Dashboard helpers (Phase 10, BRD §9.1, SDD §14). The database (public.dashboard_* functions) decides which
 * sales count and who sees them; these helpers only read the request, shape the rows and work out percentages.
 */

export const PERIODS = ["today", "week", "month", "prev_month", "ytd", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const FILTER_KEYS = ["city_id", "branch_id", "product_id", "agent_id"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type Filters = { period: Period; from?: string; to?: string } & Partial<Record<FilterKey, string>>;

/** Figure buckets returned by public.dashboard_figures (one sale can be in several). */
export const BUCKETS = ["overall", "month", "last_month", "period", "submitted_month", "submitted_period", "pending"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type Dim = "total" | "city" | "branch" | "product" | "agent";

export type Totals = { units: number; revenue: number; newUnits: number; retentionUnits: number; onHoldUnits: number };
export const ZERO: Totals = { units: 0, revenue: 0, newUnits: 0, retentionUnits: 0, onHoldUnits: 0 };

export type FigureRow = {
  bucket: Bucket;
  dim: Dim;
  key: string | null;
  label: string | null;
  parent: string | null;
  units: number;
  revenue: number | string;
  new_units: number;
  retention_units: number;
  on_hold_units: number;
};

export type Context = {
  basis: "month" | "date";
  from_date: string;
  to_date: string;
  from_month: string | null;
  to_month: string | null;
  current_month: string;
  today: string;
  cutoff_day: number;
  target_units: number;
  baseline_units: number;
  scope: "own" | "team" | "city" | "all" | null;
  generated_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the filters from the page address. Unknown values are dropped (the database checks them again). */
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const period = (PERIODS as readonly string[]).includes(one("period") ?? "") ? (one("period") as Period) : "month";
  const filters: Filters = { period };
  if (period === "custom") {
    const from = one("from");
    const to = one("to");
    if (from && to && DATE.test(from) && DATE.test(to) && from <= to) {
      filters.from = from;
      filters.to = to;
    } else {
      filters.period = "month";
    }
  }
  for (const key of FILTER_KEYS) {
    const value = one(key);
    if (value && UUID.test(value)) filters[key] = value;
  }
  return filters;
}

/** The address query for a set of filters (default values left out), e.g. "?period=ytd&city_id=…". */
export function filterQuery(filters: Filters, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  if (filters.period !== "month") q.set("period", filters.period);
  if (filters.period === "custom" && filters.from && filters.to) {
    q.set("from", filters.from);
    q.set("to", filters.to);
  }
  for (const key of FILTER_KEYS) if (filters[key]) q.set(key, filters[key]!);
  for (const [key, value] of Object.entries(extra)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** JSON sent to the database functions. */
export function filterPayload(filters: Filters): Record<string, string> {
  const p: Record<string, string> = { period: filters.period };
  if (filters.from) p.from = filters.from;
  if (filters.to) p.to = filters.to;
  for (const key of FILTER_KEYS) if (filters[key]) p[key] = filters[key]!;
  return p;
}

function toTotals(r: FigureRow): Totals {
  return {
    units: r.units,
    revenue: Number(r.revenue),
    newUnits: r.new_units,
    retentionUnits: r.retention_units,
    onHoldUnits: r.on_hold_units,
  };
}

/** Look-ups over the figure rows. Missing combinations are zero. */
export class Figures {
  private readonly byKey = new Map<string, FigureRow>();

  constructor(readonly rows: FigureRow[]) {
    for (const r of rows) this.byKey.set(`${r.bucket}|${r.dim}|${r.key ?? ""}`, r);
  }

  get(bucket: Bucket, dim: Dim = "total", key: string | null = null): Totals {
    const r = this.byKey.get(`${bucket}|${dim}|${dim === "total" ? "" : key ?? ""}`);
    return r ? toTotals(r) : ZERO;
  }

  /** Rows of one dimension in a bucket, with their labels. */
  list(bucket: Bucket, dim: Exclude<Dim, "total">): (Totals & { key: string; label: string; parent: string | null })[] {
    return this.rows
      .filter((r) => r.bucket === bucket && r.dim === dim && r.key)
      .map((r) => ({ ...toTotals(r), key: r.key!, label: r.label ?? "", parent: r.parent }));
  }
}

/** Whole-number percentage, or null when there is nothing to compare with. */
export function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

/** Target achievement (%) = actual ÷ target × 100 (owner's prompt, §4C). */
export function achievement(actual: number, target: number): number | null {
  return percent(actual, target);
}

export type Band = "met" | "baseline" | "under";

/** Monthly performance band from eligible units (FR-CONF-07): ≥ target met, ≥ baseline baseline, else under. */
export function bandOf(units: number, target: number, baseline: number): Band {
  if (units >= target) return "met";
  if (units >= baseline) return "baseline";
  return "under";
}

/** Band for a group (city) from its achievement %, using the same thresholds as agents (20 and 15 → 100 % and 75 %). */
export function bandOfPercent(pct: number | null, target: number, baseline: number): Band | null {
  if (pct === null || !target) return null;
  if (pct >= 100) return "met";
  if (pct >= Math.round((baseline / target) * 100)) return "baseline";
  return "under";
}

export const BAND_LABEL: Record<Band, MessageKey> = {
  met: "dashboard.band.met",
  baseline: "dashboard.band.baseline",
  under: "dashboard.band.under",
};

/** Month progress: day of month and days in the month, for the "pace" marker on target bars. */
export function monthPace(today: string): { day: number; days: number; pct: number } {
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { day: d, days, pct: Math.round((d / days) * 100) };
}

/** "2026-11-01" → "2026-11" (month key used by lib/dates). */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** The last n month keys ending with `current` ("2026-11"), oldest first. */
export function lastMonths(current: string, n: number): string[] {
  const [y, m] = current.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export const PERIOD_LABEL: Record<Period, MessageKey> = {
  today: "dashboard.period.today",
  week: "dashboard.period.week",
  month: "dashboard.period.month",
  prev_month: "dashboard.period.prev_month",
  ytd: "dashboard.period.ytd",
  custom: "dashboard.period.custom",
};

/** Products in display order (BRD FR-CONF-01). */
export const PRODUCT_ORDER = ["FTTA", "FTTH", "FTTB", "LTE"] as const;

/** Dashboard views (sidebar items and the tabs at the top of each view). */
export const VIEWS = [
  { href: "/", label: "nav.dashboardOverview" },
  { href: "/dashboard/branches", label: "nav.dashboardBranches" },
  { href: "/dashboard/technology", label: "nav.dashboardTechnology" },
  { href: "/dashboard/trends", label: "nav.dashboardTrends" },
  { href: "/dashboard/reports", label: "nav.dashboardReports" },
  { href: "/dashboard/operations", label: "nav.dashboardOperations" },
] as const satisfies ReadonlyArray<{ href: string; label: MessageKey }>;

type PersonLike = { user_id: string; full_name: string; city_id: string | null; team_name: string | null; is_team_leader: boolean };
type OptionLike = { id: string; name: string; city_id?: string | null };

export type CityRow = {
  id: string;
  name: string;
  overall: Totals;
  month: Totals;
  period: Totals;
  people: number;
  target: number;
  pct: number | null;
  band: Band | null;
};

/**
 * One row per city in view (D-42): figures plus the city target = people with a target × target units.
 * All cities for a nationwide view; for a team or own view only cities with people or sales.
 * No target with a branch or product filter (the target covers the whole city and all products).
 */
export function cityRows(
  figures: Figures,
  people: PersonLike[],
  cities: OptionLike[],
  opts: { nationwide: boolean; cityFilter?: string; targetApplies: boolean; targetUnits: number; baselineUnits: number }
): CityRow[] {
  return cities
    .filter((c) => !opts.cityFilter || c.id === opts.cityFilter)
    .map((c) => {
      const count = people.filter((p) => p.city_id === c.id).length;
      const month = figures.get("month", "city", c.id);
      const target = opts.targetApplies ? count * opts.targetUnits : 0;
      const pct = achievement(month.units, target);
      return {
        id: c.id,
        name: c.name,
        overall: figures.get("overall", "city", c.id),
        month,
        period: figures.get("period", "city", c.id),
        people: count,
        target,
        pct,
        band: bandOfPercent(pct, opts.targetUnits, opts.baselineUnits),
      };
    })
    .filter((r) => opts.nationwide || r.people > 0 || r.overall.units > 0);
}

export type AgentRow = { id: string; name: string; team: string | null; cityId: string | null; units: number; revenue: number; target: number | null; pct: number | null; band: Band | null };

/**
 * Agents' monthly units against their target (FR-CONF-07 bands, shown early per D-42): everyone with a target
 * plus anyone else who sold in the month (e.g. since deactivated — no target). Sorted by units, then name.
 */
export function agentRows(
  figures: Figures,
  bucket: Bucket,
  people: PersonLike[],
  opts: { targetUnits: number; baselineUnits: number }
): AgentRow[] {
  const sold = new Map(figures.list(bucket, "agent").map((a) => [a.key, a]));
  const rows: AgentRow[] = people.map((p) => {
    const f = sold.get(p.user_id);
    sold.delete(p.user_id);
    const units = f?.units ?? 0;
    return {
      id: p.user_id,
      name: p.full_name,
      team: p.team_name,
      cityId: p.city_id,
      units,
      revenue: f?.revenue ?? 0,
      target: opts.targetUnits,
      pct: achievement(units, opts.targetUnits),
      band: bandOf(units, opts.targetUnits, opts.baselineUnits),
    };
  });
  for (const f of sold.values()) {
    rows.push({ id: f.key, name: f.label, team: null, cityId: null, units: f.units, revenue: f.revenue, target: null, pct: null, band: null });
  }
  return rows.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
