import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { buildAll, buildFreshProjectFile, freshProjectFile } from "../../scripts/sql-editor.mjs";
import { SUPABASE_SHIM } from "./harness";

type Built = { path: string; content: string };
const files = buildAll() as Built[];

describe("SQL Editor paste files", () => {
  it("are up to date with supabase/migrations (run npm run db:sql-editor)", () => {
    for (const f of files) {
      expect(existsSync(f.path), `${f.path} missing`).toBe(true);
      expect(readFileSync(f.path, "utf8").replace(/\r\n/g, "\n"), f.path).toBe(f.content);
    }
  });

  it("apply in order, refuse to run twice, and refuse to skip ahead", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_SHIM);

    if (files.length > 1) {
      const skipped = await db.exec(files[1].content).then(
        () => null,
        (e: Error) => e.message
      );
      expect(skipped).toMatch(/first\. Nothing was changed/);
      await db.exec("rollback");
    }

    for (const f of files) await db.exec(f.content);

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from supabase_migrations.schema_migrations"
    );
    expect(rows[0].n).toBe(files.length);

    const again = await db.exec(files[0].content).then(
      () => null,
      (e: Error) => e.message
    );
    expect(again).toMatch(/Already applied/);
  });
});

describe("new-project file (supabase/fresh-project/all_changes_in_order.sql)", () => {
  const content = buildFreshProjectFile() as string;

  it("is up to date (run npm run db:sql-editor)", () => {
    expect(existsSync(freshProjectFile)).toBe(true);
    expect(readFileSync(freshProjectFile, "utf8").replace(/\r\n/g, "\n")).toBe(content);
  });

  it("applies every change to an empty project in one go, and refuses a project that already has changes", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_SHIM);
    await db.exec(content);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from supabase_migrations.schema_migrations");
    expect(rows[0].n).toBe(files.length);
    expect((await db.query("select 1 from public.plans")).rows.length).toBe(18);
    const again = await db.exec(content).then(() => null, (e: Error) => e.message);
    expect(again).toMatch(/already has database changes/);
  });
});
