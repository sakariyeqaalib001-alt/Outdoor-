import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

let db: PGlite;

const SA = "50000000-0000-4000-8000-000000000001"; // Super Admin
const AG = "50000000-0000-4000-8000-000000000002"; // Sales Agent (code passed)
const FIN = "50000000-0000-4000-8000-000000000003"; // Payroll / Finance
const OFF = "50000000-0000-4000-8000-000000000004"; // deactivated Super Admin

let hargeisa: string;
let burco: string;
let ftth: string;
let plan: string; // FTTH → SO-Home

const asUser = <T>(user: string, fn: () => Promise<T>) => as(db, "authenticated", user, fn);
const call = (user: string, sql: string, params: unknown[] = []) => asUser(user, () => db.query(sql, params));
const one = async <T>(user: string, sql: string, params: unknown[] = []) =>
  ((await asUser(user, () => db.query<T>(sql, params))).rows[0] as T);

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, { id: SA });
  await createUser(db, { id: AG, type: "temporary", otpVerified: true });
  await createUser(db, { id: FIN });
  await createUser(db, { id: OFF, active: false });
  for (const [user, role] of [[SA, "super_admin"], [AG, "agent"], [FIN, "finance"], [OFF, "super_admin"]]) {
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
  }
  hargeisa = (await db.query<{ id: string }>("select id from public.cities where name = 'Hargeisa'")).rows[0].id;
  burco = (await db.query<{ id: string }>("select id from public.cities where name = 'Burco'")).rows[0].id;
  ftth = (await db.query<{ id: string }>("select id from public.products where code = 'FTTH'")).rows[0].id;
  plan = await planId("FTTH", "SO-Home");
}, 60_000);

async function planId(product: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = $1 and pl.name = $2",
    [product, name]
  );
  return rows[0].id;
}

describe("seeded master data (SDD §9)", () => {
  it("has the 16 branches of BRD §6.2.1 in the right cities", async () => {
    const brd = readFileSync(
      path.resolve(import.meta.dirname, "../../docs/01-business/Sogasho_Outdoor_Field_Sales_Audit_System_BRD_v1.5.md"),
      "utf8"
    );
    const expected = [...brd.matchAll(/^\| (Hargeisa|Burco|Borama|Berbera) \(\d+\) \| (.+) \|$/gm)].flatMap((m) =>
      m[2].split(";").map((b) => `${m[1]}:${b.trim()}`)
    );
    const { rows } = await db.query<{ k: string }>(
      "select c.name || ':' || b.name as k from public.branches b join public.cities c on c.id = b.city_id"
    );
    expect(expected).toHaveLength(16);
    expect(rows.map((r) => r.k).sort()).toEqual(expected.sort());
  });

  it("has products FTTA, FTTH, FTTB, LTE with the owner's 18 plans and prices (D-34)", async () => {
    const products = await db.query<{ code: string }>("select code from public.products order by sort_order");
    expect(products.rows.map((r) => r.code)).toEqual(["FTTA", "FTTH", "FTTB", "LTE"]);
    const { rows } = await db.query<{ line: string; installation: string; data: string; from: string; to: string | null }>(`
      select pr.code || ' ' || pl.name || ' ' || pp.recharge_amount || ' ' || pl.download_mbps || '/' || pl.upload_mbps as line,
             pp.installation_fee::text as installation, pl.data_allowance as data,
             pp.effective_from::text as from, pp.effective_to::text as to
      from public.plans pl
      join public.products pr on pr.id = pl.product_id
      join public.plan_prices pp on pp.plan_id = pl.id
      order by pr.sort_order, pl.sort_order`);
    expect(rows.map((r) => r.line)).toEqual([
      "FTTA SO-Premium 150.00 50/50",
      "FTTA SO-Seven Premium 100.00 40/35",
      "FTTA SO-Family 60.00 30/30",
      "FTTA SO-Lite 35.00 16/16",
      "FTTA SO-Ultra 25.00 9/9",
      "FTTA SO-Basic 20.00 6/6",
      "FTTH SO-Prime 60.00 40/40",
      "FTTH SO-Basic 35.00 35/35",
      "FTTH SO-Home 25.00 25/25",
      "FTTH SO-Home Basic 20.00 6/6",
      "FTTB FTTB-210 210.00 60/60",
      "FTTB FTTB-140 140.00 40/40",
      "FTTB FTTB-70 70.00 30/30",
      "FTTB FTTB-40 40.00 20/20",
      "FTTB FTTB-25 25.00 15/15",
      "LTE SO!-Premium 40.00 20/20",
      "LTE SO!-Family 25.00 15/15",
      "LTE SO!-Lite 15.00 8/8",
    ]);
    for (const r of rows) expect([r.installation, r.data, r.from, r.to]).toEqual(["0.00", "Unlimited", "2026-10-22", null]);
  });

  it("has customer types, serialized stock items (PDCOM spelling) and no districts", async () => {
    expect((await db.query<{ code: string }>("select code from public.customer_types order by sort_order")).rows.map((r) => r.code)).toEqual([
      "new",
      "retention",
    ]);
    const items = await db.query<{ code: string; display_name: string; is_serialized: boolean }>(
      "select code, display_name, is_serialized from public.stock_items order by sort_order"
    );
    expect(items.rows).toEqual([
      { code: "WIFI_ROUTER", display_name: "WiFi Router", is_serialized: true },
      { code: "PDCOM", display_name: "PDCOM", is_serialized: true },
      { code: "CALIX", display_name: "CALIX", is_serialized: true },
    ]);
    expect((await db.query("select 1 from public.districts")).rows).toHaveLength(0);
  });

  it("has the business settings with the approved values", async () => {
    const { rows } = await db.query<{ key: string; value: unknown }>("select key, value from public.app_settings");
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(settings).toMatchObject({
      payroll_cutoff_day: 3,
      incentive_threshold: 15,
      incentive_rate: 5,
      temp_base_salary: 100,
      performance_target_units: 20,
      performance_baseline_units: 15,
      free_month_amount: 50,
      allowed_phone_prefixes: ["63", "65"],
      week_start_day: "saturday",
      weekend_days: ["friday"],
      otp_enabled: true,
    });
  });
});

