import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

let db: PGlite;

const SA = "70000000-0000-4000-8000-000000000001"; // Super Admin
const TL = "70000000-0000-4000-8000-000000000002"; // leads team A (Hargeisa)
const AG = "70000000-0000-4000-8000-000000000003"; // agent in team A (Hargeisa)
const AG2 = "70000000-0000-4000-8000-000000000004"; // agent in team B (Burco)
const FIN = "70000000-0000-4000-8000-000000000005"; // Finance (reads all sales)
const LONE = "70000000-0000-4000-8000-000000000006"; // agent with no team and no city

let hargeisa: string;
let burco: string;
let districtH: string;
let districtB: string;
let branchH: string;
let soHome: string; // FTTH SO-Home $25
let soBasicA: string; // FTTA SO-Basic $20
let router: string;
let pdcom: string;
let locA: string;

type Result = { status: string; sale_id?: string; sale_month?: string; sale_status?: string; existing?: boolean; rule?: string; field?: string };

const call = (user: string, sql: string, params: unknown[] = []) => as(db, "authenticated", user, () => db.query(sql, params));
const balance = async (loc: string, item: string) =>
  (await db.query<{ b: number }>("select app.location_balance($1, $2) as b", [loc, item])).rows[0].b;

let phoneSeq = 1000000;
const nextPhone = () => `063${phoneSeq++}`; // 063 + 7 digits → +25263…
let indexSeq = 50000000;
const nextIndex = () => String(indexSeq++);

function saleInput(overrides: Record<string, unknown> = {}) {
  return {
    client_request_id: randomUUID(),
    customer_type: "new",
    full_name: "Test Customer",
    phone: nextPhone(),
    index: nextIndex(),
    district_id: districtH,
    area: "Near the market",
    branch_id: branchH,
    plan_id: soHome,
    months_paid: 1,
    free_month: false,
    items: [],
    ...overrides,
  };
}

async function sell(user: string, input: Record<string, unknown>): Promise<Result> {
  const { rows } = await as(db, "authenticated", user, () => db.query<{ r: Result }>("select public.create_sale($1::jsonb) as r", [JSON.stringify(input)]));
  return rows[0].r;
}

const events = async (rule: string) =>
  (await db.query<{ matched_entity_id: string; actor_id: string; attempted_values: Record<string, string> }>(
    "select matched_entity_id, actor_id, attempted_values from public.audit_events where rule_code = $1 order by occurred_at",
    [rule]
  )).rows;
const salesCount = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.sales")).rows[0].n;
const customersCount = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.customers")).rows[0].n;

beforeAll(async () => {
  db = await createTestDatabase();
  const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  hargeisa = await id("select id from public.cities where name = 'Hargeisa'");
  burco = await id("select id from public.cities where name = 'Burco'");
  for (const [user, type, role] of [
    [SA, "permanent", "super_admin"], [TL, "permanent", "team_leader"], [AG, "temporary", "agent"],
    [AG2, "temporary", "agent"], [FIN, "permanent", "finance"], [LONE, "temporary", "agent"],
  ] as const) {
    await createUser(db, { id: user, type, otpVerified: true });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
  }
  await db.query("update public.user_profiles set city_id = $1 where id in ($2, $3, $4)", [hargeisa, SA, TL, AG]);
  await db.query("update public.user_profiles set city_id = $1 where id = $2", [burco, AG2]);
  const teamA = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL]);
  const teamB = await id("insert into public.teams (name, city_id) values ('Team B', $1) returning id", [burco]);
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $2), ($3, $4)", [AG, teamA, AG2, teamB]);
  districtH = await id("insert into public.districts (city_id, name) values ($1, '26 June') returning id", [hargeisa]);
  districtB = await id("insert into public.districts (city_id, name) values ($1, 'Koosaar') returning id", [burco]);
  branchH = await id("select b.id from public.branches b join public.cities c on c.id = b.city_id where c.name = 'Hargeisa' and b.name = 'HQ'");
  soHome = await id("select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'FTTH' and pl.name = 'SO-Home'");
  soBasicA = await id("select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'FTTA' and pl.name = 'SO-Basic'");
  router = await id("select id from public.stock_items where code = 'WIFI_ROUTER'");
  pdcom = await id("select id from public.stock_items where code = 'PDCOM'");
  locA = await id("select id from public.stock_locations where team_id = $1", [teamA]);
  // Team A holds 3 routers and 1 PDCOM (accepted stock).
  await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('transfer_in', $1, 3, $3), ('transfer_in', $2, 1, $3)", [router, pdcom, locA]);
}, 60_000);

