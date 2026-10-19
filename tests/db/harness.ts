import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Database test harness (T-10). Runs every migration in supabase/migrations against PGlite
 * (real PostgreSQL compiled to WebAssembly — no Docker needed), on top of a small shim that
 * reproduces the parts of Supabase the migrations rely on: the anon / authenticated /
 * service_role roles, auth.uid() / auth.jwt(), and Supabase's default table grants in `public`.
 * CI additionally applies the migrations to a real Supabase Postgres (.github/workflows/ci.yml).
 */

const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const migrationsDir = path.resolve(import.meta.dirname, "../../supabase/migrations");

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

type Role = "anon" | "authenticated" | "service_role";

/** Run fn as a Supabase API role, then return to the owner role. */
export async function as<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

/** Resolve to the error message if the promise rejects, or null if it succeeds. */
export async function errorOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";
