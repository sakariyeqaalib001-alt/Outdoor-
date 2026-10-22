import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, errorOf, USER_A } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

/** Tables that ARE logs; every other public table must record its changes. */
const LOG_TABLES = ["activity_log", "audit_events", "change_log"];

type Entry = {
  actor_id: string | null;
  actor_role: string;
  table_name: string;
  record_key: string;
  operation: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_columns: string[];
};

async function entriesFor(key: string): Promise<Entry[]> {
  const { rows } = await db.query<Entry>(
    `select actor_id, actor_role, table_name, record_key, operation, old_data, new_data, changed_columns
     from public.change_log where record_key = $1 order by occurred_at, operation desc`,
    [key]
  );
  return rows;
}

describe("every table records its changes", () => {
  it("has the zz_change_log trigger on every public table except the logs themselves", async () => {
    const { rows } = await db.query<{ table_name: string; has_trigger: boolean }>(`
      select c.relname as table_name,
             exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_change_log') as has_trigger
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`);
    const business = rows.filter((r) => !LOG_TABLES.includes(r.table_name));
    expect(business.length).toBeGreaterThan(0);
    for (const row of business) expect(row.has_trigger, `${row.table_name} has no change history`).toBe(true);
  });
});

describe("change_log content", () => {
  it("records insert, update and delete with before/after values and the acting user", async () => {
    await as(db, "service_role", USER_A, async () => {
      await db.query(
        "insert into public.app_settings (key, value, description) values ('test_cutoff_day', '3', 'Cutoff')"
      );
      await db.query("update public.app_settings set value = '4' where key = 'test_cutoff_day'");
      await db.query("delete from public.app_settings where key = 'test_cutoff_day'");
    });

    const [insert, update, remove] = await entriesFor("test_cutoff_day");

    expect(insert).toMatchObject({
      operation: "INSERT",
      table_name: "app_settings",
      actor_id: USER_A,
      actor_role: "service_role",
      old_data: null,
    });
    expect(insert.new_data).toMatchObject({ key: "test_cutoff_day", value: 3 });

    expect(update.operation).toBe("UPDATE");
    expect(update.old_data).toMatchObject({ value: 3 });
    expect(update.new_data).toMatchObject({ value: 4 });
    expect(update.changed_columns).toEqual(expect.arrayContaining(["value", "updated_at"]));
    expect(update.changed_columns).not.toContain("description");

    expect(remove).toMatchObject({ operation: "DELETE", new_data: null });
    expect(remove.old_data).toMatchObject({ value: 4 });
  });

  it("does not record an update that changes nothing", async () => {
    await db.query("insert into public.app_settings (key, value) values ('same_value', '1')");
    await db.query("alter table public.app_settings disable trigger app_settings_touch");
    await db.query("update public.app_settings set value = '1' where key = 'same_value'");
    await db.query("alter table public.app_settings enable trigger app_settings_touch");
    const entries = await entriesFor("same_value");
    expect(entries.map((e) => e.operation)).toEqual(["INSERT"]);
  });

  it("records changes made outside the app (no signed-in user) with the database role", async () => {
    await db.query("insert into public.app_settings (key, value) values ('dashboard_edit', '1')");
    const [entry] = await entriesFor("dashboard_edit");
    expect(entry.actor_id).toBeNull();
    expect(entry.actor_role).toBe("postgres");
  });

  it("masks columns listed as sensitive", async () => {
    await db.exec(`
      create table public.tmp_masked (id uuid primary key default gen_random_uuid(), name text, secret_note text);
      alter table public.tmp_masked enable row level security;
      select app.enable_change_log('public.tmp_masked', 'id', 'secret_note');
      insert into public.tmp_masked (id, name, secret_note)
        values ('00000000-0000-4000-8000-0000000000aa', 'visible', 'hidden value');`);
    const [entry] = await entriesFor("00000000-0000-4000-8000-0000000000aa");
    await db.exec("drop table public.tmp_masked");
    expect(entry.new_data).toMatchObject({ name: "visible", secret_note: "***" });
    expect(JSON.stringify(entry)).not.toContain("hidden value");
  });
});

describe("change_log protection", () => {
  it("cannot be written to directly by any API role", async () => {
    for (const role of ["authenticated", "service_role"] as const) {
      const message = await errorOf(
        as(db, role, USER_A, () =>
          db.query("insert into public.change_log (actor_role, table_name, operation) values ('x', 'y', 'INSERT')")
        )
      );
      expect(message, role).toMatch(/permission denied/);
    }
  });

  it("is hidden from signed-in users without audit.read", async () => {
    const { rows } = await as(db, "authenticated", USER_A, () => db.query("select * from public.change_log"));
    expect(rows).toHaveLength(0);
  });

  it("is append-only for every role, including the owner", async () => {
    for (const role of ["authenticated", "service_role"] as const) {
      const message = await errorOf(as(db, role, USER_A, () => db.query("delete from public.change_log")));
      expect(message, role).toMatch(/permission denied|append-only/);
    }
    expect(await errorOf(db.query("update public.change_log set actor_role = 'x'"))).toMatch(/append-only/);
    expect(await errorOf(db.query("delete from public.change_log"))).toMatch(/append-only/);
    expect(await errorOf(db.query("truncate public.change_log"))).toMatch(/append-only/);
  });
});