describe("a New sale (FR-SALE-01…05, 14, 17)", () => {
  it("waits for approval (D-37), is priced from the plan, timed by the server, and ignores any date or agent sent", async () => {
    const r = await sell(AG, saleInput({ submitted_at: "2020-01-01T00:00:00Z", sale_month: "2020-01-01", agent_id: AG2, unit_price: 1 }));
    expect(r).toMatchObject({ status: "ok", sale_status: "pending_approval", existing: false });
    const sale = (await db.query<{ agent_id: string; unit_price: string; amount_collected: string; recent: boolean; current_month: boolean; city_id: string; approved_at: string | null }>(
      `select agent_id, unit_price, amount_collected, city_id, approved_at,
              submitted_at > now() - interval '1 minute' as recent,
              sale_month = app.business_month(now()) as current_month
         from public.sales where id = $1`, [r.sale_id])).rows[0];
    expect(sale).toMatchObject({ agent_id: AG, unit_price: "25.00", amount_collected: "25.00", recent: true, current_month: true, city_id: hargeisa, approved_at: null });
  });

  it("charges recharge × months paid + installation fee", async () => {
    const r = await sell(AG, saleInput({ months_paid: 3 }));
    const { rows } = await db.query<{ months_paid: number; amount_collected: string }>("select months_paid, amount_collected from public.sales where id = $1", [r.sale_id]);
    expect(rows[0]).toEqual({ months_paid: 3, amount_collected: "75.00" });
    expect(await errorOf(sell(AG, saleInput({ months_paid: 13 })))).toMatch(/MONTHS_PAID/);
    expect(await errorOf(sell(AG, saleInput({ months_paid: 0 })))).toMatch(/MONTHS_PAID/);
  });

  it("accepts any phone format and stores E.164; refuses other prefixes (D-33)", async () => {
    const r = await sell(AG, saleInput({ phone: "+252 63 900 0001" }));
    const { rows } = await db.query<{ value: string }>(
      "select i.value from public.customer_identifiers i join public.sales s on s.customer_id = i.customer_id where s.id = $1 and i.kind = 'phone'", [r.sale_id]);
    expect(rows[0].value).toBe("+252639000001");
    expect(await errorOf(sell(AG, saleInput({ phone: "0669000002" })))).toMatch(/PHONE_PREFIX/);
    expect(await errorOf(sell(AG, saleInput({ phone: "12" })))).toMatch(/INVALID_PHONE/);
  });

  it("requires an Index Number of exactly 8 digits (UAT-37)", async () => {
    for (const index of ["5009129", "500912934", "5009129A", ""]) {
      expect(await errorOf(sell(AG, saleInput({ index }))), index).toMatch(/INVALID_INDEX/);
    }
    expect((await sell(AG, saleInput({ index: "50091293" }))).status).toBe("ok");
  });

  it("checks name, district of the city, area, branch, plan and customer type", async () => {
    expect(await errorOf(sell(AG, saleInput({ full_name: " " })))).toMatch(/NAME_REQUIRED/);
    expect(await errorOf(sell(AG, saleInput({ district_id: districtB })))).toMatch(/DISTRICT_REQUIRED/);
    expect(await errorOf(sell(AG, saleInput({ area: "" })))).toMatch(/AREA_REQUIRED/);
    expect(await errorOf(sell(AG, saleInput({ branch_id: null })))).toMatch(/BRANCH_REQUIRED/);
    expect(await errorOf(sell(AG, saleInput({ plan_id: null })))).toMatch(/PLAN_REQUIRED/);
    expect(await errorOf(sell(AG, saleInput({ customer_type: "upgrade" })))).toMatch(/CUSTOMER_TYPE/);
  });
});

describe("city of a sale (FR-SALE-03, BR-04)", () => {
  it("defaults to the seller's city; nobody may sell in another city (D-42)", async () => {
    expect(await errorOf(sell(AG, saleInput({ city_id: burco, district_id: districtB })))).toMatch(/CITY_OVERRIDE/);
    expect(await errorOf(sell(TL, saleInput({ city_id: burco, district_id: districtB })))).toMatch(/CITY_OVERRIDE/);
    const r = await sell(TL, saleInput());
    expect(r.status).toBe("ok");
    expect(await errorOf(sell(LONE, saleInput()))).toMatch(/CITY_REQUIRED/);
  });
});

