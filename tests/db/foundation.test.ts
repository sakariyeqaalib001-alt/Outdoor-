import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, errorOf, migrationFiles, USER_A } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, { id: USER_A });
}, 60_000);

const appendOnly = ["activity_log", "audit_events"] as const;

describe("migrations", () => {
  it("apply cleanly in order", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
    expect(db).toBeDefined();
  });
});

describe("row level security", () => {
  it("is enabled on every table in public", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it("gives anonymous users no access to any table", async () => {
    for (const table of ["app_settings", ...appendOnly]) {
      expect(await errorOf(as(db, "anon", null, () => db.query(`select * from public.${table}`)))).toMatch(
        /permission denied/
      );
    }
  });

  it("does not let anonymous users call helper or writer functions", async () => {
    const message = await errorOf(
      as(db, "anon", null, () => db.query("select app.log_activity('test.anon')"))
    );
    expect(message).toMatch(/permission denied/);
  });
});

describe("RLS helpers deny by default (user with no role)", () => {
  it("has_permission denies a user without roles", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () =>
      db.query<{ ok: boolean }>("select app.has_permission('audit.read') as ok")
    );
    expect(rows[0].ok).toBe(false);
  });

  it("in_scope denies a user without roles", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () =>
      db.query<{ ok: boolean }>("select app.in_scope('sales.read', $1::uuid) as ok", [USER_A])
    );
    expect(rows[0].ok).toBe(false);
  });

  it("is_active_user is true only for a signed-in user", async () => {
    const signedIn = await as(db, "authenticated", USER_A, () =>
      db.query<{ ok: boolean }>("select app.is_active_user() as ok")
    );
    expect(signedIn.rows[0].ok).toBe(true);
    const noUser = await as(db, "authenticated", null, () =>
      db.query<{ ok: boolean }>("select app.is_active_user() as ok")
    );
    expect(noUser.rows[0].ok).toBe(false);
  });
});

describe("business month (EAT, UTC+3)", () => {
  it.each([
    ["2026-10-31T20:59:59Z", "2026-10-01"], // 31 Oct 23:59:59 EAT
    ["2026-10-31T21:00:00Z", "2026-11-01"], // 1 Nov 00:00 EAT — after-midnight rule (D-30)
    ["2026-12-31T21:30:00Z", "2027-01-01"],
  ])("%s → %s", async (ts, month) => {
    const { rows } = await db.query<{ m: string }>("select app.business_month($1::timestamptz)::text as m", [ts]);
    expect(rows[0].m).toBe(month);
  });

  it("is immutable so later phases can use it in generated columns", async () => {
    const { rows } = await db.query<{ v: string }>(
      "select provolatile as v from pg_proc where proname = 'business_month'"
    );
    expect(rows[0].v).toBe("i");
  });
});

describe("activity_log", () => {
  it("records the actor from the session, not from the caller", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () =>
      db.query<{ id: string }>(
        "select app.log_activity('settings.update', 'app_settings', null, '{\"key\":\"payroll_cutoff_day\"}') as id"
      )
    );
    const stored = await db.query<{ actor_id: string; action: string }>(
      "select actor_id, action from public.activity_log where id = $1",
      [rows[0].id]
    );
    expect(stored.rows[0]).toEqual({ actor_id: USER_A, action: "settings.update" });
  });

  it("cannot be inserted into directly by signed-in users", async () => {
    const message = await errorOf(
      as(db, "authenticated", USER_A, () =>
        db.query("insert into public.activity_log (actor_id, action) values ($1, 'fake.entry')", [USER_A])
      )
    );
    expect(message).toMatch(/permission denied/);
  });

  it("is hidden from signed-in users without audit.read", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () => db.query("select * from public.activity_log"));
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid action names", async () => {
    const message = await errorOf(
      as(db, "authenticated", USER_A, () => db.query("select app.log_activity('Bad Action!')"))
    );
    expect(message).toMatch(/check constraint/);
  });
});

describe("audit_events", () => {
  it("records a rule hit for the current user", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () =>
      db.query<{ id: string }>(
        "select app.record_audit_event('DUP_PHONE', 'high', '{\"phone\":\"+25263xxxxxxx\"}') as id"
      )
    );
    const stored = await db.query<{ actor_id: string; rule_code: string; severity: string }>(
      "select actor_id, rule_code, severity from public.audit_events where id = $1",
      [rows[0].id]
    );
    expect(stored.rows[0]).toEqual({ actor_id: USER_A, rule_code: "DUP_PHONE", severity: "high" });
  });

  it("survives when the business operation that raised it is rejected (SDD §11.1 pattern)", async () => {
    await db.exec(`
      create function public.tmp_rejected_operation() returns text language plpgsql security definer
      set search_path = '' as $$
      begin
        perform app.record_audit_event('DUP_INDEX', 'high');
        return 'duplicate';  -- return a result instead of raising, so the event commits
      end; $$;
      grant execute on function public.tmp_rejected_operation() to authenticated;`);
    const before = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_events where rule_code = 'DUP_INDEX'"
    );
    const result = await as(db, "authenticated", USER_A, () =>
      db.query<{ r: string }>("select public.tmp_rejected_operation() as r")
    );
    const after = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_events where rule_code = 'DUP_INDEX'"
    );
    await db.exec("drop function public.tmp_rejected_operation()");
    expect(result.rows[0].r).toBe("duplicate");
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it("rejects unknown severities", async () => {
    const message = await errorOf(
      as(db, "authenticated", USER_A, () => db.query("select app.record_audit_event('DUP_PHONE', 'critical')"))
    );
    expect(message).toMatch(/check constraint/);
  });
});

describe.each(appendOnly)("%s is append-only", (table) => {
  const roles = ["authenticated", "service_role"] as const;

  it.each(roles)("%s cannot update or delete", async (role) => {
    for (const statement of [`update public.${table} set occurred_at = now()`, `delete from public.${table}`]) {
      const message = await errorOf(as(db, role, USER_A, () => db.query(statement)));
      expect(message, `${role}: ${statement}`).toMatch(/permission denied|append-only/);
    }
  });

  it("the table owner cannot update, delete or truncate either", async () => {
    // Make sure a row exists, so the row-level triggers really fire.
    await db.query(
      table === "activity_log"
        ? "insert into public.activity_log (action) values ('owner.check')"
        : "insert into public.audit_events (rule_code) values ('OWNER_CHECK')"
    );
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(await errorOf(db.query(`update public.${table} set occurred_at = now()`))).toMatch(/append-only/);
    expect(await errorOf(db.query(`delete from public.${table}`))).toMatch(/append-only/);
    expect(await errorOf(db.query(`truncate public.${table}`))).toMatch(/append-only/);
  });
});

describe("app_settings", () => {
  it("can be read by signed-in users", async () => {
    await db.query(
      "insert into public.app_settings (key, value, description) values ('week_start_day', '\"saturday\"', 'test')"
    );
    const { rows } = await as(db, "authenticated", USER_A, () =>
      db.query("select key from public.app_settings where key = 'week_start_day'")
    );
    expect(rows).toHaveLength(1);
  });

  it("cannot be changed by signed-in users yet (Phase 5 adds settings.manage)", async () => {
    for (const statement of [
      "insert into public.app_settings (key, value) values ('x_y', '1')",
      "update public.app_settings set value = '1'",
      "delete from public.app_settings",
    ]) {
      const message = await errorOf(as(db, "authenticated", USER_A, () => db.query(statement)));
      expect(message, statement).toMatch(/permission denied/);
    }
  });
});
