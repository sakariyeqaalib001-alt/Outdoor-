import "server-only";
import { businessToday } from "@/lib/dates";
import type { CustomerType, SaleStatus } from "@/lib/sales";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionId } from "@/server/auth/session";

/** Read-only sales queries (Phase 7). They run as the signed-in user, so RLS limits every row. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export type Option = { id: string; name: string };
export type DistrictOption = Option & { city_id: string };
export type BranchOption = Option & { city_id: string };
export type PlanOption = {
  id: string;
  product_id: string;
  product_code: string;
  name: string;
  download_mbps: number;
  upload_mbps: number;
  recharge: number;
  installation: number;
};
export type SaleFormData = {
  myCity: string | null;
  canOverrideCity: boolean;
  cities: Option[];
  districts: DistrictOption[];
  branches: BranchOption[];
  plans: PlanOption[];
  freeMonthAmount: number;
};

/** Everything the sales form needs: lists and prices in force today (equipment is recorded at approval, D-37). */
export async function getSaleFormData(canOverrideCity: boolean): Promise<SaleFormData> {
  const supabase = await client();
  const today = businessToday();
  const ids = await getSessionId(supabase);
  const [me, cities, districts, branches, plans, prices, setting] = await Promise.all([
    supabase.from("user_profiles").select("city_id").eq("id", ids?.userId ?? "").maybeSingle(),
    supabase.from("cities").select("id, name").eq("is_active", true).order("name"),
    supabase.from("districts").select("id, name, city_id").eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name, city_id").eq("is_active", true).order("name"),
    supabase.from("plans").select("id, product_id, name, download_mbps, upload_mbps, sort_order, products!inner(code, sort_order, is_active)").eq("is_active", true),
    supabase.from("plan_prices").select("plan_id, recharge_amount, installation_fee, effective_from, effective_to").lte("effective_from", today),
    supabase.from("app_settings").select("value").eq("key", "free_month_amount").maybeSingle(),
  ]);

  type RawPlan = { id: string; product_id: string; name: string; download_mbps: number; upload_mbps: number; sort_order: number; products: { code: string; sort_order: number; is_active: boolean } };
  type RawPrice = { plan_id: string; recharge_amount: number; installation_fee: number; effective_from: string; effective_to: string | null };
  const current = new Map<string, RawPrice>();
  for (const p of (prices.data ?? []) as RawPrice[]) if (!p.effective_to || p.effective_to >= today) current.set(p.plan_id, p);
  const planOptions = ((plans.data ?? []) as unknown as RawPlan[])
    .filter((p) => p.products.is_active && current.has(p.id))
    .sort((a, b) => a.products.sort_order - b.products.sort_order || a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.id,
      product_id: p.product_id,
      product_code: p.products.code,
      name: p.name,
      download_mbps: p.download_mbps,
      upload_mbps: p.upload_mbps,
      recharge: Number(current.get(p.id)!.recharge_amount),
      installation: Number(current.get(p.id)!.installation_fee),
    }));

  return {
    myCity: (me.data as { city_id: string | null } | null)?.city_id ?? null,
    canOverrideCity,
    cities: (cities.data ?? []) as Option[],
    districts: (districts.data ?? []) as DistrictOption[],
    branches: (branches.data ?? []) as BranchOption[],
    plans: planOptions,
    freeMonthAmount: Number((setting.data as { value: unknown } | null)?.value ?? 50),
  };
}

export type SaleRow = {
  id: string;
  submitted_at: string;
  sale_month: string;
  customer_name: string;
  customer_type: CustomerType;
  status: SaleStatus;
  free_month: boolean;
  months_paid: number;
  amount_collected: number;
  agent_id: string;
  product: string;
  plan: string;
};

const SALE_COLUMNS =
  "id, submitted_at, sale_month, customer_name, customer_type, status, free_month, months_paid, amount_collected, agent_id, products(code), plans(name)";

type RawSale = Omit<SaleRow, "product" | "plan"> & { products: { code: string }; plans: { name: string } };
const toRow = (r: RawSale): SaleRow => {
  const { products, plans, ...rest } = r;
  return { ...rest, amount_collected: Number(rest.amount_collected), product: products.code, plan: plans.name };
};

/** Sales of one month (sale_month = first day), optionally for one agent, optionally free-month only. */
export async function listSales(monthStart: string, opts: { agentId?: string; freeMonthOnly?: boolean } = {}): Promise<SaleRow[]> {
  let query = (await client()).from("sales").select(SALE_COLUMNS).eq("sale_month", monthStart).order("submitted_at", { ascending: false }).limit(1000);
  if (opts.agentId) query = query.eq("agent_id", opts.agentId);
  if (opts.freeMonthOnly) query = query.eq("free_month", true);
  const { data } = await query;
  return ((data ?? []) as unknown as RawSale[]).map(toRow);
}

