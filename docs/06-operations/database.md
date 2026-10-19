# Database workflow (Supabase)

How database changes are made, tested and applied. Never paste keys, tokens or the database password into chat, docs or code.

## Environments

| Environment | Supabase project | Data | How migrations get there |
|---|---|---|---|
| Tests | PGlite in Node (no Docker) + real Supabase Postgres in GitHub Actions | Throw-away | Automatically on every test run |
| Staging / development | "Outdoor" (ref `rovaveormshdgvpbehqf`) | Fake data only | GitHub Actions job `migrate-staging` after every green push to `main` (once secrets are set) — or manually, below |
| Production | `outdoor-production` (paid plan) — created at Phase 11 | Real data | Manual, reviewed, after a backup (Phase 11) |

## Rules

1. Every change is a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_short_name.sql`. Never edit a migration that has already been applied to staging or production — add a new one.
2. No manual table changes in the Supabase dashboard.
3. Every new table: `enable row level security`, explicit `revoke`/`grant`, policies, and tests in `tests/db/` (behaviour) and, where useful, `supabase/tests/database/` (pgTAP on real Supabase).
4. Append-only tables use the `app.prevent_change()` triggers.
5. `supabase/seed.sql` holds clearly labelled fake data only.

## Testing

```bash
npm run test          # unit tests + database tests (PGlite)
```

GitHub Actions also runs `supabase db start` + `supabase test db` (pgTAP) on a real Supabase Postgres.

## One-time setup: let GitHub apply migrations to staging

Do this yourself in the browser — the values never pass through chat.

1. **Supabase access token:** supabase.com → your avatar → **Account preferences → Access Tokens → Generate new token** (name it `github-actions-outdoor`). Copy it.
2. **Database password:** the password you set when creating the "Outdoor" project (reset it under **Project Settings → Database** if you no longer have it).
3. **GitHub:** repository → **Settings → Secrets and variables → Actions**:
   - **Secrets → New repository secret:** `SUPABASE_ACCESS_TOKEN` = the token, `SUPABASE_DB_PASSWORD` = the password.
   - **Variables → New repository variable:** `SUPABASE_STAGING_PROJECT_REF` = `rovaveormshdgvpbehqf`.
4. Push to `main` (or re-run the latest workflow). The `migrate-staging` job applies new migrations to "Outdoor".

Until these are set, the job prints "Staging Supabase secrets are not set yet — skipping" and passes.

## Manual alternative (from your own terminal)

```bash
npx supabase@2.121.0 login
npx supabase@2.121.0 link --project-ref rovaveormshdgvpbehqf
npx supabase@2.121.0 db push
```

`login` opens the browser; `link` and `db push` ask for the database password — type it in the terminal, never in chat.

## Checking it worked

Supabase dashboard → **Table Editor**: `app_settings`, `activity_log` and `audit_events` exist, each marked RLS enabled. **Database → Migrations** lists `20261019120000_foundation`.
