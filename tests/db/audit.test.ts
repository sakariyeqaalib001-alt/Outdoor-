import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf } from "./harness";

let db: PGlite;

const SA = "90000000-0000-4000-8000-000000000001"; // Super Admin
const TL = "90000000-0000-4000-8000-000000000002"; // leads team A
const AG = "90000000-0000-4000-8000-000000000003"; // agent, team A
const AG2 = "90000000-0000-4000-8000-000000000004"; // agent, team A
const AG3 = "90000000-0000-4000-8000-000000000005"; // agent, team A
const AUD = "90000000-0000-4000-8000-000000000006"; // Auditor
const AUD2 = "90000000-0000-4000-8000-000000000007"; // another Auditor

let district: string;
let branch: string;
let fttaBasic: string;
let router: string;

type Result = { status: string; sale_id?: string; rule?: string; field?: string };
const call = (user: string | null, sql: string, params: unknown[] = []) =>
  as(db, user ? "authenticated" : "anon", user, () => db.query(sql, params));
const rows = async <T>(user: string, sql: string, params: unknown[] = []) =>
  (await as(db, "authenticated", user, () => db.query<T>(sql, params))).rows;

let seq = 3000000;
const phone = () => `063${seq++}`;
let idx = 70000000;
const index = () => String(idx++);

async function sell(user: string, overrides: Record<string, unknown> = {}): Promise<Result> {
  const input = {
    client_request_id: randomUUID(), customer_type: "new", full_name: "Amina Yusuf", phone: phone(), index: index(),
    district_id: district, area: "Market", branch_id: branch, plan_id: fttaBasic, months_paid: 1, free_month: false, ...overrides,
  };
  const { rows: r } = await as(db, "authenticated", user, () => db.query<{ r: Result }>("select public.create_sale($1::jsonb) as r", [JSON.stringify(input)]));
  return r[0].r;
}
const approve = (user: string, sale: string) =>
  call(user, "select public.approve_sale($1, $2::jsonb)", [sale, JSON.stringify([{ item_id: router, quantity: 1 }])]);
const customerOf = async (sale: string) => (await db.query<{ c: string }>("select customer_id as c from public.sales where id = $1", [sale])).rows[0].c;
const events = async (rule: string, customer?: string) =>
  (await db.query<{ id: string; actor_id: string; attempted_values: Record<string, unknown>; context: Record<string, string> }>(
    `select id, actor_id, attempted_values, context from public.audit_events where rule_code = $1 ${customer ? "and matched_entity_id = $2" : ""} order by occurred_at`,
    customer ? [rule, customer] : [rule])).rows;
const caseOf = async (customer: string) =>
  (await db.query<{ id: string; case_no: string; status: string; rule_code: string }>(
    "select id, case_no, status, rule_code from public.audit_cases where group_key = $1", [`customer:${customer}`])).rows;
const links = async (caseId: string) =>
  (await db.query<{ entity_type: string; entity_id: string }>("select entity_type, entity_id from public.audit_case_links where case_id = $1", [caseId])).rows;
const history = async (caseId: string) =>
  (await db.query<{ action: string; from_status: string | null; to_status: string | null; actor_id: string | null; note: string }>(
    "select action, from_status, to_status, actor_id, note from public.audit_case_history where case_id = $1 order by at, action", [caseId])).rows;
const setStatus = (user: string, c: string, s: string, note: string | null = "Checked with the agent") =>
  call(user, "select public.audit_case_set_status($1, $2, $3)", [c, s, note]);
const state = async (sale: string) => (await db.query<{ s: string | null }>("select app.sale_audit_state($1) as s", [sale])).rows[0].s;
const hold = async (agent: string) => (await db.query<{ h: boolean }>("select app.agent_audit_hold($1) as h", [agent])).rows[0].h;

