import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, DEFAULT_SESSION, errorOf } from "./harness";

let db: PGlite;

const SA = "20000000-0000-4000-8000-000000000001"; // Super Admin
const TL = "20000000-0000-4000-8000-000000000002"; // Team Leader
const AG1 = "20000000-0000-4000-8000-000000000003"; // agent in TL's team
const AG2 = "20000000-0000-4000-8000-000000000004"; // agent in another team
const FIN = "20000000-0000-4000-8000-000000000005"; // Finance
const AUD = "20000000-0000-4000-8000-000000000006"; // Auditor / Management
const FU = "20000000-0000-4000-8000-000000000007"; // Follow-up
const SO = "20000000-0000-4000-8000-000000000008"; // Stock Officer
const SPARE = "20000000-0000-4000-8000-000000000009"; // plain user for edits

let hargeisa: string;
let burco: string;
let hqBranch: string;
let burcoBranch: string;
let teamA: string;
let teamB: string;

async function grantRole(user: string, role: string) {
  await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [user, role]);
}
async function verifyOtp(user: string) {
  await db.query("insert into public.otp_verified_sessions (session_id, user_id) values ($1, $2)", [DEFAULT_SESSION, user]);
}
const asUser = <T>(user: string, fn: () => Promise<T>) => as(db, "authenticated", user, fn);

beforeAll(async () => {
  db = await createTestDatabase();
  hargeisa = (await db.query<{ id: string }>("select id from public.cities where name = 'Hargeisa'")).rows[0].id;
  burco = (await db.query<{ id: string }>("select id from public.cities where name = 'Burco'")).rows[0].id;
  hqBranch = (await db.query<{ id: string }>("select id from public.branches where name = 'HQ'")).rows[0].id;
  burcoBranch = (await db.query<{ id: string }>("select id from public.branches where name = 'Burco Deero'")).rows[0].id;

  for (const [id, type] of [
    [SA, "permanent"], [TL, "permanent"], [AG1, "temporary"], [AG2, "temporary"], [FIN, "permanent"],
    [AUD, "permanent"], [FU, "permanent"], [SO, "permanent"], [SPARE, "permanent"],
  ] as const) {
    await createUser(db, { id, type, phone: type === "temporary" ? `+2526340001${id.slice(-2)}` : undefined });
  }
  await verifyOtp(AG1);
  await db.query("insert into public.otp_verified_sessions (session_id, user_id) values ('00000000-0000-4000-9000-0000000000a2', $1)", [AG2]);

  await grantRole(SA, "super_admin");
  await grantRole(TL, "team_leader");
  await grantRole(AG1, "agent");
  await grantRole(AG2, "agent");
  await grantRole(FIN, "finance");
  await grantRole(AUD, "auditor");
  await grantRole(FU, "follow_up");
  await grantRole(SO, "stock_officer");

  teamA = (await db.query<{ id: string }>("insert into public.teams (name, city_id, team_leader_id) values ('Team A', $1, $2) returning id", [hargeisa, TL])).rows[0].id;
  teamB = (await db.query<{ id: string }>("insert into public.teams (name, city_id) values ('Team B', $1) returning id", [burco])).rows[0].id;
  await db.query("insert into public.team_members (user_id, team_id) values ($1, $2), ($3, $4)", [AG1, teamA, AG2, teamB]);
}, 60_000);

const visibleProfiles = async (user: string, session = DEFAULT_SESSION) =>
  (
    await as(db, "authenticated", user, () => db.query<{ id: string }>("select id from public.user_profiles order by id"), session)
  ).rows.map((r) => r.id);

