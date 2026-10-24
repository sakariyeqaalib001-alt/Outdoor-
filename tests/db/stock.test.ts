import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

let db: PGlite;

const SA = "60000000-0000-4000-8000-000000000001"; // Super Admin
const SO = "60000000-0000-4000-8000-000000000002"; // Stock Officer
const TL = "60000000-0000-4000-8000-000000000003"; // leads team A
const AG = "60000000-0000-4000-8000-000000000004"; // agent in team A
const TL2 = "60000000-0000-4000-8000-000000000005"; // leads team B
const AG2 = "60000000-0000-4000-8000-000000000006"; // agent in team B
const FIN = "60000000-0000-4000-8000-000000000007"; // Finance (reads all stock)
const LONE = "60000000-0000-4000-8000-000000000008"; // agent without a team

let teamA: string;
let teamB: string;
let locA: string;
let locB: string;
let central: string;
let faulty: string;
let router: string;
let pdcom: string;
let calix: string;

const call = (user: string, sql: string, params: unknown[] = []) => as(db, "authenticated", user, () => db.query(sql, params));
const one = async <T>(user: string, sql: string, params: unknown[] = []) =>
  (await as(db, "authenticated", user, () => db.query<T>(sql, params))).rows[0] as T;
const lines = (...l: [string, number][]) => JSON.stringify(l.map(([item_id, quantity]) => ({ item_id, quantity })));
const balance = async (loc: string, item: string) =>
  (await db.query<{ b: number }>("select app.location_balance($1, $2) as b", [loc, item])).rows[0].b;
const receive = (user: string, l: string) => one<{ id: string }>(user, "select public.stock_receive($1::jsonb, 'Delivery note 1') as id", [l]);
const send = (user: string, team: string, l: string) => one<{ id: string }>(user, "select public.stock_send($1, $2::jsonb, null) as id", [team, l]);
const accept = (user: string, transfer: string) => call(user, "select public.stock_accept($1)", [transfer]);
const issue = (seller: string, l: string) =>
  db.query("select app.issue_stock($1, $2::jsonb, 'sale', gen_random_uuid())", [seller, l]); // internal: owner only

beforeAll(async () => {
  db = await createTestDatabase();
  const people: [string, "temporary" | "permanent", string][] = [
    [SA, "permanent", "super_admin"], [SO, "permanent", "stock_officer"], [TL, "permanent", "team_leader"],
    [AG, "temporary", "agent"], [TL2, "permanent", "team_leader"], [AG2, "temporary", "agent"],
    [FIN, "permanent", "finance"], [LONE, "temporary", "agent"],
  ];
  for (const [id, type, role] of people) {
    await createUser(db, { id, type, otpVerified: true });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [id, role]);
  }
  const hargeisa = (await db.query<{ id: string }>("select id from public.cities where name = 'Hargeisa'")).rows[0].id;
  teamA = (await db.query<{ id: string }>("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL])).rows[0].id;
  teamB = (await db.query<{ id: string }>("insert into public.teams (name, city_id, team_leader_id) values ('Team B', $1, $2) returning id", [hargeisa, TL2])).rows[0].id;
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $2), ($3, $4)", [AG, teamA, AG2, teamB]);
  const loc = async (where: string, p: unknown[] = []) => (await db.query<{ id: string }>(`select id from public.stock_locations where ${where}`, p)).rows[0].id;
  locA = await loc("team_id = $1", [teamA]);
  locB = await loc("team_id = $1", [teamB]);
  central = await loc("kind = 'central'");
  faulty = await loc("kind = 'faulty'");
  const item = async (code: string) => (await db.query<{ id: string }>("select id from public.stock_items where code = $1", [code])).rows[0].id;
  router = await item("WIFI_ROUTER");
  pdcom = await item("PDCOM");
  calix = await item("CALIX");
}, 60_000);

