import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

/**
 * Phase 10 — eligible-sale rule, dashboard totals and scope (Roadmap Phase 10 gate; BRD §8.2, §9.1; D-42).
 * Fixture sales are inserted directly (triggers off) at dates relative to the current EAT month, so every
 * expected total below is counted by hand from the table in beforeAll.
 */
let db: PGlite;

const SA = "a0000000-0000-4000-8000-000000000001"; // Super Admin
const TL = "a0000000-0000-4000-8000-000000000002"; // leads Team A (Hargeisa), also sells
const AG1 = "a0000000-0000-4000-8000-000000000003"; // agent, Team A
const AG2 = "a0000000-0000-4000-8000-000000000004"; // agent, Team A
const TL2 = "a0000000-0000-4000-8000-000000000005"; // leads Team B (Berbera)
const AG3 = "a0000000-0000-4000-8000-000000000006"; // agent, Team B
const AG4 = "a0000000-0000-4000-8000-000000000007"; // inactive agent, Team A (no target)
const FIN = "a0000000-0000-4000-8000-000000000008"; // Finance
const AUD = "a0000000-0000-4000-8000-000000000009"; // Auditor
const STK = "a0000000-0000-4000-8000-00000000000a"; // Stock Officer

const ids: Record<string, string> = {};
const sale: Record<string, string> = {};

type Figure = { bucket: string; dim: string; key: string | null; label: string | null; parent: string | null; units: number; revenue: string; new_units: number; retention_units: number; on_hold_units: number };

const call = <T>(user: string | null, sql: string, params: unknown[] = []) =>
  as(db, user ? "authenticated" : "anon", user, () => db.query<T>(sql, params));
const figures = async (user: string, p: Record<string, unknown> = {}) =>
  (await call<Figure>(user, "select * from public.dashboard_figures($1::jsonb)", [JSON.stringify(p)])).rows;
const pick = (rows: Figure[], bucket: string, dim = "total", key: string | null = null) =>
  rows.find((r) => r.bucket === bucket && r.dim === dim && (dim === "total" || r.key === key));
const units = (rows: Figure[], bucket: string, dim = "total", key: string | null = null) => pick(rows, bucket, dim, key)?.units ?? 0;
const revenue = (rows: Figure[], bucket: string, dim = "total", key: string | null = null) => Number(pick(rows, bucket, dim, key)?.revenue ?? 0);

// Timestamps relative to the current business month (EAT): cur(day, "HH:MM:SS") / prev(day, ...).
const EAT = "Africa/Mogadishu";
const at = (monthExpr: string, day: number, time = "10:00:00") =>
  `((${monthExpr} + interval '${day - 1} days' + time '${time}') at time zone '${EAT}')`;
const CUR = `date_trunc('month', now() at time zone '${EAT}')`;
const PREV = `(date_trunc('month', now() at time zone '${EAT}') - interval '1 month')`;
const cur = (day: number, time?: string) => at(CUR, day, time);
const prev = (day: number, time?: string) => at(PREV, day, time);

