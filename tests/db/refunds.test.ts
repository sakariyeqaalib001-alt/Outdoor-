import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

/** Phase 12 — refunds (BRD §6.5, BR-03, D-15; SDD §10.5; UAT-07, UAT-17). */
let db: PGlite;

const SA = "c0000000-0000-4000-8000-000000000001"; // Super Admin
const SA2 = "c0000000-0000-4000-8000-000000000002"; // second Super Admin
const TL = "c0000000-0000-4000-8000-000000000003"; // leads team A
const AG = "c0000000-0000-4000-8000-000000000004"; // agent, team A
const TL2 = "c0000000-0000-4000-8000-000000000005"; // leads team B
const AG2 = "c0000000-0000-4000-8000-000000000006"; // agent, team B
const STK = "c0000000-0000-4000-8000-000000000007"; // Stock Officer
const FIN = "c0000000-0000-4000-8000-000000000008"; // Finance

let district: string;
let branch: string;
let fttaBasic: string;
let router: string;
let pdcom: string;
let central: string;

type Row = Record<string, unknown>;
const call = <T extends Row = Row>(user: string | null, sql: string, params: unknown[] = []) =>
  as(db, user ? "authenticated" : "anon", user, () => db.query<T>(sql, params));
const one = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

let seq = 3000000;
let idx = 70000000;
async function approvedSale(agent = AG, leader = TL): Promise<string> {
  const input = {
    client_request_id: randomUUID(), customer_type: "new", full_name: "Hodan Warsame", phone: `063${seq++}`, index: String(idx++),
    district_id: district, area: "Market", branch_id: branch, plan_id: fttaBasic, months_paid: 2, free_month: false,
  };
  const r = (await call<{ r: { sale_id: string } }>(agent, "select public.create_sale($1::jsonb) as r", [JSON.stringify(input)])).rows[0].r;
  await call(leader, "select public.approve_sale($1, $2::jsonb)", [r.sale_id, JSON.stringify([{ item_id: router, quantity: 1 }])]);
  return r.sale_id;
}
const submit = (user: string, sale: string, extra: Row = {}, request = randomUUID()) =>
  call<{ r: { refund_id: string; existing: boolean } }>(user, "select public.create_refund($1::jsonb) as r", [
    JSON.stringify({ client_request_id: request, sale_id: sale, amount: 10, reason: "no_signal", ...extra }),
  ]).then((q) => q.rows[0].r);
const decide = (user: string, refund: string, approve: boolean, note: string | null = null) =>
  call(user, "select public.decide_refund($1, $2, $3)", [refund, approve, note]);
const saleStatus = async (sale: string) => (await one<{ s: string }>("select status as s from public.sales where id = $1", [sale])).s;
const eligible = async (sale: string) =>
  Number((await one<{ n: number }>(
    "select count(*)::int as n from app.eligible_sales((select sale_month from public.sales where id = $1)) where sale_id = $1", [sale])).n);
const notes = async (user: string, kind: string) =>
  (await db.query<{ entity_id: string }>("select entity_id from public.notifications where user_id = $1 and kind = $2", [user, kind])).rows.map((r) => r.entity_id);
const balance = async (loc: string, item: string) => (await one<{ b: number }>("select app.location_balance($1, $2) as b", [loc, item])).b;

