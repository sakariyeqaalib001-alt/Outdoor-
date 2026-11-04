import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

/** Phase 11 — pilot readiness checks and opening-stock reconciliation (Roadmap Phase 11 gate; R-10, R-11). */
let db: PGlite;

const SA = "b0000000-0000-4000-8000-000000000001";
const TL = "b0000000-0000-4000-8000-000000000002";
const AG = "b0000000-0000-4000-8000-000000000003";
const STK = "b0000000-0000-4000-8000-000000000004";
const FIN = "b0000000-0000-4000-8000-000000000005";

let hargeisa: string;
let router: string;

type Check = { check_key: string; required: boolean; ok: boolean; n: number; detail: string[] };
const call = <T>(user: string | null, sql: string, params: unknown[] = []) =>
  as(db, user ? "authenticated" : "anon", user, () => db.query<T>(sql, params));
const report = async () =>
  Object.fromEntries((await call<Check>(SA, "select * from public.readiness_report($1)", [hargeisa])).rows.map((r) => [r.check_key, r]));
const failing = async () => Object.values(await report()).filter((c) => c.required && !c.ok).map((c) => c.check_key).sort();
type Stock = { code: string; received: number; central: number; teams: number; in_transit: number; issued: number; difference: number };
const stock = async (user = STK) =>
  Object.fromEntries((await call<Stock>(user, "select code, received, central, teams, in_transit, issued, difference from public.opening_stock_summary()")).rows.map((r) => [r.code, r]));

beforeAll(async () => {
  db = await createTestDatabase();
  const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  hargeisa = await one("select id from public.cities where name = 'Hargeisa'");
  router = await one("select id from public.stock_items where code = 'WIFI_ROUTER'");
  for (const [user, role] of [[SA, "super_admin"], [TL, "team_leader"], [AG, "agent"], [STK, "stock_officer"], [FIN, "finance"]] as const) {
    await createUser(db, { id: user, type: role === "agent" ? "temporary" : "permanent", otpVerified: true, fullName: `Test ${role}` });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
    await db.query("update public.user_profiles set city_id = $2 where id = $1", [user, hargeisa]);
  }
}, 60_000);

describe("readiness checks (Roadmap Phase 11)", () => {
  it("an unprepared system fails the required checks and names what is missing", async () => {
    expect(await failing()).toEqual(["agents_ready", "city_districts", "city_teams", "no_test_data", "opening_stock_received"]);
    const r = await report();
    expect(r.products_priced.ok).toBe(true); // the owner's 18 plans are priced (D-34)
    expect(r.agents_ready.detail).toEqual(["Test agent"]);
    expect(r.no_test_data.n).toBeGreaterThanOrEqual(5); // "Test …" names and example.test addresses
    expect(r.super_admins).toMatchObject({ required: false, ok: false, n: 1 }); // advice: two recommended
  });

  it("passes once Settings, teams, people and opening stock are in place", async () => {
    await db.query("update public.user_profiles set full_name = 'Amina ' || substr(id::text, 36, 1)");
    await db.query("update auth.users set email = 'staff-' || substr(id::text, 36, 1) || '@sogasho.so'");
    await db.query("insert into public.districts (city_id, name) values ($1, '26 June')", [hargeisa]);
    const team = (await db.query<{ id: string }>("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL])).rows[0].id;
    await db.query("insert into public.team_members (user_id, team_id) values ($1, $2)", [AG, team]);
    const lines = JSON.stringify([{ item_id: router, quantity: 100 }]);
    await call(STK, "select public.stock_receive($1::jsonb, 'Opening count')", [lines]);
    // PDCOM and CALIX too (every active item is counted).
    for (const code of ["PDCOM", "CALIX"]) {
      const item = (await db.query<{ id: string }>("select id from public.stock_items where code = $1", [code])).rows[0].id;
      await call(STK, "select public.stock_receive($1::jsonb, 'Opening count')", [JSON.stringify([{ item_id: item, quantity: 40 }])]);
    }
    const transfer = (await call<{ id: string }>(STK, "select public.stock_send($1, $2::jsonb, null) as id", [team, JSON.stringify([{ item_id: router, quantity: 30 }])])).rows[0].id;

    expect(await failing()).toEqual(["deliveries_accepted"]); // sent but not yet accepted
    expect((await stock()).WIFI_ROUTER).toMatchObject({ received: 100, central: 70, teams: 0, in_transit: 30, difference: 0 });

    await call(TL, "select public.stock_accept($1)", [transfer]);
    expect(await failing()).toEqual([]);
    const r = await report();
    expect(r.teams_have_stock.ok).toBe(true);
    expect((await stock()).WIFI_ROUTER).toMatchObject({ received: 100, central: 70, teams: 30, in_transit: 0, difference: 0 });
  });

  it("opening stock still reconciles after devices are issued to customers", async () => {
    const loc = (await db.query<{ id: string }>("select l.id from public.stock_locations l join public.teams t on t.id = l.team_id where t.name = 'Team A'")).rows[0].id;
    await db.query("insert into public.stock_movements (movement_type, item_id, quantity, from_location_id, ref_type) values ('issue', $1, 2, $2, 'sale')", [router, loc]);
    expect((await stock()).WIFI_ROUTER).toMatchObject({ received: 100, teams: 28, issued: 2, difference: 0 });
  });

  it("flags a product with no price in force and unsafe Settings", async () => {
    await db.query("update public.plan_prices set effective_to = current_date - 1 where plan_id in (select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'LTE')");
    await db.query("update public.app_settings set value = '25' where key = 'performance_baseline_units'");
    try {
      const r = await report();
      expect(r.products_priced).toMatchObject({ ok: false, detail: ["LTE"] });
      expect(r.settings.ok).toBe(false);
    } finally {
      await db.query("update public.plan_prices set effective_to = null where plan_id in (select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'LTE')");
      await db.query("update public.app_settings set value = '15' where key = 'performance_baseline_units'");
    }
    expect(await failing()).toEqual([]);
  });

  it("flags the SMS code being switched off", async () => {
    await db.query("update public.app_settings set value = 'false' where key = 'otp_enabled'");
    try {
      expect(await failing()).toEqual(["otp_enabled"]);
    } finally {
      await db.query("update public.app_settings set value = 'true' where key = 'otp_enabled'");
    }
  });
});

describe("who may run them", () => {
  it("readiness: Super Admin only (settings.manage)", async () => {
    for (const u of [TL, AG, STK, FIN]) expect(await errorOf(call(u, "select * from public.readiness_report($1)", [hargeisa]))).toMatch(/not allowed/);
    expect(await errorOf(call(null, "select * from public.readiness_report($1)", [hargeisa]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "select * from public.readiness_report($1)", ["00000000-0000-4000-8000-000000000000"]))).toMatch(/NOT_FOUND/);
  });

  it("opening stock: Super Admin, Stock Officer and Finance (stock.read all); not agents or Team Leaders", async () => {
    for (const u of [SA, FIN]) expect((await stock(u)).WIFI_ROUTER.received).toBe(100);
    for (const u of [TL, AG]) expect(await errorOf(stock(u))).toMatch(/not allowed/);
  });

  it("the app functions are not callable through the API", async () => {
    expect(await errorOf(call(SA, "select * from app.readiness_report($1)", [hargeisa]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "select * from app.opening_stock_summary()"))).toMatch(/permission denied/);
  });
});