async function insertSale(key: string, o: {
  agent: string; team: string; city: string; branch: string; product: string; type: "new" | "retention";
  amount: number; status: string; submitted: string; approved?: string;
}) {
  const customer = (await db.query<{ id: string }>(
    "insert into public.customers (full_name, city_id, created_by) values ('Test Customer', $1, $2) returning id", [ids[o.city], o.agent])).rows[0].id;
  const r = await db.query<{ id: string }>(
    `insert into public.sales (client_request_id, customer_id, customer_name, agent_id, team_id, customer_type, product_id, plan_id,
       plan_price_id, unit_price, installation_fee, months_paid, amount_collected, city_id, district_id, area_text, branch_id, status,
       submitted_at, approved_at, approved_by)
     values ($1, $2, 'Test Customer', $3, $4, $5, $6, $7, $8, $9, 0, 1, $9, $10, $11, 'Market', $12, $13,
       ${o.submitted}, ${o.approved ?? "null"}, ${o.approved ? `'${SA}'` : "null"}) returning id`,
    [randomUUID(), customer, o.agent, ids[o.team], o.type, ids[o.product], ids[`plan_${o.product}`], ids[`price_${o.product}`], o.amount,
      ids[o.city], ids[`district_${o.city}`], ids[o.branch], o.status]);
  sale[key] = r.rows[0].id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  ids.hargeisa = await one("select id from public.cities where name = 'Hargeisa'");
  ids.berbera = await one("select id from public.cities where name = 'Berbera'");
  ids.hq = await one("select id from public.branches where name = 'HQ' and city_id = $1", [ids.hargeisa]);
  ids.berberaBranch = await one("select id from public.branches where city_id = $1 order by name limit 1", [ids.berbera]);
  ids.district_hargeisa = await one("insert into public.districts (city_id, name) values ($1, '26 June') returning id", [ids.hargeisa]);
  ids.district_berbera = await one("insert into public.districts (city_id, name) values ($1, 'Port') returning id", [ids.berbera]);
  for (const code of ["FTTA", "FTTH", "FTTB", "LTE"]) {
    ids[code] = await one("select id from public.products where code = $1", [code]);
    const r = (await db.query<{ plan: string; price: string }>(
      "select pl.id as plan, pp.id as price from public.plans pl join public.plan_prices pp on pp.plan_id = pl.id where pl.product_id = $1 limit 1",
      [ids[code]])).rows[0];
    ids[`plan_${code}`] = r.plan;
    ids[`price_${code}`] = r.price;
  }
  for (const [user, role, city] of [
    [SA, "super_admin", "hargeisa"], [TL, "team_leader", "hargeisa"], [AG1, "agent", "hargeisa"], [AG2, "agent", "hargeisa"],
    [TL2, "team_leader", "berbera"], [AG3, "agent", "berbera"], [AG4, "agent", "hargeisa"], [FIN, "finance", "hargeisa"],
    [AUD, "auditor", "hargeisa"], [STK, "stock_officer", "hargeisa"],
  ] as const) {
    await createUser(db, { id: user, type: role === "agent" ? "temporary" : "permanent", otpVerified: true, fullName: `Person ${user.slice(-1)}` });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
    await db.query("update public.user_profiles set city_id = $2 where id = $1", [user, ids[city]]);
  }
  ids.teamA = await one("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [ids.hargeisa, TL]);
  ids.teamB = await one("insert into public.teams (name, city_id, team_leader_id) values ('Team B', $1, $2) returning id", [ids.berbera, TL2]);
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $4), ($2, $4), ($3, $4), ($5, $6)", [AG1, AG2, AG4, ids.teamA, AG3, ids.teamB]);

  await db.exec("set session_replication_role = replica");
  const A = { team: "teamA", city: "hargeisa", branch: "hq" } as const;
  // key   agent  product type         $   status              submitted        approved
  await insertSale("S1", { ...A, agent: AG1, product: "FTTA", type: "new", amount: 25, status: "approved", submitted: cur(1), approved: cur(1, "11:00:00") });
  await insertSale("S2", { ...A, branch: "berberaBranch", agent: AG1, product: "FTTH", type: "retention", amount: 30, status: "approved", submitted: cur(1), approved: cur(1, "11:00:00") });
  await insertSale("S3", { ...A, agent: AG2, product: "FTTB", type: "new", amount: 40, status: "approved", submitted: prev(15), approved: prev(16) });
  await insertSale("S4", { ...A, agent: AG2, product: "LTE", type: "new", amount: 20, status: "approved", submitted: prev(28), approved: cur(3, "23:59:59") });
  await insertSale("S5", { ...A, agent: AG2, product: "FTTA", type: "new", amount: 25, status: "approved", submitted: prev(28), approved: cur(4, "00:00:00") });
  await insertSale("S6", { ...A, agent: AG1, product: "FTTA", type: "new", amount: 25, status: "pending_approval", submitted: cur(1) });
  await insertSale("S7", { ...A, agent: AG1, product: "FTTA", type: "new", amount: 25, status: "rejected", submitted: cur(1) });
  await insertSale("S8", { ...A, agent: AG1, product: "FTTA", type: "new", amount: 25, status: "reversed", submitted: cur(1), approved: cur(1, "11:00:00") });
  await insertSale("S9", { ...A, agent: AG2, product: "FTTH", type: "new", amount: 30, status: "approved", submitted: cur(1), approved: cur(1, "11:00:00") });
  await insertSale("S10", { team: "teamB", city: "berbera", branch: "berberaBranch", agent: AG3, product: "FTTA", type: "retention", amount: 25, status: "approved", submitted: cur(1), approved: cur(1, "11:00:00") });
  await insertSale("S11", { ...A, agent: TL, product: "FTTH", type: "new", amount: 30, status: "approved", submitted: "now()", approved: "now()" });
  await insertSale("S12", { ...A, agent: AG1, product: "LTE", type: "new", amount: 20, status: "approved", submitted: cur(1), approved: cur(1, "11:00:00") });

  // Stock: 100 routers received; one device issued per approved sale S1, S5 (Team A), S10 (Team B) and S2 (PDCOM, Team A).
  for (const code of ["WIFI_ROUTER", "PDCOM", "CALIX"]) ids[code] = await one("select id from public.stock_items where code = $1", [code]);
  const central = await one("select id from public.stock_locations where kind = 'central'");
  const locA = await one("select id from public.stock_locations where team_id = $1", [ids.teamA]);
  const locB = await one("select id from public.stock_locations where team_id = $1", [ids.teamB]);
  await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('receipt', $1, 100, $2)", [ids.WIFI_ROUTER, central]);
  for (const [s, item, loc] of [["S1", "WIFI_ROUTER", locA], ["S5", "WIFI_ROUTER", locA], ["S10", "WIFI_ROUTER", locB], ["S2", "PDCOM", locA]]) {
    await db.query("insert into public.stock_movements (movement_type, item_id, quantity, from_location_id, ref_type, ref_id) values ('issue', $1, 1, $2, 'sale', $3)",
      [ids[item], loc, sale[s]]);
  }
  // Two duplicate attempts this period (events only; the case trigger is off here).
  await db.query("insert into public.audit_events (rule_code, actor_id) values ('DUP_PHONE', $1), ('DUP_INDEX', $1)", [AG1]);
  await db.exec("set session_replication_role = origin");

  // S9: Confirmed issue (ineligible). S12: open case → on hold (the case also links its agent AG1).
  for (const [s, steps] of [["S9", ["under_review", "confirmed_issue"]], ["S12", []]] as const) {
    const c = (await call<{ id: string }>(SA, "select public.audit_case_create('Check sale', 'Opened for the test', $1) as id", [sale[s]])).rows[0].id;
    ids[`case_${s}`] = c;
    for (const step of steps) await call(SA, "select public.audit_case_set_status($1, $2, 'Checked')", [c, step]);
  }
  await db.query("update public.user_profiles set is_active = false where id = $1", [AG4]);
}, 120_000);