describe("reference data (BRD §4, §6.2.1, SDD §7.1)", () => {
  it("seeds the 4 cities and 16 branches", async () => {
    const { rows } = await db.query<{ city: string; n: number }>(
      "select c.name as city, count(b.*)::int as n from public.cities c join public.branches b on b.city_id = c.id group by c.name"
    );
    expect(Object.fromEntries(rows.map((r) => [r.city, r.n]))).toEqual({ Hargeisa: 11, Burco: 2, Borama: 2, Berbera: 1 });
  });

  it("seeds the 7 roles of BRD §4 and gives Super Admin every permission", async () => {
    const roles = await db.query<{ key: string }>("select key from public.roles order by sort_order");
    expect(roles.rows.map((r) => r.key)).toEqual(["super_admin", "team_leader", "agent", "follow_up", "stock_officer", "finance", "auditor"]);
    const missing = await db.query<{ n: number }>(
      "select count(*)::int as n from public.permissions p where not exists (select 1 from public.role_permissions rp where rp.role_key = 'super_admin' and rp.permission_key = p.key and rp.scope = 'all')"
    );
    expect(missing.rows[0].n).toBe(0);
  });

  it("is readable by active users only", async () => {
    expect((await asUser(AG1, () => db.query("select * from public.branches"))).rows).toHaveLength(16);
    expect(await errorOf(as(db, "anon", null, () => db.query("select * from public.branches")))).toMatch(/permission denied/);
  });
});

describe("my_access and scopes (D-22 matrix)", () => {
  const access = async (user: string, session = DEFAULT_SESSION) =>
    (
      await as(db, "authenticated", user, () => db.query<{ a: { roles: string[]; permissions: Record<string, string> } }>("select public.my_access() as a"), session)
    ).rows[0].a;

  it("reports the caller's roles and scopes", async () => {
    const a = await access(TL);
    expect(a.roles).toEqual(["team_leader"]);
    expect(a.permissions["retention.review"]).toBe("team");
    expect(a.permissions["users.manage"]).toBeUndefined();
  });

  it("gives agents own-scope sales and no admin rights", async () => {
    const a = await access(AG1);
    expect(a.permissions["sales.create"]).toBe("own");
    expect(a.permissions["sales.read"]).toBe("own");
    expect(a.permissions["users.read"]).toBeUndefined();
    expect(a.permissions["refunds.approve"]).toBeUndefined();
  });

  it("keeps refund approval and settings for Super Admin only", async () => {
    for (const user of [TL, AG1, FIN, AUD, FU, SO]) {
      const a = await access(user);
      expect(a.permissions["refunds.approve"], user).toBeUndefined();
      expect(a.permissions["settings.manage"], user).toBeUndefined();
      expect(a.permissions["users.manage"], user).toBeUndefined();
    }
    expect((await access(SA)).permissions["refunds.approve"]).toBe("all");
  });

  it("gives an agent who has not passed OTP no permissions at all", async () => {
    const a = await access(AG1, "00000000-0000-4000-9000-0000000000ff");
    expect(a).toEqual({ roles: [], permissions: {} });
  });
});

describe("who can see which users (users.read scope)", () => {
  it("Super Admin and Auditor see everyone", async () => {
    expect((await visibleProfiles(SA)).length).toBe(9);
    expect((await visibleProfiles(AUD)).length).toBe(9);
  });

  it("a Team Leader sees themself and their team only", async () => {
    expect(await visibleProfiles(TL)).toEqual([TL, AG1].sort());
  });

  it("agents, Finance, Follow-up and Stock Officer see only themselves", async () => {
    expect(await visibleProfiles(AG1)).toEqual([AG1]);
    for (const user of [FIN, FU, SO]) expect(await visibleProfiles(user)).toEqual([user]);
  });

  it("team scope follows team membership", async () => {
    const r = await asUser(TL, () =>
      db.query<{ a: boolean; b: boolean }>("select app.in_scope('sales.read', $1) as a, app.in_scope('sales.read', $2) as b", [AG1, AG2])
    );
    expect(r.rows[0]).toEqual({ a: true, b: false });
  });
});