describe("duplicate New sales (FR-SALE-11, UAT-03, 04, 21)", () => {
  let phone: string;
  let index: string;
  let customer: string;

  beforeAll(async () => {
    phone = nextPhone();
    index = nextIndex();
    const r = await sell(AG, saleInput({ phone, index }));
    customer = (await db.query<{ customer_id: string }>("select customer_id from public.sales where id = $1", [r.sale_id])).rows[0].customer_id;
  });

  it("blocks an existing phone typed in any format and records a durable audit event", async () => {
    const before = await salesCount();
    const variants = [phone, `+252${phone.slice(1)}`, `252 ${phone.slice(1)}`];
    for (const v of variants) {
      expect(await sell(AG2, saleInput({ phone: v, city_id: undefined, district_id: districtB }))).toEqual({ status: "duplicate", rule: "DUP_PHONE", field: "phone" });
    }
    expect(await salesCount()).toBe(before);
    const hits = (await events("DUP_PHONE")).filter((e) => e.matched_entity_id === customer);
    expect(hits).toHaveLength(3);
    expect(hits[0].actor_id).toBe(AG2);
  });

  it("blocks an existing Index and names the matching customer (UAT-04)", async () => {
    expect(await sell(AG2, saleInput({ index, district_id: districtB }))).toEqual({ status: "duplicate", rule: "DUP_INDEX", field: "index" });
    expect((await events("DUP_INDEX")).at(-1)?.matched_entity_id).toBe(customer);
  });

  it("blocks a phone that was replaced by Super Admin (old values stay reserved, BR-01)", async () => {
    await call(SA, "select public.change_customer_identifier($1, 'phone', $2, 'Customer changed SIM')", [customer, nextPhone()]);
    expect((await sell(AG, saleInput({ phone }))).rule).toBe("DUP_PHONE");
  });
});

describe("Retention (FR-SALE-07, 12; UAT-05, 20; D-36)", () => {
  let phone: string;
  let index: string;
  let customer: string;

  beforeAll(async () => {
    phone = nextPhone();
    index = nextIndex();
    const r = await sell(AG, saleInput({ phone, index, full_name: "Mohamed Abdirahman Ali" }));
    customer = (await db.query<{ customer_id: string }>("select customer_id from public.sales where id = $1", [r.sale_id])).rows[0].customer_id;
    // Make room in this month: Retention for the same customer next tests runs in a fresh customer when needed.
  });

  it("for a customer not yet in the system creates the customer and waits for approval", async () => {
    const before = await customersCount();
    const r = await sell(AG, saleInput({ customer_type: "retention" }));
    expect(r).toMatchObject({ status: "ok", sale_status: "pending_approval" });
    expect(await customersCount()).toBe(before + 1);
    const { rows } = await db.query<{ approved_at: string | null }>("select approved_at from public.sales where id = $1", [r.sale_id]);
    expect(rows[0].approved_at).toBeNull();
  });

  it("blocks a second sale for the same customer in the same month (UAT-32)", async () => {
    expect(await sell(AG, saleInput({ customer_type: "retention", phone, index, full_name: "Mohamed Abdirahman Ali" }))).toEqual({
      status: "duplicate", rule: "SAME_MONTH", field: "month",
    });
    expect((await events("SAME_MONTH")).at(-1)?.matched_entity_id).toBe(customer);
  });

  it("links to the existing customer (no new customer) when phone, Index and name agree — close spelling allowed", async () => {
    // Previous month's sale of this customer is moved back so a new sale this month is allowed.
    await db.query("update public.sales set submitted_at = submitted_at - interval '40 days' where customer_id = $1", [customer]);
    const before = await customersCount();
    const r = await sell(AG, saleInput({ customer_type: "retention", phone, index, full_name: "mohammed abdi rahman ali" }));
    expect(r).toMatchObject({ status: "ok", sale_status: "pending_approval" });
    expect(await customersCount()).toBe(before);
    const { rows } = await db.query<{ customer_id: string }>("select customer_id from public.sales where id = $1", [r.sale_id]);
    expect(rows[0].customer_id).toBe(customer);
  });

  it("blocks a clearly different name, mixed identities and a former number (IDENTITY_CONFLICT)", async () => {
    const other = await sell(AG, saleInput());
    const otherIndex = (await db.query<{ value: string }>(
      "select i.value from public.customer_identifiers i join public.sales s on s.customer_id = i.customer_id where s.id = $1 and i.kind = 'index'", [other.sale_id])).rows[0].value;
    expect(await sell(AG, saleInput({ customer_type: "retention", phone, index, full_name: "Ahmed Yusuf Warsame" }))).toMatchObject({ rule: "IDENTITY_CONFLICT", field: "name" });
    expect(await sell(AG, saleInput({ customer_type: "retention", phone, index: otherIndex, full_name: "Mohamed Abdirahman Ali" }))).toMatchObject({ rule: "IDENTITY_CONFLICT", field: "phone_and_index" });
    expect(await sell(AG, saleInput({ customer_type: "retention", phone, index: nextIndex(), full_name: "Mohamed Abdirahman Ali" }))).toMatchObject({ rule: "IDENTITY_CONFLICT", field: "index" });
  });
});

