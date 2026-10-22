// Builds copy-and-paste files for the Supabase SQL Editor from supabase/migrations (T-14).
// Run with: npm run db:sql-editor
//
// Each output file:
//  - runs all-or-nothing (one transaction: if anything fails, nothing is changed),
//  - refuses to run twice, and refuses to run before the previous migration,
//  - records itself in supabase_migrations.schema_migrations, so the Supabase CLI and the
//    GitHub "migrate-staging" job see it as applied and never apply it again.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
export const outputDir = path.join(root, "supabase", "sql-editor");

export function migrationList() {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const [, version, name] = file.match(/^(\d{14})_([a-z0-9_]+)\.sql$/);
      return { file, version, name, sql: readFileSync(path.join(migrationsDir, file), "utf8") };
    });
}

export function buildSqlEditorFile(migration, previous) {
  const { file, version, name, sql } = migration;
  const prerequisite = previous
    ? `
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '${previous.version}') then
    raise exception 'Apply ${previous.version}_${previous.name} first. Nothing was changed.';
  end if;`
    : "";
  return `-- =====================================================================================
-- Sogasho Outdoor — database change ${version}_${name}
-- HOW TO APPLY: Supabase → your project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: runs all-or-nothing, refuses to run twice, and records itself as applied.
-- Generated from supabase/migrations/${file} — do not edit; run "npm run db:sql-editor".
-- =====================================================================================
begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
-- Bookkeeping table only; not exposed by the API. RLS on, no policies: API roles see nothing,
-- the Supabase CLI (table owner) is unaffected. Also avoids the SQL Editor RLS warning.
alter table supabase_migrations.schema_migrations enable row level security;

do $sogasho_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '${version}') then
    raise exception 'Already applied: ${version}_${name}. Nothing was changed.';
  end if;${prerequisite}
end
$sogasho_guard$;

-- ---------------------------------- change starts ----------------------------------
${sql.trim()}
-- ----------------------------------- change ends -----------------------------------

insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');

commit;

select 'Applied ${version}_${name} successfully' as result;
`;
}

export const freshProjectFile = path.join(root, "supabase", "fresh-project", "all_changes_in_order.sql");

/**
 * Every migration in one paste, for a NEW empty Supabase project (e.g. the training site, T-24).
 * One transaction: all changes apply or none do. Refuses if any change is already recorded.
 */
export function buildFreshProjectFile() {
  const list = migrationList();
  const last = list[list.length - 1];
  return `-- =====================================================================================
-- Sogasho Outdoor — ALL database changes in order (${list.length}), for a NEW empty Supabase project
-- Up to ${last.version}_${last.name}.
-- HOW TO APPLY: new project → SQL Editor → New query → paste this WHOLE file → Run.
-- Safe: one transaction (everything or nothing); refuses if the project already has any change.
-- For an existing project use the single files in supabase/sql-editor instead.
-- Generated from supabase/migrations — do not edit; run "npm run db:sql-editor".
-- =====================================================================================
begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
alter table supabase_migrations.schema_migrations enable row level security;

do $sogasho_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations) then
    raise exception 'This project already has database changes. Use the single files in supabase/sql-editor. Nothing was changed.';
  end if;
end
$sogasho_guard$;
${list
  .map(
    (m) => `
-- ================================ ${m.version}_${m.name} ================================
${m.sql.trim()}

insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name}');
`
  )
  .join("")}
commit;

select 'Applied all ${list.length} changes successfully (up to ${last.version}_${last.name})' as result;
`;
}

export function buildAll() {
  const list = migrationList();
  return list.map((m, i) => ({
    path: path.join(outputDir, `${m.version}_${m.name}.sql`),
    content: buildSqlEditorFile(m, list[i - 1]),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const files = buildAll();
  for (const f of files) writeFileSync(f.path, f.content);
  console.log(`SQL Editor files written to supabase/sql-editor (${files.length}):`);
  for (const f of files) console.log(`  ${path.basename(f.path)}`);
  mkdirSync(path.dirname(freshProjectFile), { recursive: true });
  writeFileSync(freshProjectFile, buildFreshProjectFile());
  console.log("New-project file written: supabase/fresh-project/all_changes_in_order.sql");
}