beforeAll(async () => {
  db = await createTestDatabase();
  const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  const hargeisa = await id("select id from public.cities where name = 'Hargeisa'");
  for (const [user, type, role] of [
    [SA, "permanent", "super_admin"], [TL, "permanent", "team_leader"], [AG, "temporary", "agent"], [AG2, "temporary", "agent"],
    [AG3, "temporary", "agent"], [AUD, "permanent", "auditor"], [AUD2, "permanent", "auditor"],
  ] as const) {
    await createUser(db, { id: user, type, otpVerified: true, fullName: `Person ${user.slice(-1)}` });
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
  }
  await db.query("update public.user_profiles set city_id = $1", [hargeisa]);
  const team = await id("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL]);
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $4), ($2, $4), ($3, $4)", [AG, AG2, AG3, team]);
  district = await id("insert into public.districts (city_id, name) values ($1, '26 June') returning id", [hargeisa]);
  branch = await id("select id from public.branches where name = 'HQ'");
  fttaBasic = await id("select pl.id from public.plans pl join public.products p on p.id = pl.product_id where p.code = 'FTTA' and pl.name = 'SO-Basic'");
  router = await id("select id from public.stock_items where code = 'WIFI_ROUTER'");
  const loc = await id("select id from public.stock_locations where team_id = $1", [team]);
  await db.query("insert into public.stock_movements (movement_type, item_id, quantity, to_location_id) values ('transfer_in', $1, 50, $2)", [router, loc]);
}, 60_000);

describe("rules (SDD §11.2, D-41)", () => {
  it("are seeded with the owner's choices", async () => {
    const r = await rows<{ code: string; enabled: boolean; opens_case: boolean; can_disable: boolean }>(SA,
      "select code, enabled, opens_case, can_disable from public.audit_rules order by sort_order");
    const by = Object.fromEntries(r.map((x) => [x.code, x]));
    for (const core of ["DUP_PHONE", "DUP_INDEX", "IDENTITY_CONFLICT", "SAME_MONTH", "SWITCH_MISMATCH"]) {
      expect(by[core]).toMatchObject({ enabled: true, can_disable: false, opens_case: true });
    }
    expect(by.MULTI_AGENT_ATTEMPT.enabled).toBe(true);
    expect(by.POST_APPROVAL_EDIT.enabled).toBe(true);
    expect(by.BURST.enabled).toBe(false);
    expect(by.SELF_APPROVED).toMatchObject({ enabled: true, opens_case: false });
    expect(by.IDENTITY_CORRECTED).toMatchObject({ enabled: true, opens_case: false });
  });

  it("only Super Admin changes them; core rules stay on; thresholds are checked", async () => {
    expect(await errorOf(call(AG, "select public.audit_rule_update('BURST', true, '{\"sales\":2,\"minutes\":30}')"))).toMatch(/not allowed/);
    expect(await errorOf(call(AUD, "select public.audit_rule_update('BURST', true, '{\"sales\":2,\"minutes\":30}')"))).toMatch(/not allowed/);
    expect(await errorOf(call(null, "select public.audit_rule_update('BURST', true, '{}')"))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "select public.audit_rule_update('DUP_PHONE', false, '{}')"))).toMatch(/RULE_REQUIRED/);
    expect(await errorOf(call(SA, "select public.audit_rule_update('BURST', true, '{\"sales\":1,\"minutes\":30}')"))).toMatch(/THRESHOLD_INVALID/);
    expect(await errorOf(call(SA, "select public.audit_rule_update('BURST', true, '{\"sales\":\"x\",\"minutes\":30}')"))).toMatch(/THRESHOLD_INVALID/);
    expect(await errorOf(call(AG, "update public.audit_rules set enabled = false where code = 'DUP_INDEX'"))).toMatch(/permission denied/);
  });

  it("agents cannot read rules, events, cases or the email queue", async () => {
    expect(await rows(AG, "select 1 from public.audit_rules")).toHaveLength(0);
    expect(await rows(AG, "select 1 from public.audit_events")).toHaveLength(0);
    expect(await rows(AG, "select 1 from public.audit_cases")).toHaveLength(0);
    expect(await errorOf(call(SA, "select 1 from public.email_outbox"))).toMatch(/permission denied/);
    expect(await errorOf(call(AG, "select public.email_outbox_summary()"))).toMatch(/not allowed/);
  });
});