describe("name matching rule (D-36)", () => {
  const match = async (a: string, b: string) => (await db.query<{ m: boolean }>("select app.names_match($1, $2) as m", [a, b])).rows[0].m;
  it.each([
    ["Mohamed Ali", "Mohammed Ali", true],
    ["Abdirahman Yusuf", "Abdi Rahman Yusuf", true],
    ["Ali Hassan", "hassan ALI", true],
    ["Faadumo Cali", "Fadumo Cali", true],
    ["Ahmed Ali", "Omar Ali", false],
    ["Hodan Warsame", "Ahmed Yusuf", false],
  ])("%s ≈ %s → %s", async (a, b, expected) => {
    expect(await match(a, b)).toBe(expected);
  });
});

describe("free month (FR-FREE-01…04, UAT-19; D-36)", () => {
  it("is 2 months paid, flagged, revenue = amount collected, 1 unit", async () => {
    const r = await sell(AG, saleInput({ free_month: true, months_paid: 7 }));
    const { rows } = await db.query<{ free_month: boolean; months_paid: number; amount_collected: string }>(
      "select free_month, months_paid, amount_collected from public.sales where id = $1", [r.sale_id]);
    expect(rows[0]).toEqual({ free_month: true, months_paid: 2, amount_collected: "50.00" });
  });

  it("needs 2 months of the plan to reach the free-month amount setting ($50)", async () => {
    expect(await errorOf(sell(AG, saleInput({ free_month: true, plan_id: soBasicA })))).toMatch(/FREE_MONTH_NOT_QUALIFIED/);
  });
});

describe("equipment (D-37: recorded by the Supervisor at approval, Phase 8)", () => {
  it("is not taken at registration — equipment sent with the request is ignored and no stock moves", async () => {
    const [routers, pdcoms] = [await balance(locA, router), await balance(locA, pdcom)];
    const r = await sell(AG, saleInput({ items: [{ item_id: router, quantity: 1 }, { item_id: pdcom, quantity: 5 }] }));
    expect(r.status).toBe("ok");
    expect([await balance(locA, router), await balance(locA, pdcom)]).toEqual([routers, pdcoms]);
    expect((await db.query("select 1 from public.sale_items where sale_id = $1", [r.sale_id])).rows).toHaveLength(0);
  });

  it("lets a seller without a team register a sale (the Supervisor's team stock is used at approval)", async () => {
    await db.query("update public.user_profiles set city_id = $1 where id = $2", [hargeisa, LONE]);
    expect((await sell(LONE, saleInput())).status).toBe("ok");
  });
});

describe("retries and double taps (FR-SALE-15, UAT-30)", () => {
  it("create one sale for the same request", async () => {
    const input = saleInput();
    const before = await salesCount();
    const first = await sell(AG, input);
    const again = await sell(AG, input);
    expect(again).toEqual({ ...first, existing: true });
    expect(await salesCount()).toBe(before + 1);
  });

  it("refuse another agent reusing someone's request id", async () => {
    const input = saleInput();
    await sell(AG, input);
    expect(await errorOf(sell(AG2, { ...input, district_id: districtB }))).toMatch(/INVALID_REQUEST/);
  });
});