beforeAll(async () => {
  db = await createTestDatabase();
  const id = async (sql: string, p: unknown[] = []) => (await one<{ id: string }>(sql, p)).id;
  const hargeisa = await id("select id from public.cities where name = 'Hargeisa'");
  for (const [user, type, role] of [
    [SA, "permanent", "super_admin"], [SA2, "permanent", "super_admin"], [TL, "permanent", "team_leader"], [AG, "temporary", "agent"],
    [TL2, "permanent", "team_leader"], [AG2, "temporary", "agent"], [STK, "permanent", "stock_officer"], [FIN, "permanent", "finance"],
  ] as const) {
    await createUser(db, { id: user, type, otpVerified: true, fullName: `User ${user.slice(-1)}` });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
  }
  await db.query("update public.user_profiles set city_id = $1", [hargeisa]);
  const teamA = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL]);
  const teamB = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team B', $1, $2) returning id", [hargeisa, TL2]);
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $2), ($3, $4)", [AG, teamA, AG2, teamB]);
  district = await id("insert into public.districts (city_id, name) values ($1, '26 June') returning id", [hargeisa]);
  branch = await id("select id from public.branches where name = 'HQ'");
  fttaBasic = await id("select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'FTTA' and pl.name = 'SO-Basic'");
  router = await id("select id from public.stock_items where code = 'WIFI_ROUTER'");
  pdcom = await id("select id from public.stock_items where code = 'PDCOM'");
  central = await id("select app.location_of('central') as id");
  for (const team of [teamA, teamB]) {
    const loc = await id("select id from public.stock_locations where team_id = $1", [team]);
    await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('transfer_in', $1, 20, $2)", [router, loc]);
  }
}, 60_000);

describe("submitting a refund (FR-REF-01…03, 06; UAT-07)", () => {
  let sale: string;
  let refund: string;

  beforeAll(async () => {
    sale = await approvedSale();
  });

  it("the agent submits for their own approved sale; it waits for Super Admin and changes nothing yet", async () => {
    refund = (await submit(AG, sale)).refund_id;
    expect(await one("select status, customer_name, amount::float as amount, reason from public.refunds where id = $1", [refund]))
      .toEqual({ status: "pending", customer_name: "Hodan Warsame", amount: 10, reason: "no_signal" });
    expect(await saleStatus(sale)).toBe("approved");
    expect(await eligible(sale)).toBe(1);
    expect(await notes(SA, "refund_pending")).toContain(refund);
    expect(await notes(SA2, "refund_pending")).toContain(refund);
  });

  it("a retry with the same request id returns the same refund; a second request is refused", async () => {
    const request = randomUUID();
    const sale2 = await approvedSale();
    const first = await submit(AG, sale2, {}, request);
    expect(await submit(AG, sale2, {}, request)).toEqual({ refund_id: first.refund_id, existing: true });
    expect(await errorOf(submit(AG, sale2))).toMatch(/REFUND_EXISTS/);
    expect(await errorOf(submit(AG, sale))).toMatch(/REFUND_EXISTS/);
  });

  it("checks the amount and reason", async () => {
    const s = await approvedSale();
    const collected = Number((await one<{ a: string }>("select amount_collected as a from public.sales where id = $1", [s])).a);
    for (const amount of [0, -5, collected + 0.01, 1.005, "abc"]) expect(await errorOf(submit(AG, s, { amount }))).toMatch(/REFUND_AMOUNT/);
    expect(await errorOf(submit(AG, s, { reason: "bored" }))).toMatch(/REASON_REQUIRED/);
    expect(await errorOf(submit(AG, s, { reason: "other" }))).toMatch(/REASON_REQUIRED/);
    expect((await submit(AG, s, { reason: "other", note: "Customer moved away", amount: collected })).existing).toBe(false);
  });

  it("only approved sales can be refunded", async () => {
    const input = {
      client_request_id: randomUUID(), customer_type: "new", full_name: "Ayaan Ali", phone: `063${seq++}`, index: String(idx++),
      district_id: district, area: "Market", branch_id: branch, plan_id: fttaBasic, months_paid: 1, free_month: false,
    };
    const pending = (await call<{ r: { sale_id: string } }>(AG, "select public.create_sale($1::jsonb) as r", [JSON.stringify(input)])).rows[0].r.sale_id;
    expect(await errorOf(submit(AG, pending))).toMatch(/SALE_NOT_REFUNDABLE/);
  });

  it("scope: an agent cannot refund another agent's sale; a Team Leader only their team's", async () => {
    const other = await approvedSale(AG2, TL2);
    expect(await errorOf(submit(AG, other))).toMatch(/not allowed/);
    expect(await errorOf(submit(TL, other))).toMatch(/not allowed/);
    expect(await errorOf(submit(STK, other))).toMatch(/not allowed/);
    expect(await errorOf(submit(FIN, other))).toMatch(/not allowed/);
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.create_refund('{}'::jsonb)")))).toMatch(/permission denied/);
    expect((await submit(TL2, other)).existing).toBe(false);
  });
});

