import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

let db: PGlite;

const SA = "80000000-0000-4000-8000-000000000001"; // Super Admin
const TL = "80000000-0000-4000-8000-000000000002"; // leads team A
const AG = "80000000-0000-4000-8000-000000000003"; // agent, team A
const TL2 = "80000000-0000-4000-8000-000000000004"; // leads team B
const AG2 = "80000000-0000-4000-8000-000000000005"; // agent, team B
const LONE = "80000000-0000-4000-8000-000000000006"; // agent without a team

let teamA: string;
let locA: string;
let district: string;
let branch: string;
let fttaBasic: string; // FTTA · SO-Basic
let ftthHome: string; // FTTH · SO-Home
let ftta: string;
let ftth: string;
let fttb: string;
let router: string;
let pdcom: string;
let calix: string;
let lteFamily: string; // LTE · SO!-Family

type Result = { status: string; sale_id?: string; switch_id?: string; field?: string; rule?: string; existing?: boolean };
const call = (user: string, sql: string, params: unknown[] = []) => as(db, "authenticated", user, () => db.query(sql, params));
const balance = async (item: string) => (await db.query<{ b: number }>("select app.location_balance($1, $2) as b", [locA, item])).rows[0].b;
const status = async (table: string, id: string) => (await db.query<{ s: string }>(`select status as s from public.${table} where id = $1`, [id])).rows[0].s;
const lines = (...l: [string, number][]) => JSON.stringify(l.map(([item_id, quantity]) => ({ item_id, quantity })));

let seq = 2000000;
const phone = () => `063${seq++}`;
let idx = 60000000;
const index = () => String(idx++);

async function sell(user: string, overrides: Record<string, unknown> = {}): Promise<Result> {
  const input = {
    client_request_id: randomUUID(), customer_type: "new", full_name: "Hodan Warsame", phone: phone(), index: index(),
    district_id: district, area: "Market", branch_id: branch, plan_id: fttaBasic, months_paid: 1, free_month: false, ...overrides,
  };
  const { rows } = await as(db, "authenticated", user, () => db.query<{ r: Result }>("select public.create_sale($1::jsonb) as r", [JSON.stringify(input)]));
  return rows[0].r;
}
const approve = (user: string, sale: string, items = "[]") => call(user, "select public.approve_sale($1, $2::jsonb)", [sale, items]);
const reject = (user: string, sale: string, reason: string) => call(user, "select public.reject_sale($1, $2)", [sale, reason]);
async function switchTo(user: string, input: Record<string, unknown>): Promise<Result> {
  const { rows } = await as(db, "authenticated", user, () =>
    db.query<{ r: Result }>("select public.create_switch($1::jsonb) as r", [JSON.stringify({ client_request_id: randomUUID(), branch_id: branch, ...input })]));
  return rows[0].r;
}
const notes = async (user: string, kind?: string) =>
  (await db.query<{ kind: string; entity_id: string; data: Record<string, string> }>(
    `select kind, entity_id, data from public.notifications where user_id = $1 ${kind ? "and kind = $2" : ""} order by created_at`, kind ? [user, kind] : [user])).rows;

beforeAll(async () => {
  db = await createTestDatabase();
  const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  const hargeisa = await id("select id from public.cities where name = 'Hargeisa'");
  for (const [user, type, role] of [
    [SA, "permanent", "super_admin"], [TL, "permanent", "team_leader"], [AG, "temporary", "agent"],
    [TL2, "permanent", "team_leader"], [AG2, "temporary", "agent"], [LONE, "temporary", "agent"],
  ] as const) {
    await createUser(db, { id: user, type, otpVerified: true, fullName: `User ${user.slice(-1)}` });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
  }
  await db.query("update public.user_profiles set city_id = $1", [hargeisa]);
  teamA = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL]);
  const teamB = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team B', $1, $2) returning id", [hargeisa, TL2]);
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $2), ($3, $4)", [AG, teamA, AG2, teamB]);
  district = await id("insert into public.districts (city_id, name) values ($1, '26 June') returning id", [hargeisa]);
  branch = await id("select id from public.branches where name = 'HQ'");
  const plan = (product: string, name: string) =>
    id("select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = $1 and pl.name = $2", [product, name]);
  fttaBasic = await plan("FTTA", "SO-Basic");
  ftthHome = await plan("FTTH", "SO-Home");
  ftta = await id("select id from public.products where code = 'FTTA'");
  ftth = await id("select id from public.products where code = 'FTTH'");
  fttb = await id("select id from public.products where code = 'FTTB'");
  router = await id("select id from public.stock_items where code = 'WIFI_ROUTER'");
  pdcom = await id("select id from public.stock_items where code = 'PDCOM'");
  calix = await id("select id from public.stock_items where code = 'CALIX'");
  lteFamily = await plan("LTE", "SO!-Family");
  locA = await id("select id from public.stock_locations where team_id = $1", [teamA]);
  await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('transfer_in', $1, 10, $3), ('transfer_in', $2, 1, $3)", [router, pdcom, locA]);
}, 60_000);