describe("sale month (D-30, UAT-42…45)", () => {
  it("comes from the stored server time in EAT: 31 Oct 23:59 EAT is October, 1 Nov 00:10 EAT is November", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.sales limit 1");
    await db.query("alter table public.sales disable trigger sales_touch");
    await db.query("update public.sales set submitted_at = '2026-10-31T20:59:00Z' where id = $1", [rows[0].id]);
    expect((await db.query<{ m: string }>("select sale_month::text as m from public.sales where id = $1", [rows[0].id])).rows[0].m).toBe("2026-10-01");
    await db.query("update public.sales set submitted_at = '2026-10-31T21:10:00Z' where id = $1", [rows[0].id]);
    expect((await db.query<{ m: string }>("select sale_month::text as m from public.sales where id = $1", [rows[0].id])).rows[0].m).toBe("2026-11-01");
    await db.query("alter table public.sales enable trigger sales_touch");
  });

  it("cannot be set or changed by anyone through the API — no inserts, updates or deletes on sales", async () => {
    for (const user of [AG, TL, SA]) {
      expect(await errorOf(call(user, "update public.sales set submitted_at = now() - interval '60 days'")), user).toMatch(/permission denied/);
      expect(await errorOf(call(user, "delete from public.sales")), user).toMatch(/permission denied/);
      expect(await errorOf(call(user, "insert into public.sales (id) values (gen_random_uuid())")), user).toMatch(/permission denied/);
    }
  });
});

describe("who can register and see sales (FR-SALE-09, UAT-16)", () => {
  it("refuses users without sales.create and anonymous callers", async () => {
    expect(await errorOf(sell(FIN, saleInput()))).toMatch(/not allowed/);
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.create_sale('{}'::jsonb)")))).toMatch(/permission denied/);
  });

  it("shows agents their own sales and customers, Team Leaders their team, Finance everything", async () => {
    expect((await sell(AG2, saleInput({ district_id: districtB }))).status).toBe("ok");
    const seen = async (user: string) => (await call(user, "select distinct agent_id from public.sales")).rows.map((r) => (r as { agent_id: string }).agent_id).sort();
    expect(await seen(AG)).toEqual([AG]);
    expect(await seen(AG2)).toEqual([AG2]);
    expect(await seen(TL)).toEqual([TL, AG].sort());
    expect((await seen(FIN)).length).toBeGreaterThanOrEqual(4);
    const ownCustomers = (await call(AG2, "select id from public.customers")).rows.length;
    const allCustomers = await customersCount();
    expect(ownCustomers).toBeGreaterThan(0);
    expect(ownCustomers).toBeLessThan(allCustomers);
    expect(await errorOf(as(db, "anon", null, () => db.query("select * from public.sales")))).toMatch(/permission denied/);
  });
});

describe("changing a customer's phone or Index (FR-SALE-16)", () => {
  let customer: string;
  beforeAll(async () => {
    const r = await sell(AG, saleInput());
    customer = (await db.query<{ customer_id: string }>("select customer_id from public.sales where id = $1", [r.sale_id])).rows[0].customer_id;
  });

  it("is a Super Admin action with a reason, keeping the old value in history", async () => {
    expect(await errorOf(call(AG, "select public.change_customer_identifier($1, 'index', '51111111', 'typo')", [customer]))).toMatch(/not allowed/);
    expect(await errorOf(call(SA, "select public.change_customer_identifier($1, 'index', '51111111', '')", [customer]))).toMatch(/REASON_REQUIRED/);
    expect(await errorOf(call(SA, "select public.change_customer_identifier($1, 'index', '5111', 'Typo at registration')", [customer]))).toMatch(/INVALID_INDEX/);
    await call(SA, "select public.change_customer_identifier($1, 'index', '51111111', 'Typo at registration')", [customer]);
    const { rows } = await db.query<{ value: string; is_current: boolean; replace_reason: string | null }>(
      "select value, is_current, replace_reason from public.customer_identifiers where customer_id = $1 and kind = 'index' order by created_at", [customer]);
    expect(rows.map((r) => r.is_current)).toEqual([false, true]);
    expect(rows[0].replace_reason).toBe("Typo at registration");
    expect(rows[1].value).toBe("51111111");
    expect(await errorOf(call(SA, "select public.change_customer_identifier($1, 'index', $2, 'Swap back')", [customer, rows[0].value]))).toMatch(/IDENTIFIER_TAKEN/);
  });
});