describe("reading master data", () => {
  it.each(["branches", "districts", "customer_types", "products", "plans", "plan_prices", "stock_items", "public_holidays", "app_settings"])(
    "%s is readable by active users only",
    async (table) => {
      expect(await errorOf(call(AG, `select * from public.${table}`))).toBeNull();
      expect((await call(OFF, `select * from public.${table}`)).rows).toHaveLength(0);
      expect(await errorOf(as(db, "anon", null, () => db.query(`select * from public.${table}`)))).toMatch(/permission denied/);
    }
  );

  it.each(["branches", "districts", "customer_types", "products", "plans", "plan_prices", "stock_items", "public_holidays", "app_settings"])(
    "%s cannot be written directly, even by Super Admin",
    async (table) => {
      expect(await errorOf(call(SA, `delete from public.${table}`))).toMatch(/permission denied/);
      expect(await errorOf(call(SA, `update public.${table} set created_by = null`))).toMatch(/permission denied/);
    }
  );
});

describe("maintaining lists (settings.manage)", () => {
  it("lets Super Admin add, rename and deactivate a branch, and logs it", async () => {
    const { id } = await one<{ id: string }>(SA, "select public.admin_save_branch(null, $1, ' Test Branch ', true) as id", [hargeisa]);
    await call(SA, "select public.admin_save_branch($1, $2, 'Renamed Branch', false)", [id, hargeisa]);
    const row = (await db.query<{ name: string; is_active: boolean }>("select name, is_active from public.branches where id = $1", [id])).rows[0];
    expect(row).toEqual({ name: "Renamed Branch", is_active: false });
    const log = await db.query<{ action: string }>("select action from public.activity_log where entity_id = $1 order by occurred_at", [id]);
    expect(log.rows.map((r) => r.action)).toEqual(["branches.create", "branches.update"]);
    const history = await db.query("select 1 from public.change_log where table_name = 'branches' and record_key = $1", [id]);
    expect(history.rows).toHaveLength(2);
  });

  it("refuses a duplicate name in the same city (case-insensitive)", async () => {
    expect(await errorOf(call(SA, "select public.admin_save_branch(null, $1, 'hq', true)", [hargeisa]))).toMatch(/NAME_TAKEN/);
    await call(SA, "select public.admin_save_district(null, $1, 'Ga''an Libah', true)", [hargeisa]);
    expect(await errorOf(call(SA, "select public.admin_save_district(null, $1, 'GA''AN LIBAH', true)", [hargeisa]))).toMatch(/NAME_TAKEN/);
    expect(await errorOf(call(SA, "select public.admin_save_district(null, $1, 'Ga''an Libah', true)", [burco]))).toBeNull();
  });

  it("lets Super Admin rename customer types and stock items but not change their codes", async () => {
    await call(SA, "select public.admin_rename_customer_type('retention', 'Retention (returning)')");
    expect((await db.query<{ name: string }>("select name from public.customer_types where code = 'retention'")).rows[0].name).toBe(
      "Retention (returning)"
    );
    expect(await errorOf(call(SA, "select public.admin_rename_customer_type('upgrade', 'Upgrade')"))).toMatch(/NOT_FOUND/);
    const item = (await db.query<{ id: string }>("select id from public.stock_items where code = 'PDCOM'")).rows[0].id;
    await call(SA, "select public.admin_save_stock_item($1, 'PDCOM unit', true)", [item]);
    expect((await db.query<{ code: string }>("select code from public.stock_items where id = $1", [item])).rows[0].code).toBe("PDCOM");
  });

  it("adds, edits and deletes public holidays; one per date", async () => {
    const { id } = await one<{ id: string }>(SA, "select public.admin_save_holiday(null, '2026-05-18', 'Independence Day') as id");
    expect(await errorOf(call(SA, "select public.admin_save_holiday(null, '2026-05-18', 'Again')"))).toMatch(/DATE_TAKEN/);
    await call(SA, "select public.admin_delete_holiday($1)", [id]);
    expect((await db.query("select 1 from public.public_holidays where id = $1", [id])).rows).toHaveLength(0);
  });

  it.each([
    ["admin_save_branch(null, '00000000-0000-0000-0000-000000000000', 'X branch', true)"],
    ["admin_save_district(null, '00000000-0000-0000-0000-000000000000', 'X district', true)"],
    ["admin_rename_customer_type('new', 'Fresh')"],
    ["admin_save_stock_item('00000000-0000-0000-0000-000000000000', 'X', true)"],
    ["admin_save_holiday(null, '2026-12-25', 'X day')"],
    ["admin_delete_holiday('00000000-0000-0000-0000-000000000000')"],
    ["admin_set_setting('incentive_rate', '6')"],
    ["admin_save_product(null, 'FTTX', 'FTTX', true)"],
    ["admin_save_plan(null, '00000000-0000-0000-0000-000000000000', 'X plan', 10, 10, 'Unlimited', true)"],
    ["admin_save_plan_price(null, '00000000-0000-0000-0000-000000000000', 10, 0, '2026-01-01', null)"],
  ])("%s is refused for an agent, Finance and a deactivated Super Admin", async (fn) => {
    for (const user of [AG, FIN, OFF]) {
      expect(await errorOf(call(user, `select public.${fn}`)), user).toMatch(/not allowed/);
    }
    expect(await errorOf(as(db, "anon", null, () => db.query(`select public.${fn}`)))).toMatch(/permission denied/);
  });
});