describe("set-up (D-35)", () => {
  it("has a Central Store, a faulty store and one stock per team, created automatically", async () => {
    const { rows } = await db.query<{ kind: string; n: number }>("select kind, count(*)::int as n from public.stock_locations group by kind order by kind");
    expect(rows).toEqual([{ kind: "central", n: 1 }, { kind: "faulty", n: 1 }, { kind: "team", n: 2 }]);
  });

  it("counts stock by quantity: no item is serialized", async () => {
    expect((await db.query("select 1 from public.stock_items where is_serialized")).rows).toHaveLength(0);
  });
});

describe("receiving into Central (stock.receive)", () => {
  it("adds quantities for the Stock Officer", async () => {
    await receive(SO, lines([router, 50], [pdcom, 30], [calix, 10]));
    expect([await balance(central, router), await balance(central, pdcom), await balance(central, calix)]).toEqual([50, 30, 10]);
  });

  it("is refused for agents, Team Leaders, Finance and anonymous callers", async () => {
    for (const user of [AG, TL, FIN]) expect(await errorOf(receive(user, lines([router, 1]))), user).toMatch(/not allowed/);
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.stock_receive('[]'::jsonb)")))).toMatch(/permission denied/);
  });

  it("refuses zero, fractions, duplicates and unknown items, writing nothing", async () => {
    expect(await errorOf(receive(SO, lines([router, 0])))).toMatch(/INVALID_QUANTITY/);
    expect(await errorOf(receive(SO, lines([router, 1.5])))).toMatch(/INVALID_QUANTITY/);
    expect(await errorOf(receive(SO, lines([router, 1], [router, 2])))).toMatch(/DUPLICATE_ITEM/);
    expect(await errorOf(receive(SO, lines([router, 1], ["00000000-0000-0000-0000-000000000000", 1])))).toMatch(/UNKNOWN_ITEM/);
    expect(await errorOf(receive(SO, "[]"))).toMatch(/INVALID_LINES/);
    expect(await balance(central, router)).toBe(50);
  });
});

describe("sending to a team and accepting (FR-STK-08)", () => {
  let first: string;

  it("leaves Central at once but counts for the team only after acceptance", async () => {
    first = (await send(SO, teamA, lines([router, 10], [pdcom, 5]))).id;
    expect(await balance(central, router)).toBe(40);
    expect(await balance(locA, router)).toBe(0);
    const transit = await one<{ in_transit: number }>(SO, "select in_transit from public.stock_report(current_date, current_date) where location_id = $1 and item_id = $2", [locA, router]);
    expect(transit.in_transit).toBe(10);
  });

  it("can be accepted only by the receiving team's leader (or Super Admin)", async () => {
    for (const user of [AG, TL2, SO, FIN]) expect(await errorOf(accept(user, first)), user).toMatch(/not allowed/);
    await accept(TL, first);
    expect([await balance(locA, router), await balance(locA, pdcom)]).toEqual([10, 5]);
    expect(await errorOf(accept(TL, first))).toMatch(/ALREADY_DECIDED/);
  });

  it("lets Super Admin accept on the team's behalf", async () => {
    const { id } = await send(SO, teamB, lines([router, 5]));
    await accept(SA, id);
    expect(await balance(locB, router)).toBe(5);
  });

  it("refuses to send more than Central holds, writing nothing", async () => {
    expect(await errorOf(send(SO, teamA, lines([pdcom, 1], [calix, 11])))).toMatch(/INSUFFICIENT_STOCK/);
    expect([await balance(central, pdcom), await balance(central, calix)]).toEqual([25, 10]);
    expect(await errorOf(send(TL, teamA, lines([router, 1])))).toMatch(/not allowed/);
  });

  it("can be cancelled by the Stock Officer before acceptance: stock returns to Central", async () => {
    const { id } = await send(SO, teamA, lines([calix, 4]));
    expect(await errorOf(call(SO, "select public.stock_cancel($1, '')", [id]))).toMatch(/REASON_REQUIRED/);
    await call(SO, "select public.stock_cancel($1, 'Wrong team')", [id]);
    expect(await balance(central, calix)).toBe(10);
    expect(await errorOf(accept(TL, id))).toMatch(/ALREADY_DECIDED/);
    expect(await errorOf(call(SO, "select public.stock_cancel($1, 'Too late')", [first]))).toMatch(/ALREADY_DECIDED/);
  });
});