describe("who registers sales (D-38)", () => {
  it("refuses Super Admins — nobody could approve their sale", async () => {
    expect(await errorOf(sell(SA))).toMatch(/SUPER_ADMIN_NO_SALES/);
    expect(await errorOf(switchTo(SA, {}))).toMatch(/SUPER_ADMIN_NO_SALES/);
  });
});

describe("approving a sale with the equipment given (FR-SALE-07/08, D-37; UAT-06, 08, 22, 36)", () => {
  let sale: string;

  beforeAll(async () => {
    sale = (await sell(AG)).sale_id!;
  });

  it("notifies the agent's Team Leader (not other leaders)", async () => {
    expect((await notes(TL, "sale_pending")).map((n) => n.entity_id)).toContain(sale);
    expect((await notes(TL2, "sale_pending")).map((n) => n.entity_id)).not.toContain(sale);
    expect((await notes(TL, "sale_pending")).find((n) => n.entity_id === sale)?.data).toMatchObject({ customer: "Hodan Warsame", agent: "User 3" });
  });

  it("is refused for the agent, another team's leader, and anonymous callers", async () => {
    expect(await errorOf(approve(AG, sale))).toMatch(/not allowed/);
    expect(await errorOf(approve(TL2, sale))).toMatch(/not allowed/);
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.approve_sale($1)", [sale])))).toMatch(/permission denied/);
    expect(await status("sales", sale)).toBe("pending_approval");
  });

  it("refuses equipment the team does not hold — nothing deducted, still pending", async () => {
    const ftthSale = (await sell(AG, { plan_id: ftthHome })).sale_id!;
    const before = [await balance(pdcom), await balance(calix)];
    expect(await errorOf(approve(TL, ftthSale, lines([calix, 1])))).toMatch(/INSUFFICIENT_STOCK/);
    expect([await balance(pdcom), await balance(calix)]).toEqual(before);
    expect(await status("sales", ftthSale)).toBe("pending_approval");
    await reject(TL, ftthSale, "Test clean-up");
  });

  it("allows exactly one device of the product's kind (D-39)", async () => {
    // FTTA: one WiFi Router — nothing else, not none, not two.
    expect(await errorOf(approve(TL, sale))).toMatch(/EQUIPMENT_REQUIRED/);
    expect(await errorOf(approve(TL, sale, lines([pdcom, 1])))).toMatch(/EQUIPMENT_NOT_ALLOWED/);
    expect(await errorOf(approve(TL, sale, lines([router, 2])))).toMatch(/EQUIPMENT_ONE/);
    expect(await errorOf(approve(TL, sale, lines([router, 1], [pdcom, 1])))).toMatch(/EQUIPMENT_ONE/);
    // FTTH / FTTB: PDCOM or CALIX, never a router. LTE: no equipment.
    const ftth = (await sell(AG, { plan_id: ftthHome })).sale_id!;
    expect(await errorOf(approve(TL, ftth, lines([router, 1])))).toMatch(/EQUIPMENT_NOT_ALLOWED/);
    await reject(TL, ftth, "Test clean-up");
    const lte = (await sell(AG, { plan_id: lteFamily })).sale_id!;
    expect(await errorOf(approve(TL, lte, lines([router, 1])))).toMatch(/EQUIPMENT_NOT_ALLOWED/);
    await approve(TL, lte);
    expect(await status("sales", lte)).toBe("approved");
    expect(await status("sales", sale)).toBe("pending_approval");
  });

  it("by the Team Leader: approved, equipment recorded and deducted in the same step, agent notified", async () => {
    const before = await balance(router);
    await approve(TL, sale, lines([router, 1]));
    const row = (await db.query<{ status: string; approved_by: string; approved: boolean }>(
      "select status, approved_by, approved_at is not null as approved from public.sales where id = $1", [sale])).rows[0];
    expect(row).toEqual({ status: "approved", approved_by: TL, approved: true });
    expect(await balance(router)).toBe(before - 1);
    expect((await db.query("select stock_item_id, quantity from public.sale_items where sale_id = $1", [sale])).rows).toEqual([{ stock_item_id: router, quantity: 1 }]);
    expect((await db.query("select decision, decided_by from public.approvals where entity_id = $1", [sale])).rows).toEqual([{ decision: "approved", decided_by: TL }]);
    expect((await notes(AG, "sale_approved")).map((n) => n.entity_id)).toContain(sale);
    expect(await errorOf(approve(TL, sale))).toMatch(/ALREADY_DECIDED/);
  });

  it("of a Team Leader's own sale: the Team Leader approves it with a device from their own team (D-40)", async () => {
    const own = (await sell(TL)).sale_id!;
    expect((await notes(TL, "sale_pending")).map((n) => n.entity_id)).toContain(own);
    expect((await notes(SA, "sale_pending")).map((n) => n.entity_id)).not.toContain(own);
    const before = await balance(router);
    await approve(TL, own, lines([router, 1]));
    expect(await status("sales", own)).toBe("approved");
    expect(await balance(router)).toBe(before - 1);
    expect((await db.query("select decided_by from public.approvals where entity_id = $1", [own])).rows).toEqual([{ decided_by: TL }]);
    // ...and may cancel (reject) their own.
    const another = (await sell(TL)).sale_id!;
    await reject(TL, another, "Entered by mistake");
    expect(await status("sales", another)).toBe("rejected");
  });

  it("never lets an agent approve, nor a Team Leader approve another team's leader's own sale", async () => {
    const tl2own = (await sell(TL2)).sale_id!;
    expect(await errorOf(approve(TL, tl2own, lines([router, 1])))).toMatch(/not allowed/);
    expect(await errorOf(approve(AG2, tl2own, lines([router, 1])))).toMatch(/not allowed/);
  });

  it("of a seller without a team: Super Admin decides; equipment cannot be given (LTE needs none)", async () => {
    const s = (await sell(LONE)).sale_id!;
    expect((await notes(SA, "sale_pending")).map((n) => n.entity_id)).toContain(s);
    expect(await errorOf(approve(SA, s, lines([router, 1])))).toMatch(/NO_TEAM_STOCK/);
    const lte = (await sell(LONE, { plan_id: lteFamily })).sale_id!;
    await approve(SA, lte);
    expect(await status("sales", lte)).toBe("approved");
  });

  it("shows the decision history to the agent but not to other teams", async () => {
    expect((await call(AG, "select 1 from public.approvals where entity_id = $1", [sale])).rows).toHaveLength(1);
    expect((await call(AG2, "select 1 from public.approvals where entity_id = $1", [sale])).rows).toHaveLength(0);
  });
});