describe("settings (admin_set_setting)", () => {
  const setting = async (key: string) =>
    (await db.query<{ value: unknown }>("select value from public.app_settings where key = $1", [key])).rows[0].value;
  const set = (key: string, value: unknown) => call(SA, "select public.admin_set_setting($1, $2::jsonb)", [key, JSON.stringify(value)]);

  it("saves valid values and logs before/after", async () => {
    await set("temp_base_salary", 120.5);
    expect(await setting("temp_base_salary")).toBe(120.5);
    const log = await db.query<{ details: { key: string; before: unknown; after: unknown } }>(
      "select details from public.activity_log where action = 'settings.update' and details ->> 'key' = 'temp_base_salary'"
    );
    expect(log.rows[0].details).toMatchObject({ before: 100, after: 120.5 });
    await set("temp_base_salary", 100);
    await set("allowed_phone_prefixes", ["63", "65", "66"]);
    expect(await setting("allowed_phone_prefixes")).toEqual(["63", "65", "66"]);
    await set("allowed_phone_prefixes", ["63", "65"]);
  });

  it.each([
    ["payroll_cutoff_day", 0],
    ["payroll_cutoff_day", 2.5],
    ["incentive_rate", -1],
    ["incentive_rate", 1.234],
    ["temp_base_salary", "100"],
    ["allowed_phone_prefixes", ["063"]],
    ["allowed_phone_prefixes", ["63", "63"]],
    ["week_start_day", "someday"],
    ["weekend_days", ["friday", "funday"]],
    ["otp_enabled", "yes"],
  ])("refuses %s = %j", async (key, value) => {
    expect(await errorOf(set(key, value))).toMatch(/INVALID_SETTING/);
  });

  it("refuses unknown keys and keeps baseline below target", async () => {
    expect(await errorOf(set("new_key", 1))).toMatch(/UNKNOWN_SETTING/);
    expect(await errorOf(set("performance_baseline_units", 20))).toMatch(/BAND_ORDER/);
    expect(await errorOf(set("performance_target_units", 15))).toMatch(/BAND_ORDER/);
    await set("performance_target_units", 25);
    await set("performance_baseline_units", 18);
    expect([await setting("performance_target_units"), await setting("performance_baseline_units")]).toEqual([25, 18]);
    await set("performance_baseline_units", 15);
    await set("performance_target_units", 20);
  });
});

