import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, DEFAULT_SESSION, errorOf, sessionOf } from "./harness";

let db: PGlite;

const PERMANENT = "10000000-0000-4000-8000-000000000001";
const TEMP = "10000000-0000-4000-8000-000000000002";
const NEW_USER = "10000000-0000-4000-8000-000000000003";
const INACTIVE = "10000000-0000-4000-8000-000000000004";
const TEMP_2 = "10000000-0000-4000-8000-000000000005";
const NO_PHONE = "10000000-0000-4000-8000-000000000008";
const ADMIN = "10000000-0000-4000-8000-000000000009";
const OTHER_SESSION = "00000000-0000-4000-9000-000000000099";

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, { id: PERMANENT, type: "permanent", email: "staff@example.test" });
  await createUser(db, { id: TEMP, type: "temporary", phone: "+252634000001" });
  await createUser(db, { id: NEW_USER, type: "permanent", email: "new@example.test", mustChangePassword: true });
  await createUser(db, { id: INACTIVE, type: "permanent", email: "gone@example.test", active: false });
  await createUser(db, { id: TEMP_2, type: "temporary", phone: "+252634000002" });
  await createUser(db, { id: NO_PHONE, type: "permanent", email: "nophone@example.test", phone: null, otpVerified: false });
  await createUser(db, { id: ADMIN, type: "permanent", email: "admin@example.test", phone: "+252654000009" });
  await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'super_admin')", [ADMIN]);
}, 60_000);

async function status(userId: string, session = DEFAULT_SESSION): Promise<string> {
  const { rows } = await as(
    db,
    "authenticated",
    userId,
    () => db.query<{ s: { status: string } }>("select public.my_session_status() as s"),
    session
  );
  return rows[0].s.status;
}

async function isActive(userId: string, session = DEFAULT_SESSION): Promise<boolean> {
  const { rows } = await as(
    db,
    "authenticated",
    userId,
    () => db.query<{ ok: boolean }>("select app.is_active_user() as ok"),
    session
  );
  return rows[0].ok;
}

async function issueOtp(userId: string, session = DEFAULT_SESSION): Promise<{ challenge_id: string; code: string }> {
  const { rows } = await as(db, "service_role", null, () =>
    db.query<{ challenge_id: string; code: string }>("select * from public.issue_otp_challenge($1, $2)", [
      userId,
      sessionOf(userId, session),
    ])
  );
  return rows[0];
}

async function verify(userId: string, code: string, session = DEFAULT_SESSION): Promise<string> {
  const { rows } = await as(
    db,
    "authenticated",
    userId,
    () => db.query<{ r: string }>("select public.verify_otp($1) as r", [code]),
    session
  );
  return rows[0].r;
}