describe("deducting on a sale (internal app.issue_stock, used by Phase 7)", () => {
  it("deducts the picked items from the seller's team stock — agent or Team Leader", async () => {
    await issue(AG, lines([router, 1], [pdcom, 1]));
    await issue(TL, lines([router, 1]));
    expect([await balance(locA, router), await balance(locA, pdcom)]).toEqual([8, 4]);
    await issue(AG2, lines([router, 2]));
    expect(await balance(locB, router)).toBe(3);
  });

  it("never goes below zero and is all-or-nothing", async () => {
    expect(await errorOf(issue(AG, lines([router, 1], [pdcom, 5])))).toMatch(/INSUFFICIENT_STOCK/);
    expect([await balance(locA, router), await balance(locA, pdcom)]).toEqual([8, 4]);
    expect(await errorOf(issue(AG, lines([calix, 1])))).toMatch(/INSUFFICIENT_STOCK/);
  });

  it("refuses a seller without a team", async () => {
    expect(await errorOf(issue(LONE, lines([router, 1])))).toMatch(/NO_TEAM_STOCK/);
  });

  it("cannot be called through the API", async () => {
    expect(await errorOf(call(AG, "select app.issue_stock($1, $2::jsonb, 'sale', gen_random_uuid())", [AG, lines([router, 1])]))).toMatch(/permission denied/);
  });
});

describe("returns (Stock Officer only, FR-STK-10)", () => {
  it("moves a faulty unit from a team to the faulty store, with a reason", async () => {
    await call(SO, "select public.stock_return($1, $2, 1, 'faulty', 'Does not power on', false)", [teamA, router]);
    expect([await balance(locA, router), await balance(faulty, router), await balance(central, router)]).toEqual([7, 1, 35]);
  });

  it("takes equipment back from a customer into Central", async () => {
    await call(SO, "select public.stock_return(null, $1, 1, 'refund', null, false)", [pdcom]);
    expect(await balance(central, pdcom)).toBe(26);
  });

  it("requires a reason, refuses more than the team holds, and is refused for others", async () => {
    expect(await errorOf(call(SO, "select public.stock_return($1, $2, 1, 'other', '', false)", [teamA, router]))).toMatch(/REASON_REQUIRED/);
    expect(await errorOf(call(SO, "select public.stock_return($1, $2, 1, 'lost', null, false)", [teamA, router]))).toMatch(/REASON_REQUIRED/);
    expect(await errorOf(call(SO, "select public.stock_return($1, $2, 99, 'switch', null, false)", [teamA, router]))).toMatch(/INSUFFICIENT_STOCK/);
    for (const user of [AG, TL, FIN]) {
      expect(await errorOf(call(user, "select public.stock_return($1, $2, 1, 'switch', null, false)", [teamA, router])), user).toMatch(/not allowed/);
    }
  });
});