describe("products, plans and prices (prices.manage, D-34)", () => {
  const savePrice = (recharge: number, from: string, to: string | null, id: string | null = null, installation = 0, forPlan = plan) =>
    one<{ id: string }>(SA, "select public.admin_save_plan_price($1, $2, $3, $4, $5, $6) as id", [id, forPlan, recharge, installation, from, to]);
  const priceOn = async (on: string, user = AG, forPlan = plan) =>
    (
      await asUser(user, () =>
        db.query<{ recharge_amount: string; installation_fee: string }>("select * from public.plan_price($1, $2)", [forPlan, on])
      )
    ).rows[0] ?? null;

  it("adds a product with a fixed code", async () => {
    const { id } = await one<{ id: string }>(SA, "select public.admin_save_product(null, 'fttx', 'Fibre X', true) as id");
    await call(SA, "select public.admin_save_product($1, 'IGNORED', 'Fibre X2', false)", [id]);
    const row = (await db.query<{ code: string; name: string; is_active: boolean }>("select code, name, is_active from public.products where id = $1", [id]))
      .rows[0];
    expect(row).toEqual({ code: "FTTX", name: "Fibre X2", is_active: false });
    expect(await errorOf(call(SA, "select public.admin_save_product(null, 'FTTH', 'Duplicate', true)"))).toMatch(/NAME_TAKEN/);
    expect(await errorOf(call(SA, "select public.admin_save_plan(null, $1, 'X plan', 10, 10, 'Unlimited', true)", [id]))).toMatch(/PRODUCT_INACTIVE/);
  });

  it("adds and edits plans; names are unique within a product only; the product never changes", async () => {
    expect(await errorOf(call(SA, "select public.admin_save_plan(null, $1, 'so-home', 5, 5, '', true)", [ftth]))).toMatch(/NAME_TAKEN/);
    const lte = (await db.query<{ id: string }>("select id from public.products where code = 'LTE'")).rows[0].id;
    const { id } = await one<{ id: string }>(SA, "select public.admin_save_plan(null, $1, 'SO-Home', 5, 5, '', true) as id", [lte]);
    await call(SA, "select public.admin_save_plan($1, $2, 'SO!-Home', 6, 6, '100 GB', false)", [id, ftth]);
    const row = (
      await db.query<{ product_id: string; name: string; data_allowance: string; is_active: boolean }>(
        "select product_id, name, data_allowance, is_active from public.plans where id = $1",
        [id]
      )
    ).rows[0];
    expect(row).toEqual({ product_id: lte, name: "SO!-Home", data_allowance: "100 GB", is_active: false });
    expect(await errorOf(call(SA, "select public.admin_save_plan(null, $1, 'Zero', 0, 5, '', true)", [lte]))).toMatch(/INVALID_PLAN/);
    expect(await errorOf(savePrice(10, "2030-01-01", null, null, 0, id))).toMatch(/PLAN_INACTIVE/);
  });

  it("returns the recharge and installation fee in force on a date", async () => {
    expect(await priceOn("2026-10-21")).toBeNull();
    expect(await priceOn("2026-10-22")).toEqual({ recharge_amount: "25.00", installation_fee: "0.00" });
    expect(await priceOn("2030-01-01")).toEqual({ recharge_amount: "25.00", installation_fee: "0.00" });
  });

  it("refuses overlapping dates for the same plan", async () => {
    expect(await errorOf(savePrice(30, "2027-01-01", null))).toMatch(/PRICE_OVERLAP/);
    expect(await errorOf(savePrice(70, "2027-01-01", null, null, 0, await planId("FTTH", "SO-Prime")))).toMatch(/PRICE_OVERLAP/);
  });

  it("changes a price by ending the old one and starting a new one; old dates keep the old price", async () => {
    const current = (await db.query<{ id: string }>("select id from public.plan_prices where plan_id = $1", [plan])).rows[0].id;
    await savePrice(25, "2026-10-22", "2026-12-31", current);
    await savePrice(28, "2027-01-01", null, null, 5);
    expect(await priceOn("2026-12-31")).toEqual({ recharge_amount: "25.00", installation_fee: "0.00" });
    expect(await priceOn("2027-01-01")).toEqual({ recharge_amount: "28.00", installation_fee: "5.00" });
    const log = await db.query<{ action: string }>("select action from public.activity_log where entity_type = 'plan_prices' order by occurred_at");
    expect(log.rows.map((r) => r.action)).toEqual(["plan_prices.update", "plan_prices.create"]);
  });

  it("refuses invalid amounts and dates", async () => {
    expect(await errorOf(savePrice(0, "2031-01-01", null))).toMatch(/INVALID_PRICE/);
    expect(await errorOf(savePrice(10.555, "2031-01-01", null))).toMatch(/INVALID_PRICE/);
    expect(await errorOf(savePrice(10, "2031-01-01", null, null, -1))).toMatch(/INVALID_PRICE/);
    expect(await errorOf(savePrice(10, "2031-02-01", "2031-01-01"))).toMatch(/INVALID_DATES/);
  });

  it("is hidden from deactivated users", async () => {
    expect(await priceOn("2026-12-01", OFF)).toBeNull();
    expect((await call(OFF, "select * from public.plans")).rows).toHaveLength(0);
  });
});