describe("user profiles", () => {
  it("are created automatically from the Auth user", async () => {
    const { rows } = await db.query<{ employment_type: string; login_phone_e164: string; email: string | null }>(
      "select employment_type, login_phone_e164, email from public.user_profiles where id = $1",
      [TEMP]
    );
    expect(rows[0]).toEqual({ employment_type: "temporary", login_phone_e164: "+252634000001", email: null });
  });

  it("start with a forced password change (FR-AUTH-04)", async () => {
    await db.query("insert into auth.users (id, email) values ('10000000-0000-4000-8000-0000000000ff', 'fresh@example.test')");
    const { rows } = await db.query<{ must_change_password: boolean; employment_type: string }>(
      "select must_change_password, employment_type from public.user_profiles where id = '10000000-0000-4000-8000-0000000000ff'"
    );
    expect(rows[0]).toEqual({ must_change_password: true, employment_type: "permanent" });
  });

  it("are visible only to their owner", async () => {
    const { rows } = await as(db, "authenticated", PERMANENT, () => db.query<{ id: string }>("select id from public.user_profiles"));
    expect(rows.map((r) => r.id)).toEqual([PERMANENT]);
    expect(await errorOf(as(db, "anon", null, () => db.query("select * from public.user_profiles")))).toMatch(/permission denied/);
  });

  it("cannot be changed directly by their owner", async () => {
    const message = await errorOf(
      as(db, "authenticated", PERMANENT, () => db.query("update public.user_profiles set is_active = true"))
    );
    expect(message).toMatch(/permission denied/);
  });

  it("record their change history", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.change_log where table_name = 'user_profiles' and record_key = $1",
      [PERMANENT]
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe("session status and the RLS gate (app.is_active_user)", () => {
  it("lets an active permanent user through", async () => {
    expect(await status(PERMANENT)).toBe("ok");
    expect(await isActive(PERMANENT)).toBe(true);
  });

  it("blocks a deactivated user (FR-AUTH-06)", async () => {
    expect(await status(INACTIVE)).toBe("inactive");
    expect(await isActive(INACTIVE)).toBe(false);
  });

  it("blocks a user who has not changed the first-login password", async () => {
    expect(await status(NEW_USER)).toBe("change_password");
    expect(await isActive(NEW_USER)).toBe(false);
  });

  it("blocks a temporary agent until OTP is verified for this session", async () => {
    expect(await status(TEMP)).toBe("otp_required");
    expect(await isActive(TEMP)).toBe(false);
  });

  it("requires the SMS code from staff too, per sign-in session (D-32)", async () => {
    expect(await status(PERMANENT, OTHER_SESSION)).toBe("otp_required");
    expect(await isActive(PERMANENT, OTHER_SESSION)).toBe(false);
    expect(await status(NO_PHONE)).toBe("otp_required");
    expect(await isActive(NO_PHONE)).toBe(false);
  });

  it("reports no_profile for an unknown user", async () => {
    expect(await status("10000000-0000-4000-8000-0000000000ee")).toBe("no_profile");
  });
});

describe("first-login password change", () => {
  it("clears the flag for the caller only and logs it", async () => {
    await as(db, "authenticated", NEW_USER, () => db.query("select public.mark_password_changed()"));
    expect(await status(NEW_USER)).toBe("ok");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.activity_log where action = 'auth.password_changed' and actor_id = $1",
      [NEW_USER]
    );
    expect(rows[0].n).toBe(1);
  });

  it("is refused for deactivated users and anonymous callers", async () => {
    expect(await errorOf(as(db, "authenticated", INACTIVE, () => db.query("select public.mark_password_changed()")))).toMatch(
      /not allowed/
    );
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.mark_password_changed()")))).toMatch(
      /permission denied/
    );
  });
});

describe("SMS one-time password (FR-AUTH-02, FR-AUTH-08, FR-NOT-04)", () => {
  it("cannot be issued by a signed-in user (they would see their own code)", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      const message = await errorOf(
        as(db, role, TEMP, () => db.query("select * from public.issue_otp_challenge($1, $2)", [TEMP, sessionOf(TEMP)]))
      );
      expect(message, role).toMatch(/permission denied/);
    }
  });

  it("is refused for inactive users and users without a mobile number", async () => {
    expect(await errorOf(issueOtp(NO_PHONE))).toMatch(/NO_PHONE/);
    expect(await errorOf(issueOtp(INACTIVE))).toMatch(/OTP_NOT_ALLOWED/);
  });

  it("is a 6-digit code stored only as a hash", async () => {
    const { challenge_id, code } = await issueOtp(TEMP);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await db.query<{ stored: string }>(
      "select encode(code_hash, 'escape') as stored from public.otp_challenges where id = $1",
      [challenge_id]
    );
    expect(rows[0].stored).not.toContain(code);
    const history = await db.query<{ new_data: { code_hash: string } }>(
      "select new_data from public.change_log where table_name = 'otp_challenges' and record_key = $1",
      [challenge_id]
    );
    expect(history.rows[0].new_data.code_hash).toBe("***");
  });

  it("rejects a wrong code, accepts the right one, and unlocks this session only", async () => {
    const { code } = await issueOtp(TEMP);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verify(TEMP, wrong)).toBe("invalid");
    expect(await verify(TEMP, code)).toBe("ok");
    expect(await status(TEMP)).toBe("ok");
    expect(await isActive(TEMP)).toBe(true);
    // Another sign-in session of the same agent still needs its own OTP.
    expect(await status(TEMP, OTHER_SESSION)).toBe("otp_required");
    // A used code cannot be reused.
    expect(await verify(TEMP, code)).toBe("no_challenge");
  });

  it("allows at most 5 tries per code", async () => {
    const session = "00000000-0000-4000-9000-000000000005";
    const { code } = await issueOtp(TEMP_2, session);
    const wrong = code === "000000" ? "111111" : "000000";
    const results: string[] = [];
    for (let i = 0; i < 5; i++) results.push(await verify(TEMP_2, wrong, session));
    expect(results.slice(0, 4)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
    expect(results[4]).toBe("too_many_attempts");
    expect(await verify(TEMP_2, code, session)).toBe("no_challenge");
  });

  it("expires after 5 minutes", async () => {
    const session = "00000000-0000-4000-9000-000000000006";
    const { challenge_id, code } = await issueOtp(TEMP_2, session);
    await db.query("update public.otp_challenges set expires_at = now() - interval '1 second' where id = $1", [challenge_id]);
    expect(await verify(TEMP_2, code, session)).toBe("expired");
  });

  it("allows at most 3 sends per 15 minutes", async () => {
    const SPAMMER = "10000000-0000-4000-8000-000000000006";
    await createUser(db, { id: SPAMMER, type: "temporary", phone: "+252634000006" });
    await issueOtp(SPAMMER);
    await issueOtp(SPAMMER);
    await issueOtp(SPAMMER);
    expect(await errorOf(issueOtp(SPAMMER))).toMatch(/OTP_RATE_LIMIT/);
  });

  it("logs OTP outcomes without the code", async () => {
    const { rows } = await db.query<{ action: string; details: unknown }>(
      "select action, details from public.activity_log where actor_id = $1 and action like 'auth.otp%'",
      [TEMP]
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.otp_issued", "auth.otp_failed", "auth.otp_verified"]));
    expect(JSON.stringify(rows)).not.toMatch(/\b\d{6}\b/);
  });

  it("records SMS delivery status only from the server", async () => {
    const SENDER = "10000000-0000-4000-8000-000000000007";
    await createUser(db, { id: SENDER, type: "temporary", phone: "+252634000007" });
    const { challenge_id } = await issueOtp(SENDER);
    await as(db, "service_role", null, () => db.query("select public.record_otp_delivery($1, true, 'msg-1')", [challenge_id]));
    const { rows } = await db.query<{ delivery_status: string }>("select delivery_status from public.otp_challenges where id = $1", [
      challenge_id,
    ]);
    expect(rows[0].delivery_status).toBe("sent");
    expect(
      await errorOf(as(db, "authenticated", SENDER, () => db.query("select public.record_otp_delivery($1, true)", [challenge_id])))
    ).toMatch(/permission denied/);
  });

  it("is not needed when Super Admin turns OTP off", async () => {
    await db.query("update public.app_settings set value = 'false' where key = 'otp_enabled'");
    expect(await status(TEMP_2)).toBe("ok");
    await db.query("update public.app_settings set value = 'true' where key = 'otp_enabled'");
    expect(await status(TEMP_2)).toBe("otp_required");
  });
});