describe("admin_update_user (users.manage)", () => {
  const update = (caller: string, roles: string[], branch = hqBranch, city = hargeisa, team: string | null = teamA, user = SPARE) =>
    asUser(caller, () =>
      db.query("select public.admin_update_user($1, $2, $3, $4, $5, $6, $7)", [user, "Spare User", city, branch, "2026-10-01", roles, team])
    );

  it("lets Super Admin set name, city, branch, roles and team", async () => {
    await update(SA, ["agent", "follow_up"]);
    const p = await db.query<{ full_name: string; city_id: string; branch_id: string }>("select full_name, city_id, branch_id from public.user_profiles where id = $1", [SPARE]);
    expect(p.rows[0]).toEqual({ full_name: "Spare User", city_id: hargeisa, branch_id: hqBranch });
    const roles = await db.query<{ role_key: string }>("select role_key from public.user_roles where user_id = $1 order by role_key", [SPARE]);
    expect(roles.rows.map((r) => r.role_key)).toEqual(["agent", "follow_up"]);
    const team = await db.query<{ team_id: string }>("select team_id from public.team_members where user_id = $1", [SPARE]);
    expect(team.rows[0].team_id).toBe(teamA);
    await update(SA, ["agent"], hqBranch, hargeisa, null);
    expect((await db.query("select 1 from public.team_members where user_id = $1", [SPARE])).rows).toHaveLength(0);
  });

  it("is refused for every other role (direct database call)", async () => {
    for (const user of [TL, AG1, FIN, AUD, FU, SO]) {
      expect(await errorOf(update(user, ["agent"])), user).toMatch(/not allowed/);
    }
  });

  it("rejects a branch from another city, no roles, or unknown roles", async () => {
    expect(await errorOf(update(SA, ["agent"], burcoBranch, hargeisa))).toMatch(/BRANCH_NOT_IN_CITY/);
    expect(await errorOf(update(SA, []))).toMatch(/ROLE_REQUIRED/);
    expect(await errorOf(update(SA, ["boss"]))).toMatch(/UNKNOWN_ROLE/);
  });

  it("never removes your own Super Admin role or the last Super Admin", async () => {
    expect(await errorOf(update(SA, ["agent"], hqBranch, hargeisa, null, SA))).toMatch(/CANNOT_REMOVE_OWN_SUPER_ADMIN/);
  });

  it("logs the change and records the before/after history", async () => {
    const log = await db.query<{ n: number }>("select count(*)::int as n from public.activity_log where action = 'users.update' and entity_id = $1", [SPARE]);
    expect(log.rows[0].n).toBeGreaterThan(0);
    const history = await db.query<{ n: number }>("select count(*)::int as n from public.change_log where table_name = 'user_roles' and record_key = $1", [SPARE]);
    expect(history.rows[0].n).toBeGreaterThan(0);
  });
});

describe("admin_set_user_active (users.disable) — UAT-14", () => {
  it("deactivating a user removes their access immediately", async () => {
    await asUser(SA, () => db.query("select public.admin_set_user_active($1, false)", [SPARE]));
    expect(await visibleProfiles(SPARE)).toEqual([SPARE]); // own row stays readable (to show "inactive")
    const gate = await asUser(SPARE, () => db.query<{ ok: boolean; s: { status: string } }>("select app.is_active_user() as ok, public.my_session_status() as s"));
    expect(gate.rows[0].ok).toBe(false);
    expect(gate.rows[0].s.status).toBe("inactive");
    const end = await db.query<{ end_date: string | null }>("select end_date::text from public.user_profiles where id = $1", [SPARE]);
    expect(end.rows[0].end_date).not.toBeNull();
  });

  it("reactivating restores access and clears the end date", async () => {
    await asUser(SA, () => db.query("select public.admin_set_user_active($1, true)", [SPARE]));
    const end = await db.query<{ end_date: string | null; is_active: boolean }>("select end_date, is_active from public.user_profiles where id = $1", [SPARE]);
    expect(end.rows[0]).toEqual({ end_date: null, is_active: true });
  });

  it("cannot deactivate yourself, and other roles cannot deactivate anyone", async () => {
    expect(await errorOf(asUser(SA, () => db.query("select public.admin_set_user_active($1, false)", [SA])))).toMatch(/CANNOT_DEACTIVATE_SELF/);
    expect(await errorOf(asUser(TL, () => db.query("select public.admin_set_user_active($1, false)", [AG1])))).toMatch(/not allowed/);
  });

  it("never deactivates or demotes the last active Super Admin", async () => {
    // Give Finance user-admin rights through the matrix, then try to remove the only Super Admin.
    await asUser(SA, () => db.query("select public.admin_set_role_permission('finance', 'users.disable', 'all')"));
    await asUser(SA, () => db.query("select public.admin_set_role_permission('finance', 'users.manage', 'all')"));
    expect(await errorOf(asUser(FIN, () => db.query("select public.admin_set_user_active($1, false)", [SA])))).toMatch(/LAST_SUPER_ADMIN/);
    expect(
      await errorOf(asUser(FIN, () => db.query("select public.admin_update_user($1, 'Boss', $2, $3, null, $4, null)", [SA, hargeisa, hqBranch, ["agent"]])))
    ).toMatch(/LAST_SUPER_ADMIN/);
    await asUser(SA, () => db.query("select public.admin_set_role_permission('finance', 'users.disable', null)"));
    await asUser(SA, () => db.query("select public.admin_set_role_permission('finance', 'users.manage', null)"));
    expect((await db.query<{ n: number }>("select app.active_super_admin_count() as n")).rows[0].n).toBe(1);
  });
});

