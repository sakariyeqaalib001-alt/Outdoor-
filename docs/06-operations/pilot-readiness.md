# Pilot readiness (Phase 11)

The pilot runs in **Hargeisa** on a fresh production system (no old data, D-21). Support owner: **the business owner** (D-43).

Status: hosting and the production database are **not chosen yet** (D-43). Everything that does not need them is built; sections 4–6 are the steps to follow once they are chosen.

## 1. Apply the database change — on BOTH sites

| Project | File | Expected |
|---|---|---|
| **Outdoor** | `supabase/sql-editor/20261104090000_readiness.sql` | "Applied 20261104090000_readiness successfully" |
| **Outdoor Training** | the same file | the same message |

Then restart the training site (stop it, `npm.cmd run training:build`, `npm.cmd run training:start`) and restart `npm.cmd run dev`.

## 2. The readiness checks

**Settings → Pilot readiness** (Super Admin). Choose the city (Hargeisa by default) and press **Check**.

| Check | Fix it in |
|---|---|
| Every product has a price | Products → plans and prices |
| Districts entered | Settings → Districts |
| Teams created; every team has a Team Leader and stock | Users → Teams |
| Sales Agents created; every agent has a city and a team | Users |
| Payroll and performance settings; SMS code on | Settings → General |
| Stock Officer account; two Super Admins (advice) | Users |
| Opening stock received; deliveries accepted; every team has stock (advice) | Stock (section 3) |
| No test data | Rename or deactivate test accounts; production starts clean |
| Server settings (secret key, Telesom, https address, email sender secret) | Host settings (section 5) — on your computer some of these fail; that is expected |

The same checks can be run in the Supabase **SQL Editor** with `supabase/checks/readiness.sql`.

The page says **Ready** only when every required check passes and opening stock reconciles.

## 3. Opening stock (R-11)

1. The Stock Officer counts every WiFi Router, PDCOM and CALIX in the store and writes the totals down.
2. **Stock → Issue & receive → Receive stock**: enter each count (note: "Opening count").
3. **Stock → Issue & receive → Issue stock**: give each Hargeisa Outdoor Supervisor their devices.
4. Each Outdoor Supervisor opens **Stock** and presses **Accept** once the devices arrive.
5. **Settings → Pilot readiness → opening stock**: "Received" must equal the written count, and **Difference must be 0** for every device.

If a count was entered wrongly, use **Stock → Returns & adjustments → Request adjustment** (Super Admin approves) — never a second receipt to "fix" it.

## 4. Production database (when chosen — recommended Supabase Pro)

1. supabase.com → **New project** `outdoor-production`, region close to Somaliland (e.g. Frankfurt or Mumbai), Pro plan (daily backups). Keep the database password in your password manager — never in chat or files.
2. **SQL Editor** → paste `supabase/fresh-project/all_changes_in_order.sql` once → "All changes applied".
3. **Authentication → Sign In / Providers**: Email on; "Confirm email" **off**; public sign-ups **off** (accounts are made with `npm run user:create`).
4. Create your own account with `npm.cmd run user:create -- --type permanent --email … --phone … --name "…"` while `.env.local` temporarily holds the production values (see `docs/06-operations/auth.md` §4; the first permanent account becomes the Super Admin), then put the staging values back.
5. From then on, every new SQL file is pasted into **three** projects: Outdoor, Outdoor Training and outdoor-production.

## 5. Hosting (when chosen — recommended Vercel Pro)

1. Vercel team "SO LTD" → upgrade to **Pro** → **Add New Project** → import the GitHub repository.
2. **Settings → Environment Variables** (Production) — enter the values yourself, never in chat:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | from outdoor-production → Project Settings → API Keys |
   | `SMS_PROVIDER` | `telesom` |
   | `TELESOM_USERNAME`, `TELESOM_PASSWORD`, `TELESOM_API_KEY`, `TELESOM_SENDER` | Telesom account |
   | `EMAIL_PROVIDER`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | Brevo (optional) |
   | `APP_BASE_URL` | `https://outdoor.sogasho.com` (or the Vercel address until IT adds the DNS record) |
   | `CRON_SECRET` | 64 random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

3. **Scheduled email sender:** add a file `vercel.json` with a cron for `/api/cron/send-emails` every 5 minutes (`*/5 * * * *`). Vercel sends `Authorization: Bearer <CRON_SECRET>` itself. (Added to the code when hosting is chosen; on another host, any scheduler that calls the address with that header works.)
4. **Domain:** Vercel → Domains → add `outdoor.sogasho.com`; give IT the one DNS record Vercel shows. Until then the Vercel address works.
5. Open the site → sign in → **Settings → Pilot readiness**: the server settings must all pass.

## 6. Backups and the restore drill (gate item)

Supabase Pro keeps a **daily backup for 7 days** (Database → Backups).

Restore drill, once before go-live (about 30 minutes, on a scratch project — never restore over production for a drill):
1. Note today's figures on production: Dashboard → Overall Sales, and Stock → totals.
2. Supabase → outdoor-production → Database → **Backups** → choose yesterday's backup → **Restore to a new project** (name `outdoor-restore-drill`).
3. In the new project's SQL Editor run `select count(*) from public.sales; select count(*) from public.stock_movements;` and compare with production as of the backup time.
4. Write the date, the backup used, the counts and "drill passed" in `docs/03-implementation/PHASE_LOG.md` (or tell me and I will record it).
5. Delete the drill project.

Before any production database change: take a manual backup first (Database → Backups → "Create backup", Pro plan), then paste the SQL.

## 7. Monitoring

- **Up or down:** a free uptime service (e.g. UptimeRobot) checks `https://<address>/api/health` every 5 minutes and emails you if it fails. The page only says `{"status":"ok"}` and the time.
- **Errors:** Vercel → Project → **Logs** (filter "Error"); Supabase → **Logs** → Postgres / Auth.
- **Daily glance during the pilot:** Dashboard → Operations (waiting approvals, open audit cases), Audit → cases older than 7 days.

## 8. Go-live sign-off

| Item | Done |
|---|---|
| Readiness page says **Ready** on production (Hargeisa) | ☐ |
| Opening stock: received = physical count, difference 0 | ☐ |
| Restore drill passed (section 6) | ☐ |
| Pilot test list passed (`docs/04-quality/pilot-uat.md`) | ☐ |
| Agents and Team Leaders trained (`docs/07-training/`) | ☐ |
| Incident runbook read (`docs/06-operations/incident-runbook.md`) | ☐ |
| **Business owner signs pilot go-live:** name ______ date ______ | ☐ |
