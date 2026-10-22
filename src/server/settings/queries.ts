import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only queries for Settings and Products (Phase 5). They run as the signed-in user, so RLS applies. */

export type CityOption = { id: string; name: string };
export type PlaceRow = { id: string; city_id: string; name: string; is_active: boolean };
export type CustomerTypeRow = { code: string; name: string };
export type StockItemRow = { id: string; code: string; display_name: string; is_active: boolean };
export type HolidayRow = { id: string; holiday_date: string; name: string };
export type SettingRow = { key: string; value: unknown; description: string };
export type ProductRow = { id: string; code: string; name: string; is_active: boolean };
export type PlanRow = {
  id: string;
  product_id: string;
  name: string;
  download_mbps: number;
  upload_mbps: number;
  data_allowance: string;
  is_active: boolean;
};
export type PlanPriceRow = {
  id: string;
  plan_id: string;
  recharge_amount: number;
  installation_fee: number;
  effective_from: string;
  effective_to: string | null;
};

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function listCities(): Promise<CityOption[]> {
  const { data } = await (await client()).from("cities").select("id, name").eq("is_active", true).order("name");
  return (data ?? []) as CityOption[];
}

export async function listPlaces(table: "branches" | "districts"): Promise<PlaceRow[]> {
  const { data } = await (await client()).from(table).select("id, city_id, name, is_active").order("name");
  return (data ?? []) as PlaceRow[];
}

export async function listLists(): Promise<{ customerTypes: CustomerTypeRow[]; stockItems: StockItemRow[] }> {
  const supabase = await client();
  const [types, items] = await Promise.all([
    supabase.from("customer_types").select("code, name").order("sort_order"),
    supabase.from("stock_items").select("id, code, display_name, is_active").order("sort_order"),
  ]);
  return { customerTypes: (types.data ?? []) as CustomerTypeRow[], stockItems: (items.data ?? []) as StockItemRow[] };
}

export async function listHolidays(): Promise<HolidayRow[]> {
  const { data } = await (await client()).from("public_holidays").select("id, holiday_date, name").order("holiday_date");
  return (data ?? []) as HolidayRow[];
}

export async function listSettings(): Promise<SettingRow[]> {
  const { data } = await (await client()).from("app_settings").select("key, value, description");
  return (data ?? []) as SettingRow[];
}

export async function listProducts(): Promise<{ products: ProductRow[]; plans: PlanRow[]; prices: PlanPriceRow[] }> {
  const supabase = await client();
  const [products, plans, prices] = await Promise.all([
    supabase.from("products").select("id, code, name, is_active").order("sort_order"),
    supabase.from("plans").select("id, product_id, name, download_mbps, upload_mbps, data_allowance, is_active").order("sort_order"),
    supabase
      .from("plan_prices")
      .select("id, plan_id, recharge_amount, installation_fee, effective_from, effective_to")
      .order("effective_from", { ascending: false }),
  ]);
  return {
    products: (products.data ?? []) as ProductRow[],
    plans: (plans.data ?? []) as PlanRow[],
    prices: (prices.data ?? []) as PlanPriceRow[],
  };
}