describe("adjustments (FR-STK-07)", () => {
  it("are requested by the Stock Officer and applied only when Super Admin approves", async () => {
    const { id } = await one<{ id: string }>(SO, "select public.stock_request_adjustment($1, $2, -2, 'Two routers stolen from store') as id", [central, router]);
    expect(await balance(central, router)).toBe(35);
    expect(await errorOf(call(SO, "select public.stock_decide_adjustment($1, true)", [id]))).toMatch(/not allowed/);
    await call(SA, "select public.stock_decide_adjustment($1, true, 'Police report seen')", [id]);
    expect(await balance(central, router)).toBe(33);
    const movement = await db.query<{ approved_by: string; reason: string }>("select approved_by, reason from public.stock_movements where ref_id = $1", [id]);
    expect(movement.rows[0]).toEqual({ approved_by: SA, reason: "Two routers stolen from store" });
    expect(await errorOf(call(SA, "select public.stock_decide_adjustment($1, false)", [id]))).toMatch(/ALREADY_DECIDED/);
  });

  it("need a reason, are never self-approved, and cannot push a balance below zero", async () => {
    expect(await errorOf(call(SO, "select public.stock_request_adjustment($1, $2, 1, '')", [central, router]))).toMatch(/REASON_REQUIRED/);
    const own = await one<{ id: string }>(SA, "select public.stock_request_adjustment($1, $2, 5, 'Found in store room') as id", [central, calix]);
    expect(await errorOf(call(SA, "select public.stock_decide_adjustment($1, true)", [own.id]))).toMatch(/SELF_APPROVAL/);
    const big = await one<{ id: string }>(SO, "select public.stock_request_adjustment($1, $2, -500, 'Count correction') as id", [locA, router]);
    expect(await errorOf(call(SA, "select public.stock_decide_adjustment($1, true)", [big.id]))).toMatch(/INSUFFICIENT_STOCK/);
    await call(SA, "select public.stock_decide_adjustment($1, false, 'Recount first')", [big.id]);
    expect(await balance(locA, router)).toBe(7);
  });

  it("are refused to agents and Team Leaders", async () => {
    for (const user of [AG, TL]) {
      expect(await errorOf(call(user, "select public.stock_request_adjustment($1, $2, 1, 'Extra unit')", [locA, router])), user).toMatch(/not allowed/);
    }
  });
});

describe("the ledger", () => {
  it("cannot be changed or deleted by anyone, nor written directly", async () => {
    expect(await errorOf(db.query("update public.stock_movements set quantity = 99"))).toMatch(/append-only|not allowed|cannot/i);
    expect(await errorOf(db.query("delete from public.stock_movements"))).toMatch(/append-only|not allowed|cannot/i);
    for (const sql of ["update public.stock_movements set quantity = 99", "delete from public.stock_movements", "insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('receipt', gen_random_uuid(), 1, gen_random_uuid())"]) {
      expect(await errorOf(call(SA, sql)), sql).toMatch(/permission denied/);
    }
    expect(await errorOf(call(SO, "update public.stock_transfers set status = 'accepted'"))).toMatch(/permission denied/);
  });

  it("records who did each movement", async () => {
    const { rows } = await db.query<{ movement_type: string; actor_id: string }>(
      "select movement_type, actor_id from public.stock_movements where movement_type in ('receipt', 'transfer_in') order by occurred_at limit 2"
    );
    expect(rows.map((r) => r.actor_id)).toEqual([SO, SO]);
  });
});

describe("visibility and the stock report (FR-STK-04)", () => {
  type Row = {
    location_id: string; item_id: string; opening: number; received: number; transferred_in: number; transferred_out: number;
    issued: number; returned_in: number; returned_out: number; adjusted: number; closing: number; in_transit: number;
  };
  const report = async (user: string) =>
    (await as(db, "authenticated", user, () => db.query<Row>("select * from public.stock_report('2000-01-01', current_date + 1)"))).rows;

  it("reconciles: closing = opening + in − out for every row, and equals the ledger balance", async () => {
    const rows = await report(SA);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.closing).toBe(r.opening + r.received + r.transferred_in - r.transferred_out - r.issued + r.returned_in - r.returned_out + r.adjusted);
      expect(r.closing).toBe(await balance(r.location_id, r.item_id));
      expect(r.closing).toBeGreaterThanOrEqual(0);
    }
  });

  it("shows agents and Team Leaders only their own team; Finance and the Stock Officer see all", async () => {
    for (const [user, loc] of [[AG, locA], [TL, locA], [AG2, locB], [TL2, locB]]) {
      expect(new Set((await report(user)).map((r) => r.location_id)), user).toEqual(new Set([loc]));
      // Every movement they can see touches their own team (e.g. a delivery from Central to them).
      const movements = await as(db, "authenticated", user, () =>
        db.query<{ from_location_id: string | null; to_location_id: string | null }>("select from_location_id, to_location_id from public.stock_movements")
      );
      expect(movements.rows.length).toBeGreaterThan(0);
      for (const m of movements.rows) expect([m.from_location_id, m.to_location_id], user).toContain(loc);
    }
    for (const user of [FIN, SO]) expect(new Set((await report(user)).map((r) => r.location_id))).toEqual(new Set([central, faulty, locA, locB]));
    expect((await call(LONE, "select * from public.stock_movements")).rows).toHaveLength(0);
    expect(await errorOf(as(db, "anon", null, () => db.query("select * from public.stock_movements")))).toMatch(/permission denied/);
  });
});