describe("sign-in lockout (FR-AUTH-08)", () => {
  async function fail(identifier: string): Promise<string | null> {
    const { rows } = await as(db, "anon", null, () =>
      db.query<{ until: string | null }>("select public.auth_record_failure($1) as until", [identifier])
    );
    return rows[0].until;
  }
  async function lockedUntil(identifier: string): Promise<string | null> {
    const { rows } = await as(db, "anon", null, () =>
      db.query<{ until: string | null }>("select public.auth_lockout_until($1) as until", [identifier])
    );
    return rows[0].until;
  }

  it("locks an identifier after 5 failures and not before", async () => {
    const id = "+252634999001";
    for (let i = 0; i < 4; i++) expect(await fail(id)).toBeNull();
    expect(await lockedUntil(id)).toBeNull();
    expect(await fail(id)).not.toBeNull();
    expect(await lockedUntil(id)).not.toBeNull();
  });

  it("treats identifiers case-insensitively and never stores them in plain text", async () => {
    for (let i = 0; i < 5; i++) await fail("Locked.User@Example.test");
    expect(await lockedUntil("locked.user@example.test")).not.toBeNull();
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.auth_lockouts where identifier_hash like '%example%'"
    );
    expect(rows[0].n).toBe(0);
  });

  it("unlocks after 15 minutes", async () => {
    const id = "expired.lock@example.test";
    for (let i = 0; i < 5; i++) await fail(id);
    await db.query(
      "update public.auth_lockouts set locked_until = now() - interval '1 second' where identifier_hash = app.identifier_hash($1)",
      [id]
    );
    expect(await lockedUntil(id)).toBeNull();
  });

  it("is cleared only by the user's own successful sign-in", async () => {
    for (let i = 0; i < 3; i++) await fail("staff@example.test");
    // Anonymous callers cannot clear counters.
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.auth_record_success()")))).toMatch(
      /permission denied/
    );
    await as(db, "authenticated", PERMANENT, () => db.query("select public.auth_record_success()"));
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.auth_lockouts where identifier_hash = app.identifier_hash('staff@example.test')"
    );
    expect(rows[0].n).toBe(0);
  });

  it("logs failures and successes without the identifier", async () => {
    const { rows } = await db.query<{ action: string; details: unknown }>(
      "select action, details from public.activity_log where action in ('auth.sign_in_failed', 'auth.locked', 'auth.sign_in')"
    );
    expect(rows.some((r) => r.action === "auth.sign_in_failed")).toBe(true);
    expect(rows.some((r) => r.action === "auth.locked")).toBe(true);
    expect(rows.some((r) => r.action === "auth.sign_in")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/example\.test|\+25263/);
  });
});

