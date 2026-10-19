# Database workflow (Supabase)

All system data lives in **Supabase**. GitHub holds only the code, including the instructions (migration files) that create the database tables. Never paste keys, tokens or the database password into chat, docs or code.

## How the owner applies database changes: SQL Editor (copy and paste)

After each phase that changes the database, the files to paste are in **`supabase/sql-editor/`**, one per change, numbered in order.

1. Open supabase.com → the **"Outdoor"** project → **SQL Editor** (left menu) → **New query**.
2. Open the next file from `supabase/sql-editor/` in a text editor (for example Notepad or VS Code), select **all** of it and copy.
3. Paste into the SQL Editor and click **Run**.
4. The result shows **"Applied … successfully"**. Repeat for the next file, in number order.

Each file is safe to paste:

| If… | What happens |
|---|---|
| It succeeds | The change is applied and recorded as applied |
| Anything inside fails | **Nothing** is changed (all-or-nothing) |
| You paste a file that was already applied | It stops with "Already applied … Nothing was changed" |
| You paste a file before the previous one | It stops with "Apply … first. Nothing was changed" |

**Check it worked:** **Table Editor** shows the new tables (Phase 2: `app_settings`, `activity_log`, `audit_events`, `change_log`), each marked "RLS enabled".

**If Supabase shows a warning** such as "this query has destructive operations" or "new tables will not have RLS": our files enable RLS on every table themselves; read the message, and if unsure send a screenshot before confirming.

## What gets recorded automatically

| Log | Records | Written by |
|---|---|---|
| `change_log` | **Every** insert, update and delete in every business table, with the **before and after values**, who did it and when | Database trigger — automatic, cannot be skipped |
| `activity_log` | What a person did in the app (e.g. "approved retention", "exported payroll") | The app |
| `audit_events` | Rule hits such as duplicate phone/Index attempts (fraud signals) | The app |

None of the three can be edited or deleted by anyone, including the database owner. Only users with the `audit.read` permission (from Phase 4) can read them.

## Environments

| Environment | Supabase project | Data |
|---|---|---|
| Tests | PGlite in Node (no Docker) + a real Supabase Postgres in GitHub Actions | Throw-away |
| Staging / development | "Outdoor" (ref `rovaveormshdgvpbehqf`) | Fake data only |
| Production | `outdoor-production` (paid plan) — created at Phase 11 | Real data, applied only after a backup |

## Rules for developers (Claude Code)

1. Every change is a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_short_name.sql`. Never edit a migration that has been applied — add a new one.
2. After adding or changing a migration, run `npm run db:sql-editor` to regenerate `supabase/sql-editor/` (a test fails if they are out of date).
3. No manual table changes in the Supabase dashboard other than pasting these files.
4. Every new `public` table: `enable row level security`, `revoke all` from anon/authenticated, explicit grants and policies, **`select app.enable_change_log('public.<table>')`** (a test fails if missing), and tests in `tests/db/`.
5. Append-only tables use the `app.prevent_change()` triggers.
6. `supabase/seed.sql` holds clearly labelled fake data only.

## Testing

```bash
npm run test          # unit tests + database tests (PGlite)
```

GitHub Actions also applies the migrations to a real Supabase Postgres and runs `supabase/tests/database` (pgTAP).

## Optional: automatic apply from GitHub

The GitHub job `migrate-staging` can apply new migrations to "Outdoor" after every green push, if you add in GitHub → Settings → Secrets and variables → Actions: secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and variable `SUPABASE_STAGING_PROJECT_REF` = `rovaveormshdgvpbehqf`. Without them the job skips. Files pasted in the SQL Editor are recorded the same way, so the two methods never apply the same change twice.