describe("duplicate attempt → event, case and alert (FR-AUD-01…03, UAT-03, UAT-04)", () => {
  let customer: string;
  let caseId: string;
  const p = phone();

  beforeAll(async () => {
    const first = await sell(AG, { phone: p });
    customer = await customerOf(first.sale_id!);
    const dup = await sell(AG, { phone: p });
    expect(dup).toMatchObject({ status: "duplicate", rule: "DUP_PHONE" });
  });

  it("opens one case linked to the event, the matching customer and the agent", async () => {
    const [c] = await caseOf(customer);
    caseId = c.id;
    expect(c).toMatchObject({ status: "open", rule_code: "DUP_PHONE" });
    const l = await links(caseId);
    const [event] = await events("DUP_PHONE", customer);
    expect(l).toEqual(expect.arrayContaining([
      { entity_type: "audit_events", entity_id: event.id },
      { entity_type: "customers", entity_id: customer },
      { entity_type: "user_profiles", entity_id: AG },
    ]));
    expect((await history(caseId))[0]).toMatchObject({ action: "opened", to_status: "open", actor_id: null });
  });

  it("alerts Super Admin in-app and by email, without phone or Index", async () => {
    const n = (await db.query<{ data: Record<string, string> }>(
      "select data from public.notifications where user_id = $1 and kind = 'audit_alert' and entity_id = $2", [SA, caseId])).rows;
    expect(n).toHaveLength(1);
    expect(n[0].data).toMatchObject({ rule: "DUP_PHONE", new_case: "true" });
    expect(JSON.stringify(n[0].data)).not.toContain(p.slice(3));
    const mail = (await db.query<{ status: string; to_email: string; subject: string; body: string; link_path: string }>(
      "select o.status, o.to_email, o.subject, o.body, o.link_path from public.email_outbox o where o.user_id = $1 and o.link_path = $2", [SA, `/audit/cases/${caseId}`])).rows;
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ status: "pending", link_path: `/audit/cases/${caseId}` });
    expect(mail[0].to_email).toMatch(/@example\.test$/);
    expect(mail[0].subject + mail[0].body).not.toContain(p.slice(3));
    expect(mail[0].subject).toContain("Duplicate phone number");
  });

  it("groups a second attempt on the same customer into the same case", async () => {
    const idx2 = (await db.query<{ v: string }>("select value as v from public.customer_identifiers where customer_id = $1 and kind = 'index'", [customer])).rows[0].v;
    expect(await sell(AG2, { index: idx2 })).toMatchObject({ status: "duplicate", rule: "DUP_INDEX" });
    const cases = await caseOf(customer);
    expect(cases).toHaveLength(1);
    const l = await links(cases[0].id);
    expect(l.filter((x) => x.entity_type === "audit_events").length).toBeGreaterThanOrEqual(2);
    expect(l).toContainEqual({ entity_type: "user_profiles", entity_id: AG2 });
    expect((await history(cases[0].id)).some((h) => h.action === "linked")).toBe(true);
  });

  it("MULTI_AGENT_ATTEMPT fires when a second agent attempts the same customer (on by D-41)", async () => {
    const m = await events("MULTI_AGENT_ATTEMPT", customer);
    expect(m).toHaveLength(1);
    expect(m[0].attempted_values).toMatchObject({ agents: 2, days: 30 });
    expect((await caseOf(customer))).toHaveLength(1);
  });

  it("auditors and Super Admin can read cases; history and links included", async () => {
    expect(await rows(AUD, "select 1 from public.audit_cases where id = $1", [caseId])).toHaveLength(1);
    expect((await rows(SA, "select 1 from public.audit_case_history where case_id = $1", [caseId])).length).toBeGreaterThan(0);
    expect(await rows(AG, "select 1 from public.audit_case_links")).toHaveLength(0);
  });
});

describe("cases cannot be edited or deleted (FR-AUD-05)", () => {
  let caseId: string;

  beforeAll(async () => {
    caseId = (await db.query<{ id: string }>("select id from public.audit_cases order by case_no limit 1")).rows[0].id;
  });

  it("refuses direct writes through the API", async () => {
    expect(await errorOf(call(SA, "update public.audit_cases set status = 'resolved' where id = $1", [caseId]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "delete from public.audit_cases where id = $1", [caseId]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "delete from public.audit_case_history where case_id = $1", [caseId]))).toMatch(/permission denied/);
    expect(await errorOf(call(SA, "insert into public.audit_case_links (case_id, entity_type, entity_id) values ($1, 'sales', $1)", [caseId]))).toMatch(/permission denied/);
  });

  it("refuses even the database owner", async () => {
    expect(await errorOf(db.query("delete from public.audit_cases where id = $1", [caseId]))).toMatch(/append-only|not allowed|cannot/i);
    expect(await errorOf(db.query("update public.audit_cases set title = 'Changed' where id = $1", [caseId]))).toMatch(/AUDIT_CASE_IMMUTABLE/);
    expect(await errorOf(db.query("update public.audit_case_history set note = 'x' where case_id = $1", [caseId]))).toMatch(/append-only|not allowed|cannot/i);
    expect(await errorOf(db.query("delete from public.audit_case_links where case_id = $1", [caseId]))).toMatch(/append-only|not allowed|cannot/i);
    expect(await errorOf(db.query("delete from public.audit_events"))).toMatch(/append-only|not allowed|cannot/i);
  });
});