/** People whose sales the caller may see (for the agent selector of Team Leaders and Super Admin). */
export async function listSellers(): Promise<Option[]> {
  const { data } = await (await client())
    .from("user_profiles")
    .select("id, full_name, user_roles!inner(role_key)")
    .in("user_roles.role_key", ["agent", "team_leader"])
    .order("full_name");
  const seen = new Map<string, string>();
  for (const p of (data ?? []) as { id: string; full_name: string }[]) seen.set(p.id, p.full_name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export type SaleDetail = SaleRow & {
  unit_price: number;
  installation_fee: number;
  area_text: string;
  approved_at: string | null;
  customer_id: string;
  city: string;
  district: string;
  branch: string;
  agent: string | null;
  phone: string | null;
  index: string | null;
  items: { name: string; quantity: number }[];
};

export async function getSale(id: string): Promise<SaleDetail | null> {
  const supabase = await client();
  const { data } = await supabase
    .from("sales")
    .select(`${SALE_COLUMNS}, unit_price, installation_fee, area_text, approved_at, customer_id, cities(name), districts(name), branches(name),
      sale_items(quantity, stock_items(display_name))`)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  type Raw = RawSale & {
    unit_price: number; installation_fee: number; area_text: string; approved_at: string | null; customer_id: string;
    cities: { name: string }; districts: { name: string }; branches: { name: string };
    sale_items: { quantity: number; stock_items: { display_name: string } }[];
  };
  const r = data as unknown as Raw;
  const [agent, identifiers] = await Promise.all([
    supabase.from("user_profiles").select("full_name").eq("id", r.agent_id).maybeSingle(),
    supabase.from("customer_identifiers").select("kind, value").eq("customer_id", r.customer_id).eq("is_current", true),
  ]);
  const ident = (kind: string) => ((identifiers.data ?? []) as { kind: string; value: string }[]).find((i) => i.kind === kind)?.value ?? null;
  return {
    ...toRow(r),
    unit_price: Number(r.unit_price),
    installation_fee: Number(r.installation_fee),
    area_text: r.area_text,
    approved_at: r.approved_at,
    customer_id: r.customer_id,
    city: r.cities.name,
    district: r.districts.name,
    branch: r.branches.name,
    agent: (agent.data as { full_name: string } | null)?.full_name ?? null,
    phone: ident("phone"),
    index: ident("index"),
    items: r.sale_items.map((i) => ({ name: i.stock_items.display_name, quantity: i.quantity })),
  };
}

export type CustomerRow = { id: string; full_name: string; city: string; phone: string | null; index: string | null; sales: number; created_at: string };

/** Customers the caller may see, newest first; search by name, phone or Index. */
export async function listCustomers(search: string): Promise<CustomerRow[]> {
  const supabase = await client();
  const term = search.trim();
  let ids: string[] | null = null;
  if (term) {
    const digits = term.replace(/\D/g, "");
    const [byName, byIdentifier] = await Promise.all([
      supabase.from("customers").select("id").ilike("full_name", `%${term.replace(/[%_]/g, "")}%`).limit(200),
      digits.length >= 4 ? supabase.from("customer_identifiers").select("customer_id").like("value", `%${digits}%`).limit(200) : Promise.resolve({ data: [] }),
    ]);
    ids = [
      ...new Set([
        ...((byName.data ?? []) as { id: string }[]).map((c) => c.id),
        ...((byIdentifier.data ?? []) as { customer_id: string }[]).map((c) => c.customer_id),
      ]),
    ];
    if (ids.length === 0) return [];
  }
  let query = supabase
    .from("customers")
    .select("id, full_name, created_at, cities(name), customer_identifiers(kind, value, is_current), sales(id)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (ids) query = query.in("id", ids);
  const { data } = await query;
  type Raw = { id: string; full_name: string; created_at: string; cities: { name: string }; customer_identifiers: { kind: string; value: string; is_current: boolean }[]; sales: { id: string }[] };
  return ((data ?? []) as unknown as Raw[]).map((c) => {
    const current = (kind: string) => c.customer_identifiers.find((i) => i.kind === kind && i.is_current)?.value ?? null;
    return { id: c.id, full_name: c.full_name, created_at: c.created_at, city: c.cities.name, phone: current("phone"), index: current("index"), sales: c.sales.length };
  });
}
