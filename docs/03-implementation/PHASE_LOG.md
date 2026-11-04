# Phase log

One entry per phase. Record only what was actually done and actually run.

---

## Phase 0 — Repository, environments and phase control

**Date:** 19 Oct 2026 · **Status:** Done

**Repository assessment**
- Git repository on `main`, remote `github.com/sakariye110/sogasho-outdoor-sales-audit` (private). Before Phase 0 it held only documents (BRD/SDD/Roadmap v1.4 and archives) and the brand kit — no application code.
- Tools: Git 2.55, Node.js 24.19, npm 11.17. Not installed: Docker, GitHub CLI, Supabase CLI (Supabase CLI runs via `npx` when needed).
- Environments: Supabase project "Outdoor" (staging / development, fake data only). Hosting deferred (T-02). Production database created at Phase 11.

**Done**
- Documents moved to `docs/` (SDD §5.3 layout); brand kit moved to `brand/` (T-09).
- Created `CLAUDE.md`, `README.md`, `.env.example` (names only), this log, `DECISIONS.md` (BRD decisions + T-01…T-09), `docs/04-quality/traceability-matrix.md`.
- Original requirements PDF not provided → `docs/00-source/` is empty. Not blocking.

---

## Phase 1 — Foundation, brand/design system, CI

**Date:** 19 Oct 2026 · **Status:** ✅ Accepted by the owner on 19 Oct 2026 (after sidebar review). Staging deploy item deferred (T-02).

**Scope delivered**
- Next.js 16.4.2 (App Router, Turbopack, Cache Components), React 19.3, TypeScript strict, Tailwind CSS 4, ESLint; npm scripts `dev`, `build`, `lint`, `typecheck`, `test`, `check`, `icons`.
- shadcn/ui (Radix, radix-nova) themed entirely with brand-kit colours (T-01, T-04); light theme only; Signika self-hosted via `next/font/local` (weights 300/400/600/700; `font-medium` replaced with `font-semibold` so only brand weights are used).
- Brand: `src/lib/brand.ts` (palette, theme tokens, status colours, contrast functions) mirrored in `src/app/globals.css`; lowercase semibold titles; `BrandLogo` component (white background, 1.5x clear space, 30 px minimum); decorative triangle-pattern strip in the header.
- App frame: collapsible sidebar (logo; one item per BRD module §6.2–6.16 and §9 — incl. Free-month compensation, Agent performance, Product switch, Refunds, Notifications, Products & prices — shown disabled with their phase number until built; user card placeholder), sticky header, mobile slide-out navigation. `tests/unit/navigation.test.ts` fails if a BRD module has no sidebar item.
- Pages: dashboard placeholder (`/`), brand check (`/design-system`), loading, error, not-found.
- Status badges for Pending / Approved / Rejected / Flagged / Refunded / Active / Expire / On hold.
- Helpers: EAT business month and date formatting (`src/lib/dates.ts`), USD formatting (`src/lib/money.ts`), typed translations over `messages/en.json` (`src/lib/i18n.ts`).
- PWA: `manifest.webmanifest` (192/512 + maskable icon), `favicon.ico` generated from brand icons, shell-only service worker in production (T-08).
- CI: `.github/workflows/ci.yml` — lint, type-check, unit tests, build, gitleaks secret scan on push to `main` and pull requests.

**Explicitly not in scope / not done:** authentication, database tables, business modules, Supabase connection, staging deployment.

**Commands run (19 Oct 2026, local, Windows, Node 24.19)**

| Command | Result |
|---|---|
| `npm run lint` | Pass (0 problems) |
| `npm run typecheck` | Pass |
| `npm run test` | Pass — 3 files, 50 tests (incl. BRD module coverage of the sidebar) |
| `npm run build` | Pass — routes `/`, `/design-system`, `/_not-found`, `/manifest.webmanifest` prerendered |
| `npm run dev` + browser check | Desktop and 375 px mobile: Signika loaded (400/600), titles lowercase, primary button `#047B95` with white text, active nav `#00557C` on `#E2E8ED`, no horizontal scroll on mobile, mobile menu opens with logo and all items, 404 page renders, manifest lists 3 icons, no console errors |

CI has not run yet — it runs on the first push of this commit.

**Acceptance gate**

| Criterion | Result |
|---|---|
| Installs and runs locally with documented commands | ✅ |
| Lint, type-check, tests, build pass | ✅ (locally) |
| CI green | ⏳ after push |
| Staging URL serves the shell | ⏸ Deferred (T-02) — required before Phase 11 |
| PWA installable | ✅ manifest + icons + service worker in place; Lighthouse check needs an HTTPS host (deferred with staging) |
| Brand: logo only on white/black; contrast checks pass | ✅ (`tests/unit/brand.test.ts`) |
| No secrets committed | ✅ `.env.example` has names only; local scan clean |
| No later phase started | ✅ |

**Manual steps for the owner**
1. Review the app: `npm install`, then `npm run dev`, open http://localhost:3000 and http://localhost:3000/design-system.
2. Before Phase 2: create `.env.local` from `.env.example` and fill in the Supabase URL and publishable key yourself.

**Risks / open items**
- Hosting not chosen (T-02): needed before the Hargeisa pilot (Phase 11).
- Open business inputs: D-27 (Phase 18), D-28 retention periods (Phase 20).
- Buttons are 32–36 px high (shadcn defaults); agent mobile screens in Phase 7 will use larger touch targets (≥ 44 px).

**Next prompt (not executed):**
> Proceed with Phase 2 only: database foundation. Follow BRD/SDD v1.4 and CLAUDE.md, inspect first, implement only Phase 2 (conventions, migration workflow with Supabase CLI against the "Outdoor" project, RLS helpers, `activity_log` and `audit_events` insert-only tables with tests), run `npm run check`, update the logs, report the gate and stop.

---

## Phase 2 — Database foundation, activity log and audit event log

**Date:** 19 Oct 2026 · **Status:** ✅ Accepted by the owner on 19 Oct 2026 — CI green (latest run, incl. real-Supabase pgTAP for change history); applied to "Outdoor" via SQL Editor.

**Scope delivered**
- Supabase CLI project (`supabase/config.toml`, project id `sogasho-outdoor`, Postgres 17), migration folder, labelled empty `seed.sql`.
- Migration `20261019120000_foundation.sql`:
  - private schema `app` (not exposed by the API); default EXECUTE removed from PUBLIC;
  - `app.business_month(ts)` (EAT, immutable — ready for generated sale-month columns, D-30);
  - RLS helpers `app.current_user_id()`, `app.is_active_user()`, `app.has_permission(key)`, `app.in_scope(owner, team, city)` — deny-by-default stubs until Phase 4 (T-12);
  - triggers `app.touch_updated()` and `app.prevent_change()`;
  - `app_settings` (read by signed-in users; no writes until Phase 5);
  - `activity_log` and `audit_events`: insert-only by grants **and** triggers (UPDATE/DELETE/TRUNCATE blocked for every role, including the owner); readable only with `audit.read`; written only through `app.log_activity()` / `app.record_audit_event()`, which take the actor from the session.
- Database tests: `tests/db` (PGlite + Supabase shim, T-10) and `supabase/tests/database/foundation.test.sql` (pgTAP on real Supabase in CI).
- CI: new jobs `supabase-db` (apply migrations to real Supabase Postgres + pgTAP) and `migrate-staging` (push to "Outdoor" after green `main`, only once secrets are set — T-11).
- Migration `20261019130000_change_log.sql` (owner request — "everything recorded in Supabase", T-13): `change_log` with automatic before/after history of every insert/update/delete on every business table (trigger `zz_change_log`, helper `app.enable_change_log()`, optional masked columns); append-only; readable only with `audit.read`. Attached to `app_settings`; a test fails if any future table lacks it.
- SQL Editor paste files (T-14): `npm run db:sql-editor` → `supabase/sql-editor/`; each runs all-or-nothing, refuses re-runs and out-of-order runs, and records itself as applied.
- Guide: `docs/06-operations/database.md` (SQL Editor steps first).

**Not in scope / not done:** user, customer, sales or stock tables; settings values (Phase 5); permission model (Phase 4).