describe("rejecting a sale (D-37)", () => {
  it("needs a reason and notifies the agent", async () => {
    const s = (await sell(AG)).sale_id!;
    expect(await errorOf(reject(TL, s, ""))).toMatch(/REASON_REQUIRED/);
    await reject(TL, s, "Wrong customer name");
    expect(await status("sales", s)).toBe("rejected");
    expect((await notes(AG, "sale_rejected")).find((n) => n.entity_id === s)?.data).toMatchObject({ reason: "Wrong customer name" });
  });

  it("of a New sale releases the phone and Index so the customer can be registered correctly", async () => {
    const p = phone();
    const i = index();
    const first = (await sell(AG, { phone: p, index: i, full_name: "Wrong Name" })).sale_id!;
    await reject(TL, first, "Name typed wrongly");
    const again = await sell(AG, { phone: p, index: i, full_name: "Right Name" });
    expect(again.status).toBe("ok");
    const released = await db.query("select 1 from public.customer_identifiers where released_at is not null and value in ($1, $2)", [`+252${p.slice(1)}`, i]);
    expect(released.rows).toHaveLength(2);
  });

  it("keeps the numbers when the customer has another sale (and for Retention)", async () => {
    const p = phone();
    const i = index();
    const first = (await sell(AG, { phone: p, index: i })).sale_id!;
    await approve(TL, first, lines([router, 1]));
    await db.query("update public.sales set submitted_at = submitted_at - interval '40 days' where id = $1", [first]);
    const retention = (await sell(AG, { phone: p, index: i, customer_type: "retention" })).sale_id!;
    await reject(TL, retention, "Not renewing after all");
    expect((await sell(AG2, { phone: p, index: index() })).rule).toBe("DUP_PHONE");
  });
});