describe("internal tables stay private", () => {
  it.each(["otp_challenges", "otp_verified_sessions", "auth_lockouts"])("%s is not readable by any API role", async (table) => {
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      expect(await errorOf(as(db, role, PERMANENT, () => db.query(`select * from public.${table}`))), role).toMatch(
        /permission denied/
      );
    }
  });
});

describe("SMS code for staff (D-32)", () => {
  it("is issued to a staff member's mobile number and unlocks only that session", async () => {
    const session = "00000000-0000-4000-9000-000000000010";
    const { code } = await issueOtp(PERMANENT, session);
    expect(await status(PERMANENT, session)).toBe("otp_required");
    expect(await verify(PERMANENT, code, session)).toBe("ok");
    expect(await status(PERMANENT, session)).toBe("ok");
    expect(await isActive(PERMANENT, session)).toBe(true);
  });

  it("is not needed by staff when Super Admin turns OTP off", async () => {
    await db.query("update public.app_settings set value = 'false' where key = 'otp_enabled'");
    expect(await status(PERMANENT, OTHER_SESSION)).toBe("ok");
    await db.query("update public.app_settings set value = 'true' where key = 'otp_enabled'");
  });
});

describe("mobile numbers (D-32)", () => {
  const setPhone = (caller: string, user: string, phone: string) =>
    as(db, "authenticated", caller, () => db.query<{ old: string | null }>("select public.admin_set_user_phone($1, $2) as old", [user, phone]));
  const phoneOf = async (user: string) =>
    (await db.query<{ p: string | null }>("select login_phone_e164 as p from public.user_profiles where id = $1", [user])).rows[0].p;

  it("can be set only with users.manage", async () => {
    expect(await errorOf(setPhone(PERMANENT, NO_PHONE, "0654000020"))).toMatch(/not allowed/);
    expect(await errorOf(as(db, "anon", null, () => db.query("select public.admin_set_user_phone($1, '0654000020')", [NO_PHONE])))).toMatch(
      /permission denied/
    );
    expect(await phoneOf(NO_PHONE)).toBeNull();
  });

  it("is normalized, saved and logged without the number", async () => {
    const { rows } = await setPhone(ADMIN, NO_PHONE, "065 400 0020");
    expect(rows[0].old).toBeNull();
    expect(await phoneOf(NO_PHONE)).toBe("+252654000020");
    const log = await db.query<{ details: unknown }>(
      "select details from public.activity_log where action = 'users.phone_changed' and entity_id = $1",
      [NO_PHONE]
    );
    expect(log.rows.length).toBe(1);
    expect(JSON.stringify(log.rows)).not.toMatch(/654000020/);
  });

  it("is refused when invalid or already used by another account of the same type", async () => {
    expect(await errorOf(setPhone(ADMIN, NO_PHONE, "12"))).toMatch(/PHONE_REQUIRED/);
    expect(await errorOf(setPhone(ADMIN, NO_PHONE, "+252654000009"))).toMatch(/PHONE_TAKEN/);
    expect(await errorOf(setPhone(ADMIN, TEMP_2, "+252634000001"))).toMatch(/PHONE_TAKEN/);
    expect(await errorOf(db.query("update public.user_profiles set login_phone_e164 = '+252634000001' where id = $1", [TEMP_2]))).toMatch(
      /duplicate key/
    );
  });

  it("may be shared by one staff account and one agent account (same person)", async () => {
    await setPhone(ADMIN, NO_PHONE, "+252634000001");
    expect(await phoneOf(NO_PHONE)).toBe("+252634000001");
  });

  it("can be added by email from the SQL Editor only (first Super Admin)", async () => {
    expect(await errorOf(as(db, "authenticated", ADMIN, () => db.query("select app.set_user_phone('admin@example.test', '0654000030')")))).toMatch(
      /permission denied/
    );
    const { rows } = await db.query<{ r: string }>("select app.set_user_phone('Admin@Example.test', '0654000030') as r");
    expect(rows[0].r).toMatch(/Mobile number saved/);
    expect(await phoneOf(ADMIN)).toBe("+252654000030");
    expect(await errorOf(db.query("select app.set_user_phone('admin@example.test', 'abc')"))).toMatch(/Not a valid/);
    expect(await errorOf(db.query("select app.set_user_phone('nobody@example.test', '0654000031')"))).toMatch(/No permanent user/);
  });
});