**Commands run (19 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` | Pass — 6 files, 86 tests (36 database tests: foundation, change history, SQL Editor files) |
| `npm run build` | Pass |
| Sensitivity probe (temporary test, removed) | With the append-only trigger and grants removed, owner and signed-in updates succeed — confirms the real tests would catch a missing protection |

Not run locally: `supabase db start` / `supabase test db` (needs Docker) — they run in GitHub Actions on push. Migration not yet applied to "Outdoor".

**Acceptance gate**

| Criterion | Result |
|---|---|
| Migrations apply cleanly locally | ✅ PGlite (PostgreSQL 18) |
| Migrations apply cleanly on real Supabase | ✅ CI green for both migrations (owner confirmed) |
| Migrations apply on staging ("Outdoor") | ✅ owner applied both files in the SQL Editor on 19 Oct 2026 ("Run and enable RLS" on the bookkeeping-table prompt); Table Editor shows app_settings, activity_log, audit_events, change_log |
| Every table records before/after history | ✅ `tests/db/change-log.test.ts` coverage test |
| RLS enabled on every created table; denial tests pass | ✅ |
| Insert-only tables reject updates/deletes (all roles incl. owner) | ✅ |
| No service-role key reachable from the browser | ✅ no Supabase client code yet; `SUPABASE_SECRET_KEY` only in `.env.example` as a server-only name |
| Later business tables not built | ✅ |

**Manual steps for the owner** — Supabase "Outdoor" → SQL Editor: paste and run `supabase/sql-editor/20261019120000_foundation.sql`, then `supabase/sql-editor/20261019130000_change_log.sql`; confirm the four tables appear in Table Editor (see `docs/06-operations/database.md`).

**Risks / open items**
- PGlite runs PostgreSQL 18 while Supabase runs 17; the CI `supabase-db` job is the safeguard.
- Supabase Auth currently allows public sign-up by default (`config.toml`); Phase 3 disables it (accounts are created by Super Admin, FR-AUTH-04).

**Next prompt (not executed):**
> Proceed with Phase 3 only: authentication with Telesom OTP. Follow BRD/SDD v1.4 and CLAUDE.md, inspect first, implement only Phase 3, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 3 — Authentication and OTP

**Date:** 20 Oct 2026 · **Status:** ✅ Accepted by the owner on 20 Oct 2026 — owner-tested on "Outdoor" with a real Telesom SMS; CI green (incl. real-Supabase pgTAP).

**Scope delivered (BRD §6.1, FR-AUTH-01…09, FR-NOT-02/04)**
- Migration `20261020090000_auth.sql`:
  - `user_profiles` (temporary/permanent, phone E.164 or email, active, must-change-password, start/end date), created automatically from each Supabase Auth user; read own row only; change history on.
  - Sign-in lockout `auth_lockouts` (identifier stored as SHA-256 only): 5 failures in 15 min → locked 15 min; cleared only by the user's own successful sign-in.
  - SMS OTP `otp_challenges` (hash only; 5 min; single use; 5 tries; 3 sends / 15 min) and `otp_verified_sessions` (bound to the JWT session).
  - `app.is_active_user()` now enforces: active profile, password changed, OTP for agents (T-18) — every RLS policy inherits it.
  - API functions: `auth_lockout_until`, `auth_record_failure`, `auth_record_success`, `my_session_status`, `mark_password_changed`, `verify_otp` (users) and `issue_otp_challenge`, `record_otp_delivery` (server only, T-17).
  - Security events in `activity_log`: `auth.sign_in`, `auth.sign_in_failed`, `auth.locked`, `auth.password_changed`, `auth.otp_issued/sent/send_failed/verified/failed/expired/rate_limited` — no passwords, codes or identifiers.
- App: Supabase server and admin clients; `src/proxy.ts` (session refresh, protected routes, step routing); server actions sign in / verify OTP / resend / change password / sign out; screens `/login`, `/verify`, `/change-password` (brand styled, 44 px touch targets); signed-in name and Sign out in the sidebar.
- Identity: email for staff; phone (any local format) for agents, mapped to an internal Supabase address (T-16). Password rules T-19.
- SMS adapter: `test` (development only — code printed in the `npm run dev` terminal, refused in production) and `telesom` (gateway format per T-20: POST form, MD5 key, EAT date, 10 s timeout, no retry; safe failure note in the server log).
- Script `npm run user:create` (bootstrap Super Admin / test accounts; temporary password printed only in the owner's terminal).
- Supabase local config: public sign-up off, minimum password 8, letters + digits. Guide: `docs/06-operations/auth.md`. Decisions T-15…T-19.

**Not in scope / not done:** roles and Super Admin permissions, deactivation screen and auth-user ban (Phase 4); real Telesom delivery (blocked).

**Commands run (20 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` | Pass — 146 tests (30 new database auth tests, 26 new unit tests) |
| `npm run build` | Pass — `/login`, `/verify`, `/change-password` added; proxy active |
| Browser (no Supabase settings) | Protected pages redirect to `/login`, which explains the missing settings |
| Browser (dummy Supabase settings) | Protected page → 307 to `/login`; login form renders; wrong credentials → generic "Phone/email or password is incorrect."; mobile 375 px: 44 px fields/button, no horizontal scroll; server log shows no password or phone |

**Acceptance gate (UAT-01, 02, 33)**

| Criterion | Result |
|---|---|
| Both sign-in flows work on staging | ✅ owner test on "Outdoor", 20 Oct 2026: staff email sign-in → forced password change → dashboard; agent phone sign-in → password change → SMS code → dashboard |
| OTP delivered by Telesom to a real phone | ✅ delivered to the owner's phone, 20 Oct 2026. First attempt returned "Wrong Hashkey"; message encoding corrected and confirmed live (T-20) |
| Wrong credentials fail generically; lockout and OTP limits enforced | ✅ database tests + browser check |
| Unauthenticated access to protected routes denied | ✅ proxy redirect + RLS gate |
| First-login change enforced | ✅ database tests (`change_password` status blocks RLS until changed) |
| No passwords, OTPs or tokens in logs | ✅ activity_log tests; server log checked; test SMS provider refused in production |

**Manual steps for the owner** — `docs/06-operations/auth.md`: (1) paste `supabase/sql-editor/20261020090000_auth.sql`; (2) Supabase Auth settings (sign-ups off, password 8 + letters/digits); (3) create `.env.local`; (4) `npm run user:create` for yourself and a test agent; (5) run the sign-in tests. For real SMS: add the Telesom values to `.env.local` (auth.md step 6) and sign in as a test agent with your own phone.

**Issues found during owner testing (fixed)**
- Telesom "Wrong Hashkey": the guide's %20 encoding was wrong for this gateway → plain-text message in the key (T-20).
- Next.js dev warning "unstable value Date.now()" in the sidebar user card → `connection()` before the Supabase client.
- After a failed SMS the user stayed on the password page → now continues to the code screen with the reason and "Send a new code".
- PowerShell blocks `npm` scripts on the owner's PC → use `npm.cmd` (documented in auth.md).

**Risks / open items**
- Anyone can trigger a 15-minute lockout of a known phone/email by typing wrong passwords (inherent to lockout; logged as `auth.locked`).
- Internal agent addresses use the domain `phone.outdoor.sogasho.com`; no email is ever sent to them (accounts are created confirmed; password reset by email is not offered).

**Next prompt (not executed):**
> Proceed with Phase 4 only: users, roles, permissions and teams. Follow BRD/SDD v1.4 and CLAUDE.md, inspect first, implement only Phase 4, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 4 — Users, roles, permissions and teams

**Date:** 20–21 Oct 2026 · **Status:** ✅ Accepted by the owner on 21 Oct 2026 — owner-tested on "Outdoor" (users, teams and Team Leaders, deactivate/reactivate, D-31 no branch, D-32 SMS code for staff with a real Telesom SMS); CI green (incl. real-Supabase pgTAP).

**Scope delivered (BRD §4, §6.2 FR-USER-01…10, FR-AUTH-06; SDD §7; D-22, D-29)**
- Migration `20261020150000_access.sql`:
  - `roles` (7 roles of BRD §4), `permissions` (39 keys), `role_permissions` (matrix with scope own/team/city/all, seeded from SDD §7.2), `user_roles` (several roles per user), `teams`, `team_members` (one team per person).
  - `cities` (4) and `branches` (16, BRD §6.2.1) — read-only until Phase 5 (T-21); `user_profiles.city_id`, `branch_id`.
  - Real `app.has_permission`, `app.permission_scope`, `app.in_scope(permission, owner)` (replace the Phase 2 stubs); `user_profiles` readable by owner or within `users.read` scope.
  - Functions (each checks permission in the database): `my_access`, `has_permission`, `admin_update_user`, `admin_set_user_active`, `admin_require_password_change`, `admin_save_team`, `admin_set_role_permission`; one-time `app.bootstrap_super_admin` (SQL Editor only).
  - Safeguards: no self-deactivation, no removing your own Super Admin role, at least one active Super Admin, Super Admin matrix row locked, Team Leader of a team must hold the Team Leader role, branch must belong to the chosen city.
  - Change history on all new tables; admin actions logged in `activity_log` (`users.update`, `users.deactivate/reactivate`, `users.password_reset`, `teams.create/update`, `roles.permission_set`).
- Server actions `src/server/users/actions.ts`: create user (temporary password shown once), edit, deactivate/reactivate (database first, then Supabase Auth ban/unban), reset password, save team, set matrix cell (T-23).
- Screens: **Users** (search, status filter, add/edit dialog, actions menu), **Teams**, **Roles & permissions** (editable matrix); "no access" page for users without permission; brand check page restricted to `settings.manage`.
- Sidebar now permission-driven (`visibleNavigation`); every menu permission key is checked against the database seed by a test.

- **Owner decision D-32 (21 Oct 2026):** every user — agents and staff — gets the SMS code at sign-in. Migration `20261021090000_otp_for_everyone.sql`: OTP required for everyone in `app.is_active_user()` / `my_session_status()`; mobile number for every user (unique per employment type); `admin_set_user_phone` (Users screen, users.manage) and SQL-Editor-only `app.set_user_phone` for the first Super Admin. Users screen: Mobile number field on create and edit (a temporary agent's sign-in follows a changed number). Team dialog explains that only Team Leader-role users can lead a team.
- **Owner correction D-31 (20 Oct 2026):** agents have no home branch (Outdoor Department); branch = money hand-in point chosen per sale; stock flows Central → Team Leader → Agent. Migration `20261020190000_users_no_branch.sql` removes `user_profiles.branch_id` and requires a user's team to be in their city. BRD/SDD/Roadmap updated to v1.5.

**Not in scope:** branch/district maintenance screens and customer-type dropdowns (FR-USER-04, -09 maintenance, -10 → Phase 5).

**BRD check (FR-USER-01…10, FR-AUTH-06)**

| Requirement | Result |
|---|---|
| FR-USER-01 create and maintain accounts | ✅ Users screen (create, edit, reset password) |
| FR-USER-02 roles, permissions, module access | ✅ roles per user, editable matrix, permission-driven menu |
| FR-USER-03 activate / disable | ✅ deactivate / reactivate |
| FR-USER-04 customer types and dropdowns | ➡ Phase 5 (settings) |
| FR-USER-05 enforced on server and database | ✅ every action re-checked in the database; RLS on every table; direct writes denied (tests) |
| FR-USER-06 changes logged | ✅ activity_log + automatic change_log |
| FR-USER-07 teams; agent → city, Team Leader (no branch, D-31) | ✅ Teams screen; user city/team |
| FR-USER-08 employment type, start date, end date | ✅ end date set on deactivation, cleared on reactivation |
| FR-USER-09 16 branches seeded; maintain branches | ✅ seeded (T-21); maintenance ➡ Phase 5 |
| FR-USER-10 districts per city | ➡ Phase 5 |
| FR-AUTH-06 deactivated users blocked, sessions invalidated | ✅ RLS gate denies immediately; Supabase Auth ban blocks sign-in and refresh |

**Commands run (20 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test` | Pass — 195 tests (36 new role-boundary database tests; menu-permission tests) |
| `npm run build` | Pass — `/users`, `/users/teams`, `/users/roles` added |

Not yet run: the owner's sign-in test of the new screens on "Outdoor"; CI on GitHub (after upload).

**Acceptance gate (UAT-14, UAT-16 for users)**

| Criterion | Result |
|---|---|
| Allowed/denied tests for every role on user/team actions, via UI and direct API | ✅ database tests for all 7 roles (direct calls); UI hides actions without permission; ⏳ owner UI test |
| Deactivated user loses access immediately | ✅ database test (RLS gate + session status); ⏳ owner test with the test agent |
| Permission matrix editable by Super Admin only | ✅ database tests (other roles refused even by direct call; Super Admin row locked) |

**Manual steps for the owner** — `docs/06-operations/users.md`: paste `supabase/sql-editor/20261020150000_access.sql` (done) and `20261020190000_users_no_branch.sql`; run `select app.bootstrap_super_admin('<your email>')`; run the tests in section 4.

**Risks / open items**
- An existing session of a deactivated user keeps its token until expiry (≤ 1 hour) but every query is denied immediately by RLS; sign-in and refresh are blocked by the Supabase ban.
- Default matrix gives Auditor/Management read access to all users and sales (D-22); review on the Roles screen.

**Next prompt (not executed):**
> Proceed with Phase 5 only: master data and settings. Follow BRD/SDD v1.4 and CLAUDE.md, inspect first, implement only Phase 5, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 5 — Master data and settings

**Date:** 22 Oct 2026 · **Status:** ✅ Accepted by the owner on 22 Oct 2026 — owner-tested on "Outdoor" (both SQL files applied; settings, lists, products, 18 plans and prices; agent sees no Settings/Products); CI green (incl. real-Supabase pgTAP).

**Scope delivered (BRD §6.2 FR-USER-04, 09, 10; §6.3 FR-CONF-01, 03, 05, 07 settings; SDD §8.3, §9; D-04, D-08, D-10, D-18, D-29, D-33)**
- Migration `20261022090000_master_data.sql`:
  - New tables: `districts` (per city, unique name per city, no seed), `customer_types` (`new`, `retention`; fixed codes, editable names), `products` (FTTA, FTTH, FTTB, LTE seeded), `product_prices` (USD, optional city, effective from/to; overlap for the same product and city refused by a trigger), `stock_items` (WIFI_ROUTER, PDCOM, CALIX; serialized), `public_holidays`.
  - `app_settings` values seeded: cutoff day 3, incentive threshold 15, rate 5, temporary base salary 100, target 20, baseline 15, free-month 50, prefixes 063/065 and week start Saturday (D-33), weekend Friday (D-18), OTP on (D-32).
  - Writes only through functions that check `settings.manage` (lists, settings) or `prices.manage` (products, prices), validate and log: `admin_set_setting` (known keys only, per-key checks, baseline < target), `admin_save_branch`, `admin_save_district`, `admin_rename_customer_type`, `admin_save_product` (code fixed after creation), `admin_save_price`, `admin_save_stock_item`, `admin_save_holiday`, `admin_delete_holiday`.
  - `public.price_for(product, city, date)`: the city's own price, else the all-cities price, else none (used by sales in Phase 7 for the price snapshot, FR-CONF-03).
  - RLS: every active user reads the lists (forms need them); no direct insert/update/delete for any API role; change history on every new table.
- Screens: **Settings** (General, Branches, Districts, Lists, Public holidays) and **Products** (products + price list with Current / Upcoming / Ended, "No current price" warning). Shared tab bar `src/components/page-tabs.tsx` (Users tabs use it too). Menu items Settings and Products now active (`COMPLETED_PHASE = 5`).
- Owner input **D-33**: customer mobile prefixes 063 and 065; week starts Saturday.
- Owner input **D-34** (same day, after the first build): products have **plans**. Migration `20261022120000_plans.sql` replaces the product-level `product_prices` (never used) with `plans` (name, speeds, data) and `plan_prices` (recharge + installation fee, effective dates, same in all cities, no overlaps); loads the owner's 18 plans (BRD §6.3.1) effective 22 Oct 2026; functions `admin_save_plan`, `admin_save_plan_price`, `plan_price(plan, date)`. Products screen shows products, plans (current price, speeds, "No current price" warning) and price history.

**Not in scope:** applying the prefixes and the price snapshot to sales (Phase 7); targets per agent (Phase 14); other dropdown lists (refund reasons, stock return reasons, leave types) arrive with their modules.

**BRD check**

| Requirement | Result |
|---|---|
| FR-USER-04 customer types and dropdown options | ✅ customer types renamable (codes fixed); module dropdowns arrive with their phases |
| FR-USER-09 branches seeded; add/rename/deactivate | ✅ Settings → Branches |
| FR-USER-10 districts per city; Area not a list | ✅ Settings → Districts; no areas table |
| FR-CONF-01 products, plans and price list (FTTA, FTTH, FTTB, LTE) | ✅ Products screen; 18 plans loaded (D-34) |
| FR-CONF-03 price stored on each sale | ✅ `plan_price` ready; snapshot stored by sales ➡ Phase 7 |
| FR-CONF-05 plan prices with effective dates, same in all cities (D-34) | ✅ owner's prices loaded; edits by Super Admin; overlap refused |
| FR-CONF-07 target 20 / baseline 15 set by Super Admin | ✅ Settings → General (baseline must stay below target); bands shown ➡ Phases 10/14 |
| FR-LEAVE-07 weekend days and holidays configurable | ✅ settings + Public holidays (used in Phase 17) |
| FR-SALE-04 allowed prefixes configurable | ✅ setting (063, 065); enforced on sales ➡ Phase 7 |
| SDD §9 deactivated values readable on history, rejected for new records | ✅ active flags; new prices refused for inactive products; sales/stock refuse inactive values ➡ Phases 6–7 |

**Commands run (22 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 262 tests (new: 55 master-data database tests incl. plans, 4 settings-form and date tests); build adds `/settings`, `/settings/branches`, `/settings/districts`, `/settings/lists`, `/settings/holidays`, `/products` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261022090000_master_data.sql` |

Not yet run: the owner's test of the new screens on "Outdoor" (the browser pane cannot sign in — the SMS code goes to the owner's phone); CI on GitHub (after upload).

**Acceptance gate**

| Criterion | Result |
|---|---|
| Admin can maintain all lists; others denied | ✅ database tests: Super Admin allowed; agent, Finance, deactivated Super Admin and anonymous refused for every function; direct table writes refused even for Super Admin; ⏳ owner UI test |
| Price lookup returns the correct effective price for a date | ✅ database tests for plan prices (boundaries, open-ended, price change, overlaps); seed compared with the owner's sheets |
| Branch seed matches BRD §6.2.1; districts and prices enterable on staging | ✅ test compares the seed with the BRD table; ⏳ owner enters districts and prices on "Outdoor" |

**Manual steps for the owner** — `docs/06-operations/settings.md`: paste `supabase/sql-editor/20261022090000_master_data.sql`, then `20261022120000_plans.sql`; run the tests in section 3.

**Risks / open items**
- Districts must be entered by the business before go-live (D-29); plan prices are loaded (D-34) and must be kept current; Phase 11 readiness checks both.
- Turning **SMS code at sign-in** off disables the code for everyone; it is for emergencies only (e.g. SMS outage).

**Next prompt (not executed):**
> Proceed with Phase 6 only: stock ledger, custody and serials. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 6, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 6 — Stock ledger and team custody

**Date:** 22 Oct 2026 · **Status:** ✅ Accepted by the owner on 22 Oct 2026 — owner-tested on "Outdoor" (receive, issue to an Outdoor Supervisor, accept, report); test stock cleared with `supabase/maintenance/reset_stock_test_data.sql`; CI green (incl. real-Supabase pgTAP).

**Owner decisions before building (D-35, 22 Oct 2026):** no serial numbers anywhere — stock is counted by quantity; the Stock Officer sends quantities to each team; the team's Team Leader / Supervisor accepts (Super Admin may accept for them); each sale by the team deducts the items the agent picks from the team's accepted stock; returns are recorded by the Stock Officer only. This replaces D-12 (serial tracking) and the agent-custody level of D-31. BRD/SDD/Roadmap/CLAUDE.md updated (FR-SALE-08, FR-STK-03, 06, 08, 09, 10, FR-REF-08, FR-SW-02, UAT-08, 22, 35; SDD §12 rewritten).

**Scope delivered (BRD §6.12; SDD §12)**
- Migration `20261022150000_stock.sql`:
  - `stock_locations` (Central Store, Central Store — faulty, one per team; created automatically with each team), `stock_movements` (append-only ledger: receipt, transfer_out, transfer_in, issue, return, adjustment), `stock_transfers` + `stock_transfer_lines`, `stock_adjustments`. Stock items set to not serialized.
  - Functions: `stock_receive`, `stock_send`, `stock_accept` (receiving Team Leader or Super Admin), `stock_cancel` (before acceptance, reason), `stock_return` (Stock Officer; to Central or the faulty store; reason codes), `stock_request_adjustment` / `stock_decide_adjustment` (no self-approval), `stock_report(from, to)`; internal `app.issue_stock(seller, lines, ref)` for sales in Phase 7 (not callable through the API).
  - Balances computed from the ledger only; every decrease locks (location, item) and refuses to go below zero; multi-item operations are all-or-nothing.
  - RLS: Stock Officer, Finance, Auditor, Super Admin see all locations; Team Leaders and agents see only their team (`app.can_read_location`); no direct writes for any API role; change history on every new table.
- Screens (**Stock**): Overview (balances, in transit, stock to accept), Issue & receive (receive, issue stock to an Outdoor Supervisor, accept, cancel), Returns & adjustments, Report & history. Menu item enabled (`COMPLETED_PHASE = 6`).
- Owner feedback (22 Oct 2026): stock is issued to the **Outdoor Supervisor** by name ("Issue stock", not "Send to team"); the Supervisor or Super Admin accepts. Migration `20261022170000_stock_supervisors.sql` adds `stock_supervisors()` so the Stock Officer sees Supervisor names without reading the user list (agents see only their own team's Supervisor).

**BRD check (FR-STK-01…10)**

| Requirement | Result |
|---|---|
| FR-STK-01 receipts into Central | ✅ Receive stock |
| FR-STK-02 items WiFi Router, PDCOM, CALIX; names editable | ✅ (names in Settings → Lists, Phase 5) |
| FR-STK-03 sale deducts in the same transaction | ✅ `app.issue_stock` ready and tested; called by sales ➡ Phase 7 |
| FR-STK-04 report: received, transferred, issued, returned, adjusted, balance per item and location | ✅ Report & history |
| FR-STK-05 no negative balance | ✅ enforced in the database with a lock per location and item |
| FR-STK-06 movement records item, quantity, from/to, link, user, time, type | ✅ append-only ledger |
| FR-STK-07 adjustments need reason and Super Admin approval | ✅ no self-approval |
| FR-STK-08 Central → team stock; counts after acceptance | ✅ (D-35) |
| FR-STK-09 counted by quantity, no serials | ✅ (D-35) |
| FR-STK-10 returns by the Stock Officer with a reason | ✅ to Central or the faulty store |

**Commands run (22 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 286 tests (24 new stock database tests); build adds `/stock`, `/stock/deliveries`, `/stock/returns`, `/stock/history` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261022150000_stock.sql` |

Not yet run: the owner's test on "Outdoor" (the browser pane cannot sign in — the SMS code goes to the owner's phone); CI on GitHub (after upload).

**Acceptance gate**

| Criterion | Result |
|---|---|
| Movements reconcile to balances | ✅ database test: every report row satisfies closing = opening + in − out and equals the ledger balance |
| Concurrent deductions cannot overdraw | ⚠️ enforced by a transaction lock on (location, item) plus a balance re-check; the PGlite test database has a single connection, so a true two-session race was **not** run — tested as sequential overdraw refusal and all-or-nothing behaviour |
| No negative balances; invalid or unauthorized actions rejected | ✅ database tests for every function and role (Stock Officer, Team Leader of the right/wrong team, agent, Finance, Super Admin, anonymous) |
| Movement history immutable and inspectable | ✅ updates/deletes refused for everyone; History tab |

**Manual steps for the owner** — `docs/06-operations/stock.md`: paste `supabase/sql-editor/20261022150000_stock.sql`, then `20261022170000_stock_supervisors.sql`; give a user the Stock Officer role; run the tests in section 3.

**Risks / open items**
- Without serials, a specific unit cannot be traced to a customer; accountability is per team and item (owner decision D-35).
- A sale by someone who belongs to no team (and leads none) cannot take equipment — every seller must be in a team.

**Next prompt (not executed):**
> Proceed with Phase 7 only: sales registration. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 7, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 7 — Sales registration

**Date:** 24–25 Oct 2026 · **Status:** ✅ Accepted by the owner on 25 Oct 2026 — owner-tested on both sites (sales saved as "Waiting for approval", duplicate blocking, own city and districts); both SQL files applied to "Outdoor" and "Outdoor Training"; CI green (incl. real-Supabase pgTAP). Fixes during testing: drafts kept per user and the seller's own city always used (8d86484); seller name shown for any role (4e0a2c4).

**Open for Phase 8:** a Super Admin's own sale needs another Super Admin to approve it (no self-approval) — decide whether Super Admins sell, or a second Super Admin exists.

**Owner decision during testing (D-37, 24 Oct 2026):** every sale — New and Retention — waits for the agent's Team Leader / Outdoor Supervisor (Super Admin fallback, no self-approval); the Supervisor records the equipment at approval (Phase 8), so the agent no longer enters equipment; a rejected New sale releases the customer's numbers; approve or reject only. Migration `20261024120000_sales_all_need_approval.sql` replaces `create_sale` (all sales pending; equipment in the request ignored; no stock moves at registration); the equipment card is removed from the form. BRD FR-SALE-07, 08, FR-STK-03, BR-02, §5, §8.2, UAT-05/06/08/22/36, SDD §10.2–10.3, Roadmap Phase 8 and CLAUDE.md updated.

**Owner decisions before building (D-36, 24 Oct 2026):** Retention name check = close match (rule in DECISIONS, `app.names_match`); months paid 1–12 with amount = recharge × months + installation fee; free month on any plan (2 months, allowed when 2 × recharge ≥ the $50 setting). BRD FR-SALE-01, 12, FR-FREE-02, 04, BR-17 and SDD §10.1–10.2 updated.

**Scope delivered (BRD §6.4 FR-SALE-01…06, 08…20, 22; §6.11 FR-FREE-01…04; §7 duplicate controls; SDD §10.1, 10.2, 10.6, 11.1)**
- Migration `20261024090000_sales.sql`:
  - `customers`, `customer_identifiers` (phone E.164 and 8-digit Index; each value unique for ever — current and former; one current value per kind), `sales` (1 row = 1 unit; agent from the session; `submitted_at` from the database clock; `sale_month` generated from it in EAT; price snapshot from the plan; months paid; free month; amount check constraint; one approved/pending sale per customer per month by partial unique index; unique `client_request_id`), `sale_items` (append-only).
  - `public.create_sale(p)`: permission, idempotency, validation (name, phone + allowed prefixes, 8-digit Index, city default + override only with `sales.override_city`, district of the city, area, branch, plan with a price today, months, free month), identity resolution (New / Retention, close-match names, former numbers), same-month rule, writes in a sub-transaction so a race on a unique index becomes a duplicate result. (As first built, the sale also took equipment from the team stock and New sales were approved at once — changed by D-37: every sale is pending; equipment at approval.) Duplicates write a durable `audit_events` row (DUP_PHONE, DUP_INDEX, IDENTITY_CONFLICT, SAME_MONTH) and return a result instead of raising, so the event survives. Every sale → pending_approval (D-37).
  - `public.change_customer_identifier` (Super Admin, reason, old value kept and reserved).
  - RLS: sales by `sales.read` scope; customers and identifiers by `customers.read` scope (`app.can_read_customer`); no direct writes for any API role; change history on every new table.
- Screens: **Sales** (My Sales with month selector, read-only past months, agent selector for Team Leaders / Super Admin, totals), **New sale** (mobile-first form, no date field, draft autosaved on the device with its request id, month warning for an old draft, price/amount preview; no equipment — D-37), **sale detail**, **Free-month compensation** list, **Customers** (search; Super Admin changes phone / Index). Menu items enabled (`COMPLETED_PHASE = 7`).

**Not in scope:** the approval screen with equipment and the release of rejected numbers (Phase 8, D-37), product switch (Phase 8); Super Admin notifications of duplicates (Phase 9 — the audit events are already durable); payroll-month locking (Phase 16, FR-SALE-21).

**BRD check**

| Requirement | Result |
|---|---|
| FR-SALE-01 form fields | ✅ incl. plan and months paid (D-36) |
| FR-SALE-02 district by city; area free text | ✅ |
| FR-SALE-03 city default, override only Team Leader / Super Admin | ✅ `sales.override_city` |
| FR-SALE-04 phone E.164, prefixes 063/065, unique | ✅ |
| FR-SALE-05 Index exactly 8 digits, unique | ✅ |
| FR-SALE-06 New / Retention | ✅ |
| FR-SALE-07 every sale needs approval (D-37) | ✅ every sale stored as pending; approval screen ➡ Phase 8 |
| FR-SALE-08 equipment recorded by the Supervisor at approval (D-37) | ➡ Phase 8 (stock function `app.issue_stock` ready since Phase 6) |
| FR-SALE-09 agent from session, time, status, history | ✅ approval history ➡ Phase 8 |
| FR-SALE-10 clear messages | ✅ every error and duplicate rule has a message (unit test) |
| FR-SALE-11 New duplicate blocked + durable event | ✅ notification ➡ Phase 9 |
| FR-SALE-12 Retention link / create / conflict | ✅ close-match names (D-36) |
| FR-SALE-13 one non-reversed sale per month | ✅ |
| FR-SALE-14 product + plan, price from catalog | ✅ |
| FR-SALE-15 draft autosave, idempotent | ✅ |
| FR-SALE-16 identity change by Super Admin with reason | ✅ old value reserved |
| FR-SALE-17…19 no date field; server time; after-midnight rule; old-draft warning | ✅ |
| FR-SALE-20 My Sales month selector, past months read-only | ✅ |
| FR-SALE-21 finalized months locked | ➡ Phase 16 |
| FR-SALE-22 branch per sale | ✅ |
| FR-FREE-01…04 | ✅ (D-36) |

**Commands run (24 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 331 tests (37 new: sales database tests for every Phase 7 UAT case, name-matching cases, sales messages); build adds `/sales`, `/sales/new`, `/sales/[id]`, `/free-month`, `/customers` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261024090000_sales.sql` and refreshed `supabase/fresh-project/all_changes_in_order.sql` |

Not yet run: the owner's test on "Outdoor" (the browser pane cannot sign in — the SMS code goes to the owner's phone); CI on GitHub (after upload).

**Acceptance gate (UAT-03, 04, 05, 09, 19, 20, 21, 30, 32, 37, 42, 43, 44, 45; UAT-08 and 22 moved to Phase 8 by D-37)**

| Criterion | Result |
|---|---|
| All listed UAT cases pass in automated tests | ✅ each has a database test (UAT-42/43: dates and agent in the request ignored; UAT-44: 31 Oct 23:59 EAT → October, 1 Nov 00:10 → November; UAT-45: no update/delete/insert on sales for any role) |
| Two simultaneous New sales with the same phone → one succeeds, one audit event | ⚠️ enforced by the unique index and the sub-transaction handler that turns the race into a DUP result; a true two-session race was **not** run (the PGlite test database has one connection) |
| Agent ID from the session only | ✅ test sends another agent's id — ignored |
| Free-month sale: flag, revenue, 1 unit | ✅ |
| Past or future date in the request → server time | ✅ |

**Manual steps for the owner** — `docs/06-operations/sales.md`: paste `supabase/sql-editor/20261024090000_sales.sql` (done on both sites) and then `20261024120000_sales_all_need_approval.sql` into **Outdoor** and **Outdoor Training**; rebuild and restart the training site; add districts; run the tests in section 4.

**Risks / open items**
- Super Admin is not yet *notified* of duplicate attempts (Phase 9); the events are recorded and visible in `audit_events`.
- Until Phase 8 is built, sales stay "Waiting for approval" (no approval screen yet) and no equipment is recorded.
- Supervisors will approve roughly 700–900 sales a month; approvals after the payroll cutoff move units to the approval month (D-37).
- The close-match rule may accept two genuinely different people with very similar names on the same phone and Index; phone and Index must still both match.

**Next prompt (not executed):**
> Proceed with Phase 8 only: Retention approval and product switch. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 8, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 8 — Sale approval with equipment, product switch, notifications

**Date:** 25 Oct 2026 · **Status:** ✅ Accepted by the owner on 25 Oct 2026 — owner-tested on both sites (approvals with one device by product, Team Leader self-approval of own sales, rejection, switches, notifications); all Phase 8 SQL files applied to "Outdoor" and "Outdoor Training"; CI green (incl. real-Supabase pgTAP).

**Owner decision during testing (D-40, 25 Oct 2026):** Team Leaders approve their own sales with a device from their own team; their own switches (and, Phase 12, refunds) still go to Super Admin. Migration `20261025150000_team_leader_self_approval.sql` (`app.check_decider` allows the leader's own sale; new `app.check_switch_decider` / `app.switch_approvers_for` keep switches strict; approve_switch / reject_switch replaced, D-39 check kept). Accepted risk recorded; a self-approval review is planned for Phase 9.

**Owner decision during testing (D-39, 25 Oct 2026):** exactly one device per approval, by product — FTTA: WiFi Router; FTTH / FTTB: PDCOM or CALIX; LTE: none; switches by the new product. Migration `20261025120000_product_equipment.sql` (`product_equipment`, `app.check_equipment`, approve_sale / approve_switch replaced); the Approvals screen shows only the allowed devices as a single choice. Also during testing: Index and Branch columns and even column spacing on the sales list; Super Admin can reject (cancel) their own sale from Approvals.

**Owner decisions before building (D-38, 25 Oct 2026):** Super Admins do not register sales or switches; product switch goes to the Supervisor like a sale (new equipment recorded at approval); the agent picks the new plan, no payment; From Product must be the customer's current product. Applied with D-37 (every sale waits; equipment at approval; rejected New sale releases numbers; approve or reject only).

**Scope delivered (BRD §6.4 FR-SALE-07/08, §6.10 FR-SW-01…06, §6.16 FR-NOT-03; SDD §10.3, §10.4, §18)**
- Migration `20261025090000_approvals_switches.sql`:
  - `customer_identifiers`: `released_at` / `released_by`; uniqueness now over live (not released) values; `create_sale` (replaced) ignores released numbers and refuses Super Admins; `change_customer_identifier` (replaced) likewise.
  - `approve_sale(id, items)` — Team Leader of the sale's team or Super Admin (`app.check_decider`), never one's own; equipment deducted from the sale's team stock in the same transaction (`app.issue_from_team`), refused if short; `reject_sale(id, reason)` — releases a New customer's identifiers when the customer has no other sale or switch; a Super Admin may cancel their own sale. History in `approvals` (append-only).
  - `product_switches` + `switch_items`; `create_switch` (identity match incl. close-match name, From Product = `app.current_product`, FTTA ↔ FTTH only, new plan, one pending per customer, idempotent; mismatches write a durable `SWITCH_MISMATCH` event), `approve_switch` / `reject_switch` (same approver rules; equipment at approval; stale check).
  - `notifications` (in-app): sale/switch awaiting decision → the team's leader (Super Admin when none or when the seller is the leader); approved/rejected → the agent; stock issued → the receiving Supervisor. `mark_notifications_read`.
  - RLS: switches by `sales.read` scope; approvals follow the sale/switch; notifications only the owner's; no direct writes; change history on every new table.
- Screens: **Approvals** (cards with equipment boxes and team stock available, Approve / Reject with reason), **Product switch** (form + my switches), **Notifications** page and a **bell** with the unread count in the top bar; sale detail shows the decision history; "New sale" hidden for Super Admins. Menu items enabled (`COMPLETED_PHASE = 8`).

**BRD check**

| Requirement | Result |
|---|---|
| FR-SALE-07 every sale approved by the Team Leader / Supervisor; Super Admin fallback; no self-approval | ✅ |
| FR-SALE-08 equipment recorded at approval, deducted from the team stock | ✅ |
| FR-SALE-09 approval history | ✅ `approvals`, shown on the sale |
| FR-STK-03 deduction in the same transaction as the approval | ✅ |
| FR-SW-01…03 switch form, identity match | ✅ (D-38: current product, new plan) |
| FR-SW-04 one linked record; new equipment at approval; old via Stock Officer | ✅ |
| FR-SW-05 FTTA ↔ FTTH only | ✅ |
| FR-SW-06 never a sale | ✅ test: sales count unchanged |
| FR-NOT-03 approvers notified in-app | ✅ (refund approvals arrive with Phase 12; email/duplicate alerts with Phase 9) |

**Commands run (25 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 350 tests (20 new: approval, rejection and release, switch, notification database tests; notification texts); build adds `/approvals`, `/switches`, `/notifications` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261025090000_approvals_switches.sql` and refreshed the new-project file |

Not yet run: the owner's test on "Outdoor" (the browser pane cannot sign in); CI on GitHub (after upload).

**Acceptance gate (UAT-06, 08, 12, 22, 34, 35, 36)**

| Criterion | Result |
|---|---|
| Self-approval and cross-team approval denied (UI and API) | ✅ database tests (agent, other team's leader, Team Leader's own sale, anonymous); the Approvals list shows only decidable items |
| Equipment at approval; refused when the team is short (UAT-08, 22) | ✅ |
| Switch identity mismatch rejected; same-product switch blocked (UAT-12) | ✅ incl. durable SWITCH_MISMATCH events |
| Switches excluded from sale counts (UAT-34) | ✅ |
| Rejected New sale: no stock moved; numbers released (UAT-35 as reworded by D-37) | ✅ |

**Manual steps for the owner** — `docs/06-operations/approvals.md`: paste `supabase/sql-editor/20261025090000_approvals_switches.sql` (done on both sites) and then `20261025120000_product_equipment.sql`, then `20261025150000_team_leader_self_approval.sql` into **Outdoor** and **Outdoor Training**; rebuild and restart the training site; run the tests in section 3.

**Risks / open items**
- Sales and switches by sellers without a team can only be decided by Super Admin, and no equipment can be given on them.
- Email copies of notifications, duplicate-attempt alerts and audit cases arrive in Phase 9.
- Team Leaders' own sales are approved without a second person (D-40); add the "self-approved" audit rule in Phase 9.

**Next prompt (not executed):**
> Proceed with Phase 9 only: duplicate detection, audit cases and alerts. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 9, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 9 — Duplicate detection, audit cases and alerts

**Date:** 26 Oct 2026 · **Status:** ✅ Accepted by the owner on 28 Oct 2026 — owner-tested on both sites; Phase 9 SQL file applied to "Outdoor" and "Outdoor Training"; CI green (incl. real-Supabase pgTAP) on commit 7e6f4f3. The "email received on staging" item stays open until the email account is set up (R-5); in-app alerts are the main channel (D-41).

**Owner refinements after reviewing the risks (D-41, 26 Oct 2026, before testing):** MULTI_AGENT_ATTEMPT counts New sales and blocked attempts only and holds only the attempting agent; Super Admin identity corrections are IDENTITY_CORRECTED events (no case, no hold); POST_APPROVAL_EDIT only for a change to an approved sale itself; queued emails also sent on any page view (scheduled sender in Phase 11); advisory lock per customer/agent when grouping events. Applied in the same (not yet pasted) migration.

**Owner decisions before building (D-41, 26 Oct 2026):** MULTI_AGENT_ATTEMPT and POST_APPROVAL_EDIT on, BURST off; Team Leaders' self-approved sales (D-40) recorded as SELF_APPROVED events only (no case, no hold); cases changed by Super Admin and the assigned Auditor. Email: the owner has a work address but no control of sogasho.com DNS → provider adapter with Brevo (verified single sender) recommended (T-25).

**Scope delivered (BRD §6.6 / §7 FR-AUD-01…08, FR-NOT-01/05; SDD §11, §17.3, §18)**
- Migration `20261026090000_audit_cases.sql`:
  - `audit_rules` (enable flag, can_disable, opens_case, thresholds; 9 rules seeded); `public.audit_rule_update` (settings.manage, core rules stay on, thresholds checked, logged).
  - `audit_cases` (case number, state, outcome, assignee; identity columns immutable, no delete), `audit_case_links` and `audit_case_history` (append-only); change history on every new table.
  - Automatic grouping (trigger on `audit_events`): same customer — or, without one, same agent — within 30 days joins the open/under-review case, else a new case; links the event, customer, agent and sale. Every active Super Admin (and the assignee) gets an `audit_alert` notification.
  - Rules: MULTI_AGENT_ATTEMPT (New sales + blocked attempts by ≥ N agents in D days, once per window; only the attempting agent linked), BURST (≥ N sales in M minutes, once per window), POST_APPROVAL_EDIT (approved sale itself changed → case), IDENTITY_CORRECTED (identifier replaced or customer renamed after approval → event only), SELF_APPROVED (approval by the seller → event only).
  - Case functions: `audit_case_set_status` (Open → Under Review → Confirmed Issue / False Positive → Resolved; note required; Super Admin or assigned Auditor only), `audit_case_add_note`, `audit_case_assign` (Super Admin; active Auditor / Super Admin; notifies + emails the assignee), `audit_case_create` (Super Admin, optionally about a sale).
  - Effects for Phase 10/16: `app.agent_audit_hold(agent)`, `app.sale_audit_state(sale)` → confirmed_issue / on_hold / null.
  - `email_outbox` (no API access except the server); queued by a trigger from audit notifications, no phone/Index; agents' internal addresses skipped. `email_outbox_summary()` for Super Admin.
  - Notification kinds `audit_alert`, `audit_case_assigned`.
- App: email adapter `src/server/email/provider.ts` (brevo / resend / log) and sender `deliver.ts` (secret key, T-25; run after sales, switches, identifier changes and case actions, and by "Send emails now"). Screens **Audit → Cases / Events / Rules**, case page (rule explanation, attempted values, matching customer, agents with hold flag, linked sales with ineligible/on-hold flag, history, actions), **Open audit case** and audit flag on the sale page, notification texts and links. Menu: `COMPLETED_PHASE = 9`. Training site now passes `PORT=3001` so email links point at it.

**BRD check**

| Requirement | Result |
|---|---|
| FR-AUD-01 duplicate phone / Index never a separate customer | ✅ (Phase 7, unchanged) |
| FR-AUD-02 durable event + Super Admin notified | ✅ in-app; email queued — sends once the email account is set up |
| FR-AUD-03 rule, attempted values, matching record, agent, date/time, case status | ✅ Events tab and case page |
| FR-AUD-04 states Open → Under Review → Confirmed Issue / False Positive → Resolved | ✅ enforced in the database |
| FR-AUD-05 no edit/delete; only state, assignment, notes, with history | ✅ tests incl. the database owner |
| FR-AUD-06 risk indicator; only a reviewer sets Confirmed Issue | ✅ |
| FR-AUD-07 only Super Admin and the assigned Auditor change state | ✅ (unassigned Auditor, agent, Team Leader, anonymous denied) |
| FR-AUD-08 Open / Under Review → hold; Confirmed Issue → ineligible | ✅ flags exposed; applied by eligibility (Phase 10) and payroll (Phase 16) |
| FR-NOT-01/05 Super Admin alerted in-app + email, Auditor on assignment | ✅ in-app; email pending setup |

**Commands run (26 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 386 tests (27 new audit database tests; 6 email adapter unit tests); build adds `/audit`, `/audit/events`, `/audit/rules`, `/audit/cases/[id]` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261026090000_audit_cases.sql` and refreshed the new-project file |

Not yet run: the owner's test on "Outdoor" (the browser pane cannot sign in); a real email send (needs the owner's email account); CI on GitHub (after upload).

**Acceptance gate (UAT-03 alert part)**

| Criterion | Result |
|---|---|
| Events link to source records and explain the rule | ✅ database tests (links to event, customer, agent, sale) + rule explanation on screen — owner test pending |
| Cases and history cannot be edited or deleted | ✅ API and database-owner attempts refused (tests) |
| False Positive leaves sales unaffected; Confirmed Issue marks them ineligible | ✅ tests (`app.sale_audit_state`) |
| Email alert received on staging | ⛔ **BLOCKED — awaiting the email account (R-5)**: queue, adapter and sender built and unit-tested |

**Manual steps for the owner** — `docs/06-operations/audit.md`: paste `supabase/sql-editor/20261026090000_audit_cases.sql` into **Outdoor** and **Outdoor Training**; rebuild and restart the training site; set up Brevo (section 2) and put the three EMAIL lines in `.env.local`; run the tests in section 4.

**Risks / open items**
- Without DNS records for sogasho.com, alert emails may land in Spam until IT adds Brevo's records.
- MULTI_AGENT_ATTEMPT is on from the start (D-41); Retention sales are not counted and only the attempting agent is held — a genuine mistaken attempt still holds that agent until the case is reviewed.
- Simultaneous events for one customer are serialised by an advisory lock (worst case before: two cases instead of one); not proven under real parallel sessions, as PGlite has a single connection.
- Emails go out only while the app is running (after actions and page views, or "Send emails now"); the in-app bell is the main alert; a scheduled sender is planned with hosting (Phase 11).

**Next prompt (not executed):**
> Proceed with Phase 10 only: eligibility service and operational dashboard. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 10, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 10 — Eligibility service and operational dashboard

**Date:** 3 Nov 2026 · **Status:** ✅ Accepted by the owner on 4 Nov 2026 — owner-tested on both sites; Phase 10 SQL file applied to "Outdoor" and "Outdoor Training"; CI green (incl. real-Supabase pgTAP) on commit a03698c.

**Owner decisions before building (D-42, 30 Oct – 3 Nov 2026):** the owner's dashboard prompt, cards PDF and mock-up were reviewed line by line first. Products FTTA, FTTH, FTTB (the owner's "FTTP") and LTE each separately; no city or branch targets — a city's target is (active Sales Agents + all active Team Leaders) × the target units in Settings until Phase 14; nobody sells outside their own city; Sales Manager = Super Admin; Stock Officer sees the stock part only; main cards Eligible, waiting-for-approval as Submitted; revenue = amount collected; month views use the eligible rule, today / week (from Saturday) / custom range count approved sales by submission date; views under Dashboard in the existing sidebar; agent bands shown now; on-screen reports only; owner's stock cards (received / issued to customers per device). The mock-up guided layout only (brand kit colours and Signika kept; "Think · Do · Share", "illustrative" labels and % change on all-time figures left out).

**Scope delivered (BRD §8.2, §9.1, §9.3; SDD §14.1–14.2; FR-REP-01, 03, 05; FR-CONF-07 display)**
- Migration `20261103090000_dashboard.sql`:
  - `app.eligible_sale_facts()` / `app.eligible_sales(month)` — the one eligible-sale definition (approved, not reversed, not Confirmed issue, a sale; counting month with the payroll cutoff from Settings; `on_hold` from open cases on the sale or its agent). Not callable through the API.
  - `app.dashboard_period` (today, week, month, previous month, year to date, custom ≤ 366 days, EAT), `app.scope_users` (scope from `dashboard.read`, worked out once), filters checked (`FILTER_INVALID`, `PERIOD_INVALID`).
  - Read functions: `dashboard_context`, `dashboard_figures` (buckets overall / month / last_month / period / submitted_month / submitted_period / pending; by city, branch, product, agent), `dashboard_trend`, `dashboard_people`, `dashboard_agents`, `dashboard_sales_list` (drill-down), `dashboard_stock` (received company-wide for stock.read all; issued to customers by location scope and filters), `dashboard_audit` (audit.read).
  - `sales.override_city` removed from Team Leaders; `dashboard.read` removed from Stock Officers; index `sales_status_month_idx`.
- App: views **Sales Overview** (`/`), **Branch Performance**, **Technology Sales**, **Sales Trends**, **Performance Reports**, **Operations** and the drill-down list `/dashboard/sales`; shared filter bar (GET form, shareable links), tabs, "How these figures are counted", freshness time, loading / empty / error states; charts on Recharts 3.10.1 in brand-kit colours (`productColors`, `segmentColors`, `bandColors` in `src/lib/brand.ts`); sidebar group **Dashboard**; `COMPLETED_PHASE = 10`; Stock Officers land on Operations.

**BRD check (§9.1, §9.3)**

| Requirement | Result |
|---|---|
| Daily, month-to-date and overall views | ✅ Today, This week, This month, Previous month, Year to date, Custom range; overall cards |
| Units, units per product, revenue | ✅ Overview + Technology Sales (FTTA, FTTH, FTTB, LTE) |
| Performance by city and branch | ✅ Branch Performance (4 cities × 8 indicators, 16 branches) |
| New and Retention, overall and this month | ✅ |
| Monthly sales and revenue trend | ✅ Sales Trends (12 months) |
| Agent target progress and bands (count and list) | ✅ shown from eligible sales with the Settings target (individual targets: Phase 14) |
| Top product and branch | ✅ quick insights; Best Agent / Hall of Fame / Champion — Phase 19 |
| Audit: duplicate attempts, open cases, cases older than 7 days | ✅ Operations |
| Stock: received, issued, balance and variance by location | ◐ received and issued per device on Operations (owner's cards); balance and variance by location stay on the Stock page (Phase 6 report), linked from Operations |
| Follow-up completion | ⏳ Phase 13 |
| Every figure Submitted or Eligible | ✅ labels + definitions on every view |
| §9.3 filters show period and scope; drill-down; definitions; empty/loading/error; freshness; phone | ✅ (phone layout checked in code — owner test pending) |

**Commands run (3 Nov 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 427 tests (30 new dashboard database tests, 11 dashboard unit tests); build adds `/dashboard/branches`, `/technology`, `/trends`, `/reports`, `/operations`, `/sales` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261103090000_dashboard.sql` and refreshed the new-project file |
| `npm install --save-exact recharts@3.10.1 react-is@19.3.0` | Added; `npm audit` findings are all in the existing `shadcn` CLI dependencies, none from Recharts |

Not yet run: the owner's test on "Outdoor" (the browser pane needs the owner to sign in, and staging needs the SQL first); CI on GitHub (after upload).

**Acceptance gate**

| Criterion | Result |
|---|---|
| Dashboard totals reconcile with hand-checked fixture data | ✅ database tests: this month / last month / overall, revenue, New + Retention, products and cities add up, branches, agents, filters, periods |
| Each eligibility condition proven by a test | ✅ pending / rejected / reversed out; Confirmed issue out; on hold flagged and counted; cutoff 3rd 23:59:59 vs 4th 00:00 EAT; cutoff day from Settings; switches never in sales |
| Scope: no user sees data outside permission | ✅ database tests: agent own, Team Leader team, Finance / Auditor / Super Admin all, Stock Officer refused, inactive and anonymous refused, internal functions not callable, stock and audit figures by permission — owner UI test pending |

**Manual steps for the owner** — `docs/06-operations/dashboard.md`: paste `supabase/sql-editor/20261103090000_dashboard.sql` into **Outdoor** and **Outdoor Training**; rebuild and restart the training site; restart `npm.cmd run dev`; run the tests in section 4.

**Risks / open items**
- City target uses today's people for the current month; a person who joins or leaves mid-month changes the target at once (individual, dated targets come in Phase 14).
- Branch figures under a city may not add up to the city total (a branch is where money is handed in).
- A month total and a date range over the same days can differ slightly (approvals after month end count by the cutoff rule).
- Trends and rankings look thin until sales build up (no old data, D-21).
- Figures are worked out on every page view (no caching); fine at the expected volume (~150 sales/day), to be checked in the Phase 20 load test.

**Next prompt (not executed):**
> Proceed with Phase 11 only: pilot readiness. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 11, run `npm run check`, update the logs, report the gate and stop.

---

## Phase 11 — Pilot readiness

**Date:** 4 Nov 2026 · **Status:** ⛔ **BLOCKED — awaiting D-43** (hosting and the production database). Everything that does not need them is built and tested.

**Owner answers before building (D-43, 4 Nov 2026):** hosting — not decided yet; production database — not decided yet; web address — outdoor.sogasho.com later; support owner — the business owner.

**Scope delivered (Roadmap Phase 11; SDD §19, §26.3; R-10, R-11)**
- Migration `20261104090000_readiness.sql`: `app.readiness_report(city)` — 14 checks (required: products priced, districts, teams, teams with active leader and stock, agents, agents with city and team, Settings values incl. baseline < target, SMS code on, Stock Officer, opening stock received, deliveries accepted, no test data; advice: two Super Admins, every team holds stock); `app.opening_stock_summary()` — per device received, adjustments, Central / teams / faulty, in transit, issued, removed, **difference (must be 0)**; public wrappers (readiness: settings.manage; opening stock: settings.manage or stock.read all).
- App: **Settings → Pilot readiness** (city selector, pass / fail / advice with names of what is missing, opening stock table, server-setting checks that never show values); `GET /api/cron/send-emails` (Bearer `CRON_SECRET`, ≥ 32 characters, constant-time compare) for the 5-minute email sender; `GET /api/health` for uptime monitoring; both excluded from the sign-in proxy. `CRON_SECRET` added to `.env.example`.
- SQL Editor check file `supabase/checks/readiness.sql`.
- Documents: `docs/06-operations/pilot-readiness.md` (checks, opening stock procedure, production database and hosting steps, backups and restore drill, monitoring, go-live sign-off), `docs/06-operations/incident-runbook.md`, `docs/07-training/agent-quick-guide.md`, `docs/07-training/team-leader-guide.md`, `docs/04-quality/pilot-uat.md` (26 scenarios across Phases 3–10).

**Roadmap scope check**

| Item | Result |
|---|---|
| Automated readiness checks (admin page + script) | ✅ page + SQL Editor file (no secret-key script: the SQL Editor runs it with the owner's own access) |
| Production setup by Super Admin (prices, districts, teams, users — R-10) | ✅ checked by the page; ⛔ entry on production waits for the production project |
| Opening stock entered, sent, accepted; reconciliation agrees with the count (R-11) | ✅ reconciliation built and tested; ⛔ on production waits for the project |
| Production environment, secrets, backups + restore drill, monitoring, runbook, support owner | ◐ steps, runbook, health check and support owner done; ⛔ environment, secrets, backups and drill wait for D-43 |
| Scheduled email sender every 5 minutes | ◐ endpoint built and tested; the host's schedule is added with hosting |
| Agent and Team Leader guides | ✅ |
| Pilot UAT across Phases 3–10 | ✅ list ready; ⛔ run on production |

**Commands run (4 Nov 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 440 tests (8 new readiness database tests, 5 new unit tests for the email sender and server-setting checks); build adds `/settings/readiness`, `/api/cron/send-emails`, `/api/health` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261104090000_readiness.sql` and refreshed the new-project file |
| Browser (dev server, signed out) | `/api/health` → 200 `{"status":"ok"}`; `/api/cron/send-emails` with a wrong secret → 401; `/settings/readiness` → redirect to sign-in |

Not yet run: the readiness page on staging (needs the SQL paste and the owner's sign-in); anything on production.

**Acceptance gate (pilot UAT)**

| Criterion | Result |
|---|---|
| All readiness checks pass in production | ⛔ BLOCKED — no production project yet (D-43); checks proven on test data (fail when unprepared, pass when set up) |
| Opening stock reconciles with the Stock Officer's count | ⛔ BLOCKED — reconciliation proven by tests (receive → send → accept → issue keeps difference 0) |
| Restore drill succeeded | ⛔ BLOCKED — needs a paid production project with backups |
| Business owner signs pilot go-live | ⛔ after the above |
| Owner test on the training site (4 Nov 2026) | ✅ SQL pasted on Outdoor and Outdoor Training; Settings → Pilot readiness: all setup checks pass after one agent was added to a team; opening stock reconciles (difference 0 for WiFi Router, PDCOM, CALIX); server settings fail only where expected for a non-production site |

**Owner accepted Phase 11 as built on 4 Nov 2026 (commit 55e3c73, CI green)**; the production items above stay blocked until D-43 is decided.

**Manual steps for the owner now:** paste `supabase/sql-editor/20261104090000_readiness.sql` into **Outdoor** and **Outdoor Training**; rebuild and restart the training site; open **Settings → Pilot readiness** on staging (most checks will fail there — staging holds test data and no Telesom/https settings; that is expected). **When ready:** choose hosting and the production database, then follow `docs/06-operations/pilot-readiness.md` §4–8.

**Risks / open items**
- The pilot cannot start until hosting and a production database exist (D-43).
- Until the host's schedule exists, emails still go out only while someone uses the app.
- Supabase Free (if chosen) has no automatic backups and pauses idle projects — not suitable for real data.
- Creating the first production account means pointing `.env.local` at production briefly; switch it back to staging straight after.

**Next prompt (not executed):** once the gate is passed and the pilot has started —
> Proceed with Phase 12 only: refunds. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 12, run `npm run check`, update the logs, report the gate and stop.