describe("product switch (FR-SW-01…06, D-16, D-38; UAT-12, 34)", () => {
  let p: string;
  let i: string;

  beforeAll(async () => {
    p = phone();
    i = index();
    const s = (await sell(AG, { phone: p, index: i, full_name: "Ayaan Cali", plan_id: fttaBasic })).sale_id!;
    await approve(TL, s, lines([router, 1]));
  });

  const base = () => ({ full_name: "Ayaan Cali", phone: p, index: i, from_product_id: ftta, to_product_id: ftth, to_plan_id: ftthHome });

  it("rejects a mismatched phone, Index, name or current product with an explanation and a durable event (UAT-12)", async () => {
    expect(await switchTo(AG, { ...base(), phone: phone() })).toEqual({ status: "mismatch", field: "phone_or_index" });
    expect(await switchTo(AG, { ...base(), index: index() })).toEqual({ status: "mismatch", field: "phone_or_index" });
    expect(await switchTo(AG, { ...base(), full_name: "Hassan Yusuf" })).toEqual({ status: "mismatch", field: "name" });
    expect(await switchTo(AG, { ...base(), from_product_id: ftth, to_product_id: ftta, to_plan_id: fttaBasic })).toEqual({ status: "mismatch", field: "product" });
    expect((await db.query("select 1 from public.audit_events where rule_code = 'SWITCH_MISMATCH'")).rows).toHaveLength(4);
  });

  it("allows only FTTA ↔ FTTH, a different product, and a plan of the new product", async () => {
    expect(await errorOf(switchTo(AG, { ...base(), to_product_id: ftta }))).toMatch(/SAME_PRODUCT/);
    expect(await errorOf(switchTo(AG, { ...base(), to_product_id: fttb }))).toMatch(/SWITCH_PRODUCTS/);
    expect(await errorOf(switchTo(AG, { ...base(), to_plan_id: fttaBasic }))).toMatch(/PLAN_REQUIRED/);
  });

  it("waits for the Team Leader, who records the new equipment; never a sale; product becomes FTTH (UAT-34)", async () => {
    const salesBefore = (await db.query<{ n: number }>("select count(*)::int as n from public.sales")).rows[0].n;
    const r = await switchTo(AG, base());
    expect(r).toMatchObject({ status: "ok", existing: false });
    expect(await status("product_switches", r.switch_id!)).toBe("pending_approval");
    expect((await notes(TL, "switch_pending")).map((n) => n.entity_id)).toContain(r.switch_id);
    expect(await errorOf(switchTo(AG, base()))).toMatch(/SWITCH_PENDING/);
    expect(await errorOf(call(AG, "select public.approve_switch($1)", [r.switch_id]))).toMatch(/not allowed/);

    expect(await errorOf(call(TL, "select public.approve_switch($1, $2::jsonb)", [r.switch_id, lines([router, 1])]))).toMatch(/EQUIPMENT_NOT_ALLOWED/);
    const before = await balance(pdcom);
    await call(TL, "select public.approve_switch($1, $2::jsonb)", [r.switch_id, lines([pdcom, 1])]);
    expect(await status("product_switches", r.switch_id!)).toBe("approved");
    expect(await balance(pdcom)).toBe(before - 1);
    const product = (await db.query<{ p: string }>("select app.current_product(customer_id) as p from public.product_switches where id = $1", [r.switch_id])).rows[0].p;
    expect(product).toBe(ftth);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.sales")).rows[0].n).toBe(salesBefore);
    expect((await notes(AG, "switch_approved")).map((n) => n.entity_id)).toContain(r.switch_id);
  });

  it("can switch back FTTH → FTTA later, be rejected with a reason, and is idempotent", async () => {
    const input = { ...base(), client_request_id: randomUUID(), from_product_id: ftth, to_product_id: ftta, to_plan_id: fttaBasic };
    const first = await switchTo(AG, input);
    expect(await switchTo(AG, input)).toEqual({ ...first, existing: true });
    expect(await errorOf(call(TL, "select public.reject_switch($1, '')", [first.switch_id]))).toMatch(/REASON_REQUIRED/);
    await call(TL, "select public.reject_switch($1, 'Customer changed mind')", [first.switch_id]);
    expect(await status("product_switches", first.switch_id!)).toBe("rejected");
    expect((await notes(AG, "switch_rejected")).map((n) => n.entity_id)).toContain(first.switch_id);
  });

  it("is visible to the agent and their Team Leader only", async () => {
    expect((await call(AG, "select 1 from public.product_switches")).rows.length).toBeGreaterThan(0);
    expect((await call(TL, "select 1 from public.product_switches")).rows.length).toBeGreaterThan(0);
    expect((await call(AG2, "select 1 from public.product_switches")).rows).toHaveLength(0);
    expect((await call(TL2, "select 1 from public.product_switches")).rows).toHaveLength(0);
  });
});