describe("Outdoor Supervisor lookup (stock_supervisors)", () => {
  it("names each team's Supervisor for stock users, and nothing for others", async () => {
    await db.query("update public.user_profiles set full_name = 'Supervisor A' where id = $1", [TL]);
    const rows = (await call(SO, "select team_id, supervisor_id, supervisor_name from public.stock_supervisors()")).rows as {
      team_id: string; supervisor_id: string; supervisor_name: string;
    }[];
    expect(rows.find((r) => r.team_id === teamA)).toEqual({ team_id: teamA, supervisor_id: TL, supervisor_name: "Supervisor A" });
    expect(rows).toHaveLength(2);
    expect((await call(AG, "select team_id from public.stock_supervisors()")).rows).toEqual([{ team_id: teamA }]);
    expect((await call(LONE, "select * from public.stock_supervisors()")).rows).toHaveLength(0);
    expect(await errorOf(as(db, "anon", null, () => db.query("select * from public.stock_supervisors()")))).toMatch(/permission denied/);
  });
});

describe("one-time test-data reset (supabase/maintenance/reset_stock_test_data.sql)", () => {
  const script = readFileSync(path.resolve(import.meta.dirname, "../../supabase/maintenance/reset_stock_test_data.sql"), "utf8");

  it("clears every movement, issue and adjustment, keeps locations, re-locks the ledger and logs the reset", async () => {
    const fresh = await createTestDatabase();
    await fresh.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) select 'receipt', i.id, 3, l.id from public.stock_items i, public.stock_locations l where l.kind = 'central'");
    await fresh.exec(script);
    expect((await fresh.query("select 1 from public.stock_movements")).rows).toHaveLength(0);
    expect((await fresh.query("select 1 from public.stock_locations")).rows.length).toBeGreaterThan(0);
    expect((await fresh.query("select 1 from public.activity_log where action = 'stock.test_data_reset'")).rows).toHaveLength(1);
    await fresh.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) select 'receipt', i.id, 1, l.id from public.stock_items i, public.stock_locations l where l.kind = 'central' limit 1");
    expect(await errorOf(fresh.query("delete from public.stock_movements"))).not.toBeNull(); // locked again
    await fresh.close();
  });

  it("refuses once any sale exists", async () => {
    const fresh = await createTestDatabase();
    // A stand-in sale row (foreign keys switched off for this insert only).
    await fresh.exec(`
      set session_replication_role = replica;
      insert into public.sales (client_request_id, customer_id, customer_name, agent_id, customer_type, product_id, plan_id,
        plan_price_id, unit_price, installation_fee, months_paid, amount_collected, city_id, district_id, area_text, branch_id, status)
      values (gen_random_uuid(), gen_random_uuid(), 'X', gen_random_uuid(), 'new', gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), 25, 0, 1, 25, gen_random_uuid(), gen_random_uuid(), 'Area', gen_random_uuid(), 'approved');
      set session_replication_role = origin;`);
    expect(await errorOf(fresh.exec(script))).toMatch(/Sales exist/);
    await fresh.close();
  });
});