describe("deciding a refund (BR-03; UAT-07, UAT-17)", () => {
  it("only a Super Admin decides — never one they requested", async () => {
    const sale = await approvedSale();
    const refund = (await submit(SA, sale)).refund_id;
    for (const u of [AG, TL, STK, FIN]) expect(await errorOf(decide(u, refund, true))).toMatch(/not allowed/);
    expect(await errorOf(decide(SA, refund, true))).toMatch(/SELF_APPROVAL/);
    expect(await notes(SA, "refund_pending")).not.toContain(refund); // not told about their own request
    expect(await saleStatus(sale)).toBe("approved");
    await decide(SA2, refund, true);
    expect(await saleStatus(sale)).toBe("reversed");
  });

  it("rejection needs a reason and changes nothing; a new request may follow", async () => {
    const sale = await approvedSale();
    const refund = (await submit(AG, sale)).refund_id;
    const stockBefore = (await one<{ n: number }>("select count(*)::int as n from public.stock_movements")).n;
    expect(await errorOf(decide(SA, refund, false))).toMatch(/REASON_REQUIRED/);
    await decide(SA, refund, false, "Customer is connected and using the service");
    expect(await one("select status, decision_note from public.refunds where id = $1", [refund]))
      .toEqual({ status: "rejected", decision_note: "Customer is connected and using the service" });
    expect(await saleStatus(sale)).toBe("approved");
    expect(await eligible(sale)).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from public.stock_movements")).n).toBe(stockBefore);
    expect(await notes(AG, "refund_rejected")).toContain(refund);
    expect(await errorOf(decide(SA, refund, true))).toMatch(/ALREADY_DECIDED/);
    expect((await submit(AG, sale)).existing).toBe(false);
  });

  it("approval reverses the sale (kept, not deleted) and removes it from eligible sales", async () => {
    const sale = await approvedSale();
    const refund = (await submit(TL, sale, { amount: 15 })).refund_id;
    expect(await eligible(sale)).toBe(1);
    await decide(SA, refund, true);
    expect(await saleStatus(sale)).toBe("reversed");
    expect(await eligible(sale)).toBe(0);
    const r = await one<{ status: string; payroll_effect: string; counting_month: string; decided_by: string }>(
      "select status, payroll_effect, counting_month::text, decided_by from public.refunds where id = $1", [refund]);
    expect(r).toMatchObject({ status: "approved", payroll_effect: "excluded", decided_by: SA });
    expect(r.counting_month).toBe((await one<{ m: string }>("select sale_month::text as m from public.sales where id = $1", [sale])).m);
    expect((await one<{ n: number }>("select count(*)::int as n from public.payroll_pending_adjustments where source_id = $1", [refund])).n).toBe(0);
    expect(await notes(TL, "refund_approved")).toContain(refund); // requester
    expect(await notes(AG, "refund_approved")).toContain(refund); // the sale's agent
    expect(await notes(STK, "refund_return")).toContain(refund); // a router to collect
    // Original decision history stays (approval of the sale and the issue of the router).
    expect((await one<{ n: number }>("select count(*)::int as n from public.approvals where entity_id = $1", [sale])).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from public.stock_movements where ref_type = 'sale' and ref_id = $1", [sale])).n).toBe(1);
  });

  it("after the sale's month is finalized, approval creates a pending payroll adjustment (FR-REF-07)", async () => {
    const sale = await approvedSale();
    const refund = (await submit(AG, sale)).refund_id;
    await db.exec("create or replace function app.month_finalized(p_month date) returns boolean language sql stable security definer set search_path = '' as $$ select true $$");
    try {
      await decide(SA, refund, true);
    } finally {
      await db.exec("create or replace function app.month_finalized(p_month date) returns boolean language sql stable security definer set search_path = '' as $$ select false $$");
    }
    expect((await one("select payroll_effect from public.refunds where id = $1", [refund])).payroll_effect).toBe("adjustment");
    const adj = await one<{ units_delta: number; revenue_delta: string; agent_id: string }>(
      "select units_delta, revenue_delta, agent_id from public.payroll_pending_adjustments where source_id = $1", [refund]);
    const collected = (await one<{ a: string }>("select amount_collected as a from public.sales where id = $1", [sale])).a;
    expect(adj).toEqual({ units_delta: -1, revenue_delta: `-${collected}`, agent_id: AG });
    expect(await errorOf(db.query("update public.payroll_pending_adjustments set units_delta = -2 where source_id = $1", [refund]))).not.toBeNull();
    // Finance (payroll.read all) and Super Admin can read it; agents cannot.
    expect((await call(FIN, "select 1 from public.payroll_pending_adjustments where source_id = $1", [refund])).rows).toHaveLength(1);
    expect((await call(AG, "select 1 from public.payroll_pending_adjustments where source_id = $1", [refund])).rows).toHaveLength(0);
  });

  it("refunds cannot be written directly or changed after the decision", async () => {
    const sale = await approvedSale();
    const refund = (await submit(AG, sale)).refund_id;
    expect(await errorOf(call(SA, "update public.refunds set status = 'approved' where id = $1", [refund]))).toMatch(/permission denied/);
    expect(await errorOf(call(AG, "insert into public.refunds (sale_id) values ($1)", [sale]))).toMatch(/permission denied/);
    await decide(SA, refund, true);
    expect(await errorOf(db.query("update public.refunds set amount = 1 where id = $1", [refund]))).toMatch(/cannot be changed/);
    expect(await errorOf(db.query("delete from public.refunds where id = $1", [refund]))).toMatch(/cannot be deleted/);
  });
});

describe("devices coming back (FR-REF-08)", () => {
  let refund: string;

  beforeAll(async () => {
    const sale = await approvedSale();
    refund = (await submit(AG, sale)).refund_id;
  });

  it("can only be recorded for an approved refund, by the Stock Officer", async () => {
    expect(await errorOf(call(STK, "select public.refund_record_return($1, $2, 1)", [refund, router]))).toMatch(/REFUND_NOT_APPROVED/);
    await decide(SA, refund, true);
    for (const u of [AG, TL, FIN]) expect(await errorOf(call(u, "select public.refund_record_return($1, $2, 1)", [refund, router]))).toMatch(/not allowed/);
    for (const u of [AG, TL]) expect(await errorOf(call(u, "select * from public.refunds_to_collect()"))).toMatch(/not allowed/);
  });

  it("returns the device given on the sale to the Central Store, linked to the refund", async () => {
    const listed = (await call<{ refund_id: string; given: number; returned: number }>(STK, "select * from public.refunds_to_collect()")).rows
      .filter((r) => r.refund_id === refund);
    expect(listed).toMatchObject([{ given: 1, returned: 0 }]);
    const summary = async () => (await one<{ difference: number }>("select difference from app.opening_stock_summary() where code = 'WIFI_ROUTER'")).difference;
    const [centralBefore, diffBefore] = [await balance(central, router), await summary()];

    expect(await errorOf(call(STK, "select public.refund_record_return($1, $2, 1)", [refund, pdcom]))).toMatch(/UNKNOWN_ITEM/);
    expect(await errorOf(call(STK, "select public.refund_record_return($1, $2, 2)", [refund, router]))).toMatch(/RETURN_TOO_MANY/);
    await call(STK, "select public.refund_record_return($1, $2, 1, false, 'Collected at HQ')", [refund, router]);

    expect(await balance(central, router)).toBe(centralBefore + 1);
    expect(await summary()).toBe(diffBefore); // still reconciles
    expect(await one("select ref_type, ref_id, movement_type, from_location_id from public.stock_movements where ref_id = $1", [refund]))
      .toEqual({ ref_type: "refund", ref_id: refund, movement_type: "return", from_location_id: null });
    expect(await errorOf(call(STK, "select public.refund_record_return($1, $2, 1)", [refund, router]))).toMatch(/RETURN_TOO_MANY/);
    expect((await call<{ refund_id: string }>(STK, "select * from public.refunds_to_collect()")).rows.map((r) => r.refund_id)).not.toContain(refund);
    expect((await call(AG, "select item, given, returned from public.refund_equipment($1)", [[refund]])).rows)
      .toEqual([{ item: "WiFi Router", given: 1, returned: 1 }]);
    expect((await call(AG2, "select * from public.refund_equipment($1)", [[refund]])).rows).toEqual([]);
  });
});

describe("who sees refunds (RLS)", () => {
  it("agents see their own, Team Leaders their team's, Finance and Super Admin all; Stock Officers none", async () => {
    const mine = (await call<{ agent_id: string }>(AG, "select agent_id from public.refunds")).rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.agent_id === AG)).toBe(true);
    expect((await call<{ agent_id: string }>(AG2, "select agent_id from public.refunds")).rows.every((r) => r.agent_id === AG2)).toBe(true);
    expect((await call<{ agent_id: string }>(TL2, "select agent_id from public.refunds")).rows.every((r) => r.agent_id === AG2)).toBe(true);
    const all = (await db.query("select 1 from public.refunds")).rows.length;
    expect((await call(FIN, "select 1 from public.refunds")).rows).toHaveLength(all);
    expect((await call(SA, "select 1 from public.refunds")).rows).toHaveLength(all);
    expect((await call(STK, "select 1 from public.refunds")).rows).toHaveLength(0);
    expect(await errorOf(as(db, "anon", null, () => db.query("select 1 from public.refunds")))).toMatch(/permission denied/);
  });

  it("an inactive user sees nothing", async () => {
    await db.query("update public.user_profiles set is_active = false where id = $1", [AG]);
    try {
      expect((await call(AG, "select 1 from public.refunds")).rows).toHaveLength(0);
      expect(await errorOf(submit(AG, randomUUID()))).toMatch(/not allowed/);
    } finally {
      await db.query("update public.user_profiles set is_active = true where id = $1", [AG]);
    }
  });

  it("the app helpers are not callable through the API", async () => {
    expect(await errorOf(call(SA, "select app.check_refund_rate($1, $1)", [AG]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "select app.month_finalized(current_date)"))).toMatch(/permission denied/);
  });
});

