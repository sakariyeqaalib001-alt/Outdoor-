import "server-only";
import { Figures, filterPayload, type Bucket, type Context, type FigureRow, type Filters } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Dashboard reads (Phase 10). Every figure comes from the public.dashboard_* database functions, which apply
 * the eligible-sale rule and the caller's scope (dashboard.read own / team / all) — nothing is counted here.
 */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function getContext(filters: Filters): Promise<Context> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_context", { p: filterPayload(filters) })) as Context;
}

export async function getFigures(filters: Filters): Promise<Figures> {
  const supabase = await client();
  return new Figures(unwrap(await supabase.rpc("dashboard_figures", { p: filterPayload(filters) })) as FigureRow[]);
}

export type TrendRow = {
  month: string;
  dim: "total" | "product" | "city";
  key: string | null;
  label: string | null;
  units: number;
  revenue: number | string;
  new_units: number;
  retention_units: number;
};

export async function getTrend(filters: Filters, months = 12): Promise<TrendRow[]> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_trend", { p: filterPayload(filters), p_months: months })) as TrendRow[];
}

export type Person = { user_id: string; full_name: string; city_id: string | null; team_name: string | null; is_team_leader: boolean };

export async function getPeople(filters: Filters): Promise<Person[]> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_people", { p: filterPayload(filters) })) as Person[];
}

export type Option = { id: string; name: string; city_id?: string | null };
export type FilterOptions = { cities: Option[]; branches: Option[]; products: Option[]; agents: Option[] };

/** Lists for the filter bar: active cities, branches and products, and the sellers the caller may see. */
export async function getFilterOptions(withAgents = true): Promise<FilterOptions> {
  const supabase = await client();
  const [cities, branches, products, agents] = await Promise.all([
    supabase.from("cities").select("id, name").eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name, city_id").eq("is_active", true).order("name"),
    supabase.from("products").select("id, code, sort_order").eq("is_active", true).order("sort_order"),
    withAgents ? supabase.rpc("dashboard_agents") : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    cities: (unwrap(cities) ?? []) as Option[],
    branches: (unwrap(branches) ?? []) as Option[],
    products: ((unwrap(products) ?? []) as { id: string; code: string }[]).map((p) => ({ id: p.id, name: p.code })),
    agents: ((unwrap(agents) ?? []) as { user_id: string; full_name: string; city_id: string | null }[]).map((a) => ({
      id: a.user_id,
      name: a.full_name,
      city_id: a.city_id,
    })),
  };
}

/** Keep only filter values that are in the caller's lists (anything else is ignored, not an error). */
export function cleanFilters(filters: Filters, options: FilterOptions): Filters {
  const clean: Filters = { ...filters };
  const has = (list: Option[], id?: string) => Boolean(id && list.some((o) => o.id === id));
  if (!has(options.cities, clean.city_id)) delete clean.city_id;
  if (!has(options.branches, clean.branch_id)) delete clean.branch_id;
  if (!has(options.products, clean.product_id)) delete clean.product_id;
  if (!has(options.agents, clean.agent_id)) delete clean.agent_id;
  return clean;
}

export type StockFigure = { item_id: string; code: string; name: string; received: number | null; issued: number };

export async function getStock(filters: Filters): Promise<StockFigure[]> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_stock", { p: filterPayload(filters) })) as StockFigure[];
}

export type AuditFigures = { duplicate_attempts: number; open_cases: number; older_than_7_days: number };

export async function getAuditFigures(filters: Filters): Promise<AuditFigures> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_audit", { p: filterPayload(filters) })) as AuditFigures;
}

export type ListedSale = {
  sale_id: string;
  submitted_at: string;
  approved_at: string | null;
  counting_month: string | null;
  status: string;
  agent_name: string;
  customer_name: string;
  product_code: string;
  customer_type: "new" | "retention";
  amount: number | string;
  city_name: string;
  branch_name: string;
  on_hold: boolean;
};

export async function getSalesList(filters: Filters, bucket: Bucket): Promise<ListedSale[]> {
  const supabase = await client();
  return unwrap(await supabase.rpc("dashboard_sales_list", { p: filterPayload(filters), p_bucket: bucket })) as ListedSale[];
}