describe("case lifecycle and who may change it (FR-AUD-04, FR-AUD-07, D-13)", () => {
  let caseId: string;
  let sale: string;

  beforeAll(async () => {
    sale = (await sell(AG3)).sale_id!;
    await approve(TL, sale);
    const { rows: r } = await call(SA, "select public.audit_case_create('Check sale paperwork', 'Branch reported a missing form', $1) as id", [sale]);
    caseId = (r[0] as { id: string }).id;
  });

  it("manual cases: Super Admin only; linked to the sale, its agent and customer", async () => {
    expect(await errorOf(call(AUD, "select public.audit_case_create('x title', 'note here')"))).toMatch(/not allowed/);
    expect(await errorOf(call(AG, "select public.audit_case_create('x title', 'note here')"))).toMatch(/not allowed/);
    expect(await errorOf(call(SA, "select public.audit_case_create('x title', '')"))).toMatch(/NOTE_REQUIRED/);
    expect(await links(caseId)).toEqual(expect.arrayContaining([
      { entity_type: "sales", entity_id: sale }, { entity_type: "user_profiles", entity_id: AG3 },
      { entity_type: "customers", entity_id: await customerOf(sale) },
    ]));
  });

  it("an open case puts the sale and the agent on hold (FR-AUD-08)", async () => {
    expect(await state(sale)).toBe("on_hold");
    expect(await hold(AG3)).toBe(true);
  });

  it("an unassigned Auditor, agents and Team Leaders cannot change the case", async () => {
    for (const user of [AUD, AG, TL]) expect(await errorOf(setStatus(user, caseId, "under_review"))).toMatch(/not allowed/);
    expect(await errorOf(call(null, "select public.audit_case_set_status($1, 'under_review', 'note')", [caseId]))).toMatch(/permission denied/);
  });

  it("Super Admin assigns it to an Auditor, who is notified (in-app + email)", async () => {
    expect(await errorOf(call(AUD, "select public.audit_case_assign($1, $2, null)", [caseId, AUD]))).toMatch(/not allowed/);
    expect(await errorOf(call(SA, "select public.audit_case_assign($1, $2, null)", [caseId, AG]))).toMatch(/ASSIGNEE_INVALID/);
    await call(SA, "select public.audit_case_assign($1, $2, null)", [caseId, AUD]);
    expect((await db.query("select 1 from public.notifications where user_id = $1 and kind = 'audit_case_assigned' and entity_id = $2", [AUD, caseId])).rows).toHaveLength(1);
    expect((await db.query("select 1 from public.email_outbox where user_id = $1 and status = 'pending' and subject like 'Audit case #%'", [AUD])).rows).toHaveLength(1);
    expect(await errorOf(setStatus(AUD2, caseId, "under_review"))).toMatch(/not allowed/);
  });

  it("follows Open → Under Review → Confirmed Issue → Resolved, a note each time", async () => {
    expect(await errorOf(setStatus(AUD, caseId, "resolved"))).toMatch(/INVALID_TRANSITION/);
    expect(await errorOf(setStatus(AUD, caseId, "confirmed_issue"))).toMatch(/INVALID_TRANSITION/);
    expect(await errorOf(setStatus(AUD, caseId, "under_review", " "))).toMatch(/NOTE_REQUIRED/);
    await setStatus(AUD, caseId, "under_review");
    expect(await state(sale)).toBe("on_hold");
    await setStatus(AUD, caseId, "confirmed_issue", "Form was signed by someone else");
    expect(await state(sale)).toBe("confirmed_issue");
    expect(await hold(AG3)).toBe(false);
    await setStatus(SA, caseId, "resolved", "Agent warned; sale excluded");
    expect(await state(sale)).toBe("confirmed_issue"); // stays ineligible after Resolved
    expect(await errorOf(setStatus(SA, caseId, "open"))).toMatch(/INVALID_TRANSITION/);
    const h = await history(caseId);
    expect(h.filter((x) => x.action === "status").map((x) => `${x.from_status}>${x.to_status}`))
      .toEqual(["open>under_review", "under_review>confirmed_issue", "confirmed_issue>resolved"]);
    expect(await errorOf(call(SA, "select public.audit_case_assign($1, $2, null)", [caseId, AUD2]))).toMatch(/CASE_RESOLVED/);
  });

  it("False Positive leaves the sale unaffected", async () => {
    const other = (await sell(AG3)).sale_id!;
    await approve(TL, other);
    const { rows: r } = await call(SA, "select public.audit_case_create('Possible duplicate', 'Two similar names', $1) as id", [other]);
    const c = (r[0] as { id: string }).id;
    expect(await state(other)).toBe("on_hold");
    await setStatus(SA, c, "under_review");
    await setStatus(SA, c, "false_positive", "Different people, same family");
    expect(await state(other)).toBeNull();
    expect(await hold(AG3)).toBe(false);
    await setStatus(SA, c, "resolved", "Closed");
    expect(await state(other)).toBeNull();
  });

  it("notes are added by the case managers only", async () => {
    await call(AUD, "select public.audit_case_add_note($1, 'Called the customer')", [caseId]);
    expect(await errorOf(call(AG, "select public.audit_case_add_note($1, 'hello there')", [caseId]))).toMatch(/not allowed/);
    expect((await history(caseId)).some((h) => h.action === "note" && h.note === "Called the customer")).toBe(true);
  });
});