describe("teams (teams.manage)", () => {
  it("Super Admin creates a team led by a Team Leader", async () => {
    const r = await asUser(SA, () => db.query<{ id: string }>("select public.admin_save_team(null, 'Team C', $1, $2) as id", [hargeisa, TL]));
    expect(r.rows[0].id).toMatch(/[0-9a-f-]{36}/);
  });

  it("refuses a leader without the Team Leader role, and non-admins", async () => {
    expect(await errorOf(asUser(SA, () => db.query("select public.admin_save_team(null, 'Team D', $1, $2)", [hargeisa, AG1])))).toMatch(
      /LEADER_NEEDS_TEAM_LEADER_ROLE/
    );
    expect(await errorOf(asUser(TL, () => db.query("select public.admin_save_team(null, 'Team E', $1, null)", [hargeisa])))).toMatch(/not allowed/);
  });
});

describe("permission matrix (roles.manage) — editable by Super Admin only", () => {
  it("Super Admin can grant and remove a permission for a role", async () => {
    await asUser(SA, () => db.query("select public.admin_set_role_permission('agent', 'reports.read', 'own')"));
    let a = (await asUser(AG1, () => db.query<{ a: { permissions: Record<string, string> } }>("select public.my_access() as a"))).rows[0].a;
    expect(a.permissions["reports.read"]).toBe("own");
    await asUser(SA, () => db.query("select public.admin_set_role_permission('agent', 'reports.read', null)"));
    a = (await asUser(AG1, () => db.query<{ a: { permissions: Record<string, string> } }>("select public.my_access() as a"))).rows[0].a;
    expect(a.permissions["reports.read"]).toBeUndefined();
  });

  it("the Super Admin row is locked", async () => {
    expect(await errorOf(asUser(SA, () => db.query("select public.admin_set_role_permission('super_admin', 'users.manage', null)")))).toMatch(
      /SUPER_ADMIN_LOCKED/
    );
  });

  it("nobody else can edit it, even through the API", async () => {
    for (const user of [TL, AG1, FIN, AUD]) {
      expect(await errorOf(asUser(user, () => db.query("select public.admin_set_role_permission('agent', 'users.manage', 'all')"))), user).toMatch(/not allowed/);
    }
  });
});

describe("direct table writes are impossible (UAT-16)", () => {
  it.each(["roles", "permissions", "role_permissions", "user_roles", "teams", "team_members", "cities", "branches", "user_profiles"])(
    "%s cannot be written directly, even by Super Admin",
    async (table) => {
      const message = await errorOf(asUser(SA, () => db.query(`delete from public.${table}`)));
      expect(message).toMatch(/permission denied/);
    }
  );
});

describe("bootstrap of the first Super Admin", () => {
  it("cannot be called through the API", async () => {
    expect(await errorOf(asUser(SA, () => db.query("select app.bootstrap_super_admin('x@example.test')")))).toMatch(/permission denied/);
  });

  it("works once from the SQL Editor (owner) and then refuses", async () => {
    const fresh = await createTestDatabase();
    await createUser(fresh, { id: SA, email: "owner@example.test" });
    const ok = await fresh.query<{ r: string }>("select app.bootstrap_super_admin('Owner@Example.test') as r");
    expect(ok.rows[0].r).toMatch(/Super Admin granted/);
    expect(await errorOf(fresh.query("select app.bootstrap_super_admin('owner@example.test')"))).toMatch(/already exists/);
    await fresh.close();
  });
});