describe("eligible-sale rule (BRD §8.2, SDD §14.1)", () => {
  const eligible = async () => (await db.query<{ sale_id: string; counting_month: string; on_hold: boolean }>(
    "select sale_id, to_char(counting_month, 'YYYY-MM-DD') as counting_month, on_hold from app.eligible_sale_facts()")).rows;
  const month = async (expr: string) => (await db.query<{ m: string }>(`select to_char(${expr}, 'YYYY-MM-DD') as m`)).rows[0].m;

  it("counts only approved sales: pending, rejected and reversed never count", async () => {
    const keys = (await eligible()).map((r) => Object.keys(sale).find((k) => sale[k] === r.sale_id));
    for (const out of ["S6", "S7", "S8"]) expect(keys).not.toContain(out);
  });

  it("excludes a sale linked to a Confirmed-issue case and keeps an on-hold sale (flagged)", async () => {
    const rows = await eligible();
    expect(rows.find((r) => r.sale_id === sale.S9)).toBeUndefined();
    expect(rows.find((r) => r.sale_id === sale.S12)?.on_hold).toBe(true);
    expect(rows.find((r) => r.sale_id === sale.S1)?.on_hold).toBe(true); // same agent → agent on hold
    expect(rows.find((r) => r.sale_id === sale.S10)?.on_hold).toBe(false);
  });

  it("is a sale, never a product switch (switches are not in the sales table)", async () => {
    expect((await eligible()).length).toBe(8);
  });

  it("counts in the sale month when approved by the end of the cutoff day (3rd), else in the approval month", async () => {
    const rows = await eligible();
    const p = await month(PREV);
    const c = await month(CUR);
    expect(rows.find((r) => r.sale_id === sale.S3)?.counting_month).toBe(p); // approved in its own month
    expect(rows.find((r) => r.sale_id === sale.S4)?.counting_month).toBe(p); // approved 3rd 23:59:59 EAT
    expect(rows.find((r) => r.sale_id === sale.S5)?.counting_month).toBe(c); // approved 4th 00:00 EAT
  });

  it("follows the payroll cutoff day in Settings", async () => {
    await db.query("update public.app_settings set value = '5' where key = 'payroll_cutoff_day'");
    try {
      expect((await eligible()).find((r) => r.sale_id === sale.S5)?.counting_month).toBe(await month(PREV));
    } finally {
      await db.query("update public.app_settings set value = '3' where key = 'payroll_cutoff_day'");
    }
  });

  it("app.eligible_sales(month) returns exactly one month", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from app.eligible_sales((${PREV})::date)`);
    expect(r.rows[0].n).toBe(2);
  });
});

describe("totals reconcile with the fixtures (Roadmap Phase 10 gate)", () => {
  let all: Figure[];
  beforeAll(async () => { all = await figures(FIN); });

  it("this month, last month and overall", () => {
    // This month: S1 25 + S2 30 + S5 25 + S10 25 + S11 30 + S12 20.
    expect(pick(all, "month")).toMatchObject({ units: 6, new_units: 4, retention_units: 2, on_hold_units: 3 });
    expect(revenue(all, "month")).toBe(155);
    expect(units(all, "last_month")).toBe(2); // S3, S4
    expect(revenue(all, "last_month")).toBe(60);
    expect(units(all, "overall")).toBe(8);
    expect(revenue(all, "overall")).toBe(215);
  });

  it("submitted and waiting for approval are kept apart from eligible", () => {
    expect(units(all, "pending")).toBe(1); // S6
    expect(units(all, "submitted_month")).toBe(7); // S1 S2 S6 S9 S10 S11 S12
  });

  it("products, New + Retention and cities add up to the total", () => {
    for (const bucket of ["overall", "month"]) {
      const total = pick(all, bucket)!;
      const byProduct = all.filter((r) => r.bucket === bucket && r.dim === "product");
      const byCity = all.filter((r) => r.bucket === bucket && r.dim === "city");
      expect(byProduct.reduce((s, r) => s + r.units, 0)).toBe(total.units);
      expect(byProduct.reduce((s, r) => s + Number(r.revenue), 0)).toBe(Number(total.revenue));
      expect(byCity.reduce((s, r) => s + r.units, 0)).toBe(total.units);
      expect(total.new_units + total.retention_units).toBe(total.units);
    }
    expect(units(all, "month", "product", ids.FTTA)).toBe(3);
    expect(units(all, "month", "product", ids.FTTH)).toBe(2);
    expect(units(all, "month", "product", ids.LTE)).toBe(1);
    expect(units(all, "month", "product", ids.FTTB)).toBe(0);
    expect(pick(all, "month", "product", ids.FTTA)?.label).toBe("FTTA");
    expect(units(all, "month", "city", ids.hargeisa)).toBe(5);
    expect(revenue(all, "month", "city", ids.hargeisa)).toBe(130);
    expect(units(all, "month", "city", ids.berbera)).toBe(1);
  });

  it("branches are where money is handed in (S2: Hargeisa sale, Berbera branch)", () => {
    expect(units(all, "month", "branch", ids.hq)).toBe(4);
    expect(units(all, "month", "branch", ids.berberaBranch)).toBe(2);
    expect(pick(all, "month", "branch", ids.berberaBranch)?.parent).toBe(ids.berbera);
  });

  it("per agent, including a Team Leader who sells", () => {
    expect(units(all, "month", "agent", AG1)).toBe(3);
    expect(units(all, "month", "agent", TL)).toBe(1);
  });

  it("filters narrow every figure the same way", async () => {
    const h = await figures(FIN, { city_id: ids.hargeisa });
    expect(units(h, "month")).toBe(5);
    expect(units(h, "month", "city", ids.berbera)).toBe(0);
    const f = await figures(FIN, { product_id: ids.FTTA });
    expect(units(f, "overall")).toBe(3);
    const b = await figures(FIN, { branch_id: ids.berberaBranch });
    expect(units(b, "month")).toBe(2);
    const a = await figures(FIN, { agent_id: AG2 });
    expect(units(a, "overall")).toBe(3); // S3 S4 S5 (S9 confirmed issue)
    expect(await errorOf(figures(FIN, { city_id: "not-a-uuid" }))).toMatch(/FILTER_INVALID/);
  });
});

describe("reporting periods", () => {
  it("previous month uses the eligible rule; year to date covers this year's counting months", async () => {
    expect(units(await figures(FIN, { period: "prev_month" }), "period")).toBe(2);
    const sameYear = (await db.query<{ y: boolean }>(`select extract(year from ${PREV}) = extract(year from ${CUR}) as y`)).rows[0].y;
    expect(units(await figures(FIN, { period: "ytd" }), "period")).toBe(sameYear ? 8 : 6);
    expect(units(await figures(FIN, { period: "month" }), "period")).toBe(6);
  });

  it("today and custom ranges count approved sales by submission date", async () => {
    const firstDay = (await db.query<{ f: boolean }>(`select (now() at time zone '${EAT}')::date = (${CUR})::date as f`)).rows[0].f;
    expect(units(await figures(FIN, { period: "today" }), "period")).toBe(firstDay ? 5 : 1); // S11 (+ S1 S2 S10 S12 on the 1st)
    const from = (await db.query<{ d: string }>(`select to_char(${PREV}, 'YYYY-MM-DD') as d`)).rows[0].d;
    const to = (await db.query<{ d: string }>(`select to_char(now() at time zone '${EAT}', 'YYYY-MM-DD') as d`)).rows[0].d;
    const r = await figures(FIN, { period: "custom", from, to });
    expect(units(r, "period")).toBe(8);
    expect(units(r, "submitted_period")).toBe(10); // + S6 pending, S9 approved (confirmed issue)
  });

  it("this week starts on Saturday (Settings, D-33)", async () => {
    const r = (await call<{ c: { from_date: string; to_date: string; basis: string } }>(FIN, "select public.dashboard_context('{\"period\":\"week\"}') as c")).rows[0].c;
    const dow = (await db.query<{ d: number }>("select extract(dow from $1::date)::int as d", [r.from_date])).rows[0].d;
    expect(dow).toBe(6);
    expect(r.basis).toBe("date");
  });

  it("rejects a bad custom range", async () => {
    for (const p of [{ period: "custom", from: "2026-10-10", to: "2026-10-01" }, { period: "custom", from: "x", to: "y" }, { period: "custom", from: "2026-01-01", to: "2999-01-01" }, { period: "never" }]) {
      expect(await errorOf(figures(FIN, p))).toMatch(/PERIOD_INVALID/);
    }
  });
});

describe("trend, people and targets (D-42)", () => {
  it("monthly trend uses counting months", async () => {
    const t = (await call<{ month: string; dim: string; units: number }>(FIN, "select to_char(month, 'YYYY-MM-DD') as month, dim, units from public.dashboard_trend('{}', 12)")).rows;
    const c = (await db.query<{ m: string }>(`select to_char(${CUR}, 'YYYY-MM-DD') as m`)).rows[0].m;
    expect(t.find((r) => r.dim === "total" && r.month === c)?.units).toBe(6);
    expect(t.filter((r) => r.dim === "total").reduce((s, r) => s + r.units, 0)).toBe(8);
    expect(t.filter((r) => r.dim === "product").reduce((s, r) => s + r.units, 0)).toBe(8);
  });

  it("people with a target: active Sales Agents and Team Leaders, in their city", async () => {
    const people = (await call<{ user_id: string; city_id: string; is_team_leader: boolean }>(FIN, "select user_id, city_id, is_team_leader from public.dashboard_people('{}')")).rows;
    const inCity = (city: string) => people.filter((p) => p.city_id === ids[city]).map((p) => p.user_id).sort();
    expect(inCity("hargeisa")).toEqual([TL, AG1, AG2].sort()); // AG4 inactive; Super Admin, Finance… carry no target
    expect(inCity("berbera")).toEqual([TL2, AG3].sort());
    expect(people.find((p) => p.user_id === TL)?.is_team_leader).toBe(true);
    const ctx = (await call<{ c: { target_units: number; baseline_units: number } }>(FIN, "select public.dashboard_context('{}') as c")).rows[0].c;
    expect(ctx).toMatchObject({ target_units: 20, baseline_units: 15 });
  });
});

describe("who sees what (scope, D-42)", () => {
  it("an agent sees only their own sales", async () => {
    const r = await figures(AG1);
    expect(units(r, "month")).toBe(3); // S1 S2 S12
    expect(units(await figures(AG1, { agent_id: AG2 }), "overall")).toBe(0);
    expect((await call<{ user_id: string }>(AG1, "select user_id from public.dashboard_people('{}')")).rows.map((p) => p.user_id)).toEqual([AG1]);
    expect((await call(AG1, "select * from public.dashboard_sales_list('{}', 'month')")).rows).toHaveLength(3);
  });

  it("a Team Leader sees their team (and own sales), not another team", async () => {
    const r = await figures(TL);
    expect(units(r, "month")).toBe(5); // S1 S2 S5 S11 S12
    expect(units(r, "month", "city", ids.berbera)).toBe(0);
    const people = (await call<{ user_id: string }>(TL, "select user_id from public.dashboard_people('{}')")).rows.map((p) => p.user_id).sort();
    expect(people).toEqual([TL, AG1, AG2].sort());
  });

  it("Super Admin, Finance and Auditor see everything", async () => {
    for (const u of [SA, FIN, AUD]) expect(units(await figures(u), "month")).toBe(6);
  });

  it("a Stock Officer has no sales dashboard; anonymous and inactive users are refused", async () => {
    expect(await errorOf(figures(STK))).toMatch(/not allowed/);
    expect(await errorOf(call(null, "select * from public.dashboard_figures('{}')"))).toMatch(/permission denied/);
    await db.query("update public.user_profiles set is_active = false where id = $1", [AG2]);
    try {
      expect(await errorOf(figures(AG2))).toMatch(/not allowed/);
    } finally {
      await db.query("update public.user_profiles set is_active = true where id = $1", [AG2]);
    }
    const access = (await call<{ a: { permissions: Record<string, string> } }>(STK, "select public.my_access() as a")).rows[0].a;
    expect(access.permissions["dashboard.read"]).toBeUndefined();
  });

  it("the internal eligible-sale functions cannot be called directly", async () => {
    expect(await errorOf(call(FIN, "select * from app.eligible_sale_facts()"))).toMatch(/permission denied/);
    expect(await errorOf(call(FIN, "select * from app.dashboard_facts('{}')"))).toMatch(/permission denied/);
  });

  it("the sales behind a figure follow the same buckets", async () => {
    const list = (await call<{ sale_id: string }>(FIN, "select sale_id from public.dashboard_sales_list($1, 'month')", [JSON.stringify({ city_id: ids.berbera })])).rows;
    expect(list.map((r) => r.sale_id)).toEqual([sale.S10]);
    expect((await call(FIN, "select * from public.dashboard_sales_list('{}', 'pending')")).rows).toHaveLength(1);
    expect(await errorOf(call(FIN, "select * from public.dashboard_sales_list('{}', 'everything')"))).toMatch(/BUCKET_INVALID/);
  });

  it("Team Leaders can no longer sell in another city (sales.override_city removed)", async () => {
    const access = (await call<{ a: { permissions: Record<string, string> } }>(TL, "select public.my_access() as a")).rows[0].a;
    expect(access.permissions["sales.override_city"]).toBeUndefined();
    const input = {
      client_request_id: randomUUID(), customer_type: "new", full_name: "Amina Yusuf", phone: "0634445566", index: "81234567",
      city_id: ids.berbera, district_id: ids.district_berbera, area: "Port", branch_id: ids.berberaBranch, plan_id: ids.plan_FTTA,
      months_paid: 1, free_month: false,
    };
    expect(await errorOf(call(TL, "select public.create_sale($1::jsonb)", [JSON.stringify(input)]))).toMatch(/CITY_OVERRIDE/);
  });
});

describe("operations: stock and audit figures", () => {
  type Stock = { code: string; received: number | null; issued: number };
  const stock = async (user: string, p: Record<string, unknown> = {}) =>
    Object.fromEntries((await call<Stock>(user, "select code, received, issued from public.dashboard_stock($1::jsonb)", [JSON.stringify(p)])).rows.map((r) => [r.code, r]));

  it("Stock Officer, Finance and Super Admin see received and issued for every device", async () => {
    for (const u of [STK, FIN, SA]) {
      const s = await stock(u);
      expect(s.WIFI_ROUTER).toEqual({ code: "WIFI_ROUTER", received: 100, issued: 3 });
      expect(s.PDCOM).toEqual({ code: "PDCOM", received: 0, issued: 1 });
      expect(s.CALIX).toEqual({ code: "CALIX", received: 0, issued: 0 });
    }
  });

  it("a Team Leader sees their team's issued devices and no company-wide received total", async () => {
    const s = await stock(TL);
    expect(s.WIFI_ROUTER).toEqual({ code: "WIFI_ROUTER", received: null, issued: 2 });
    expect(s.PDCOM.issued).toBe(1);
  });

  it("issued follows the city, branch and agent filters through the sale", async () => {
    expect((await stock(FIN, { city_id: ids.berbera })).WIFI_ROUTER.issued).toBe(1);
    const b = await stock(FIN, { branch_id: ids.berberaBranch });
    expect([b.WIFI_ROUTER.issued, b.PDCOM.issued]).toEqual([1, 1]);
    expect((await stock(FIN, { agent_id: AG2 })).WIFI_ROUTER.issued).toBe(1);
  });

  it("agents get no stock figures", async () => {
    expect(await errorOf(stock(AG1))).toMatch(/not allowed/);
  });

  it("audit figures for audit readers only", async () => {
    const a = (await call<{ a: Record<string, number> }>(AUD, "select public.dashboard_audit('{}') as a")).rows[0].a;
    expect(a).toEqual({ duplicate_attempts: 2, open_cases: 1, older_than_7_days: 0 });
    for (const u of [FIN, TL, AG1, STK]) expect(await errorOf(call(u, "select public.dashboard_audit('{}')"))).toMatch(/not allowed/);
  });
});