describe("HIGH_REFUND_RATE (SDD §11.2)", () => {
  const events = async () => Number((await one<{ n: number }>("select count(*)::int as n from public.audit_events where rule_code = 'HIGH_REFUND_RATE'")).n);

  it("is off by default — no event however many refunds", async () => {
    expect(await one("select enabled, threshold from public.audit_rules where code = 'HIGH_REFUND_RATE'"))
      .toEqual({ enabled: false, threshold: { percent: 20, refunds: 3, days: 30 } });
    expect(await events()).toBe(0);
  });

  it("when switched on, an agent over the rate gets one event and a case", async () => {
    expect(await errorOf(call(SA, "select public.audit_rule_update('HIGH_REFUND_RATE', true, $1::jsonb)", [JSON.stringify({ percent: 0, refunds: 1, days: 30 })])))
      .toMatch(/THRESHOLD_INVALID/);
    expect(await errorOf(call(AG, "select public.audit_rule_update('HIGH_REFUND_RATE', true, '{}'::jsonb)"))).toMatch(/not allowed/);
    await call(SA, "select public.audit_rule_update('HIGH_REFUND_RATE', true, $1::jsonb)", [JSON.stringify({ percent: 20, refunds: 1, days: 30 })]);
    const sale = await approvedSale(AG2, TL2);
    await decide(SA, (await submit(AG2, sale)).refund_id, true);
    expect(await events()).toBe(1);
    const sale2 = await approvedSale(AG2, TL2);
    await decide(SA, (await submit(AG2, sale2)).refund_id, true);
    expect(await events()).toBe(1); // one per agent per window
    expect((await one<{ n: number }>(
      "select count(*)::int as n from public.audit_cases c join public.audit_case_links l on l.case_id = c.id where c.rule_code = 'HIGH_REFUND_RATE' and l.entity_type = 'user_profiles' and l.entity_id = $1",
      [AG2])).n).toBe(1);
  });
});