describe("notifications (SDD §18)", () => {
  it("tell the receiving Supervisor that stock waits for acceptance", async () => {
    const officer = "80000000-0000-4000-8000-000000000009";
    await createUser(db, { id: officer, otpVerified: true });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'stock_officer')", [officer]);
    await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) select 'receipt', $1, 5, id from public.stock_locations where kind = 'central'", [router]);
    const { rows } = await call(officer, "select public.stock_send($1, $2::jsonb, null) as id", [teamA, lines([router, 2])]);
    expect((await notes(TL, "stock_to_accept")).map((n) => n.entity_id)).toContain((rows[0] as { id: string }).id);
  });

  it("are private, cannot be written directly, and can be marked read", async () => {
    expect((await call(AG, "select user_id from public.notifications")).rows.every((r) => (r as { user_id: string }).user_id === AG)).toBe(true);
    expect(await errorOf(call(AG, "insert into public.notifications (user_id, kind, entity_type, entity_id) values ($1, 'sale_pending', 'sales', gen_random_uuid())", [AG]))).toMatch(/permission denied/);
    expect(await errorOf(call(AG, "update public.notifications set read_at = now()"))).toMatch(/permission denied/);
    await call(AG, "select public.mark_notifications_read()");
    expect((await db.query("select 1 from public.notifications where user_id = $1 and read_at is null", [AG])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.notifications where user_id = $1 and read_at is null", [TL])).rows.length).toBeGreaterThan(0);
  });
});

describe("Team Leader's own switch (D-40: still needs Super Admin)", () => {
  it("cannot be approved by the Team Leader; Super Admin is notified and approves it", async () => {
    const p = phone();
    const i = index();
    const s = (await sell(TL, { phone: p, index: i, full_name: "Leader Customer" })).sale_id!;
    await approve(TL, s, lines([router, 1])); // own SALE: allowed (D-40)
    const { rows } = await as(db, "authenticated", TL, () =>
      db.query<{ r: Result }>("select public.create_switch($1::jsonb) as r", [JSON.stringify({
        client_request_id: randomUUID(), branch_id: branch, full_name: "Leader Customer", phone: p, index: i,
        from_product_id: ftta, to_product_id: ftth, to_plan_id: ftthHome,
      })]));
    const sw = rows[0].r.switch_id!;
    expect((await notes(SA, "switch_pending")).map((n) => n.entity_id)).toContain(sw);
    expect((await notes(TL, "switch_pending")).map((n) => n.entity_id)).not.toContain(sw);
    await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('transfer_in', $1, 1, $2)", [pdcom, locA]);
    expect(await errorOf(call(TL, "select public.approve_switch($1, $2::jsonb)", [sw, lines([pdcom, 1])]))).toMatch(/SELF_APPROVAL/);
    expect(await errorOf(call(TL, "select public.reject_switch($1, 'Cancel mine')", [sw]))).toMatch(/SELF_APPROVAL/);
    await call(SA, "select public.approve_switch($1, $2::jsonb)", [sw, lines([pdcom, 1])]);
    expect(await status("product_switches", sw)).toBe("approved");
  });
});