describe("other rules", () => {
  it("IDENTITY_CORRECTED: Super Admin correcting an approved customer's phone is recorded, with no case and no hold (D-41)", async () => {
    const sale = (await sell(AG3)).sale_id!;
    await approve(TL, sale);
    const customer = await customerOf(sale);
    await call(SA, "select public.change_customer_identifier($1, 'phone', $2, 'Typo in phone')", [customer, phone()]);
    const [e] = await events("IDENTITY_CORRECTED", customer);
    expect(e.attempted_values).toMatchObject({ field: "phone", reason: "Typo in phone" });
    expect(e.context).toMatchObject({ sale_id: sale, agent_id: AG3 });
    expect(await events("POST_APPROVAL_EDIT", customer)).toHaveLength(0);
    expect(await caseOf(customer)).toHaveLength(0);
    expect(await hold(AG3)).toBe(false);
    expect(await state(sale)).toBeNull();
  });

  it("IDENTITY_CORRECTED is not raised for a customer without an approved sale", async () => {
    const sale = (await sell(AG2)).sale_id!;
    const customer = await customerOf(sale);
    await call(SA, "select public.change_customer_identifier($1, 'index', $2, 'Wrong Index')", [customer, index()]);
    expect(await events("IDENTITY_CORRECTED", customer)).toHaveLength(0);
  });

  it("POST_APPROVAL_EDIT: an approved sale changed directly opens a case linked to the sale and its agent", async () => {
    const sale = (await sell(AG)).sale_id!;
    await approve(TL, sale);
    const customer = await customerOf(sale);
    await db.query("update public.sales set area_text = 'Changed area' where id = $1", [sale]);
    const [e] = await events("POST_APPROVAL_EDIT", customer);
    expect(e.attempted_values).toMatchObject({ field: "sale", changed: ["area_text"] });
    const [c] = await caseOf(customer);
    expect(await links(c.id)).toEqual(expect.arrayContaining([{ entity_type: "sales", entity_id: sale }, { entity_type: "user_profiles", entity_id: AG }]));
    expect(await state(sale)).toBe("on_hold");
  });

  it("MULTI_AGENT_ATTEMPT holds only the agent who made the blocked attempt, not the original seller", async () => {
    const p = phone();
    const first = (await sell(AG3, { phone: p })).sale_id!;
    await approve(TL, first);
    const customer = await customerOf(first);
    expect(await hold(AG3)).toBe(false);
    expect(await sell(AG2, { phone: p })).toMatchObject({ status: "duplicate" });
    expect(await events("MULTI_AGENT_ATTEMPT", customer)).toHaveLength(1);
    const [c] = await caseOf(customer);
    const agents = (await links(c.id)).filter((l) => l.entity_type === "user_profiles").map((l) => l.entity_id);
    expect(agents).toEqual([AG2]);
    expect(await hold(AG3)).toBe(false);
    expect(await state(first)).toBeNull();
  });

  it("MULTI_AGENT_ATTEMPT ignores a normal Retention sale by another agent", async () => {
    const p = phone();
    const i = index();
    const first = (await sell(AG, { phone: p, index: i, full_name: "Faisa Omar" })).sale_id!;
    await approve(TL, first);
    // Move the first sale to last month so a Retention this month is allowed.
    await db.query("alter table public.sales disable trigger sales_post_approval");
    await db.query("update public.sales set submitted_at = (date_trunc('month', now() at time zone 'Africa/Nairobi') - interval '12 hours') at time zone 'Africa/Nairobi' where id = $1", [first]);
    await db.query("alter table public.sales enable trigger sales_post_approval");
    const customer = await customerOf(first);
    const renewal = await sell(AG2, { customer_type: "retention", phone: p, index: i, full_name: "Faisa Omar" });
    expect(renewal.status).toBe("ok");
    expect(await events("MULTI_AGENT_ATTEMPT", customer)).toHaveLength(0);
    expect(await caseOf(customer)).toHaveLength(0);
  });

  it("SELF_APPROVED: a Team Leader approving their own sale is recorded, with no case (D-40, D-41)", async () => {
    const sale = (await sell(TL)).sale_id!;
    await approve(TL, sale);
    const e = (await db.query<{ id: string; matched_entity_id: string }>("select id, matched_entity_id from public.audit_events where rule_code = 'SELF_APPROVED'")).rows;
    expect(e.map((x) => x.matched_entity_id)).toContain(sale);
    expect((await db.query("select 1 from public.audit_case_links where entity_type = 'audit_events' and entity_id = any($1)", [e.map((x) => x.id)])).rows).toHaveLength(0);
    expect(await state(sale)).toBeNull();
  });

  it("an agent's sale approved by the leader is not SELF_APPROVED", async () => {
    const sale = (await sell(AG)).sale_id!;
    await approve(TL, sale);
    expect((await db.query("select 1 from public.audit_events where rule_code = 'SELF_APPROVED' and matched_entity_id = $1", [sale])).rows).toHaveLength(0);
  });

  it("BURST is off by default and fires once enabled", async () => {
    const before = (await events("BURST")).length;
    await sell(AG);
    await sell(AG);
    expect(await events("BURST")).toHaveLength(before);
    await call(SA, "select public.audit_rule_update('BURST', true, '{\"sales\": 2, \"minutes\": 30}')");
    await sell(AG);
    const burst = await events("BURST");
    expect(burst).toHaveLength(before + 1);
    expect(burst.at(-1)!.context).toMatchObject({ agent_id: AG });
    await sell(AG);
    expect(await events("BURST")).toHaveLength(before + 1); // once per window
    const c = (await db.query<{ id: string }>("select id from public.audit_cases where group_key = $1", [`agent:${AG}`])).rows;
    expect(c).toHaveLength(1);
    expect((await db.query("select 1 from public.activity_log where action = 'audit.rule_update'")).rows.length).toBeGreaterThan(0);
  });

  it("a switched-off optional rule records nothing", async () => {
    await call(SA, "select public.audit_rule_update('MULTI_AGENT_ATTEMPT', false, '{\"agents\": 2, \"days\": 30}')");
    const first = await sell(AG);
    const customer = await customerOf(first.sale_id!);
    const p = (await db.query<{ v: string }>("select value as v from public.customer_identifiers where customer_id = $1 and kind = 'phone'", [customer])).rows[0].v;
    await sell(AG2, { phone: p });
    expect(await events("MULTI_AGENT_ATTEMPT", customer)).toHaveLength(0);
    expect(await events("DUP_PHONE", customer)).toHaveLength(1); // core rule still recorded
  });

  it("email queue summary is available to Super Admin", async () => {
    const { rows: r } = await call(SA, "select public.email_outbox_summary() as s");
    expect((r[0] as { s: { pending: number } }).s.pending).toBeGreaterThan(0);
  });
});
