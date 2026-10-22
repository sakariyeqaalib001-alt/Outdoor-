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

**Date:** 22 Oct 2026 · **Status:** Built — awaiting the owner's test on "Outdoor" (steps in `docs/06-operations/settings.md`).

**Scope delivered (BRD §6.2 FR-USER-04, 09, 10; §6.3 FR-CONF-01, 03, 05, 07 settings; SDD §8.3, §9; D-04, D-08, D-10, D-18, D-29, D-33)**
- Migration `20261022090000_master_data.sql`:
  - New tables: `districts` (per city, unique name per city, no seed), `customer_types` (`new`, `retention`; fixed codes, editable names), `products` (FTTA, FTTH, FTTB, LTE seeded), `product_prices` (USD, optional city, effective from/to; overlap for the same product and city refused by a trigger), `stock_items` (WIFI_ROUTER, PDCOM, CALIX; serialized), `public_holidays`.
  - `app_settings` values seeded: cutoff day 3, incentive threshold 15, rate 5, temporary base salary 100, target 20, baseline 15, free-month 50, prefixes 063/065 and week start Saturday (D-33), weekend Friday (D-18), OTP on (D-32).
  - Writes only through functions that check `settings.manage` (lists, settings) or `prices.manage` (products, prices), validate and log: `admin_set_setting` (known keys only, per-key checks, baseline < target), `admin_save_branch`, `admin_save_district`, `admin_rename_customer_type`, `admin_save_product` (code fixed after creation), `admin_save_price`, `admin_save_stock_item`, `admin_save_holiday`, `admin_delete_holiday`.
  - `public.price_for(product, city, date)`: the city's own price, else the all-cities price, else none (used by sales in Phase 7 for the price snapshot, FR-CONF-03).
  - RLS: every active user reads the lists (forms need them); no direct insert/update/delete for any API role; change history on every new table.
- Screens: **Settings** (General, Branches, Districts, Lists, Public holidays) and **Products** (products + price list with Current / Upcoming / Ended, "No current price" warning). Shared tab bar `src/components/page-tabs.tsx` (Users tabs use it too). Menu items Settings and Products now active (`COMPLETED_PHASE = 5`).
- Owner input **D-33**: customer mobile prefixes 063 and 065; week starts Saturday.

**Not in scope:** applying the prefixes and the price snapshot to sales (Phase 7); targets per agent (Phase 14); other dropdown lists (refund reasons, stock return reasons, leave types) arrive with their modules.

**BRD check**

| Requirement | Result |
|---|---|
| FR-USER-04 customer types and dropdown options | ✅ customer types renamable (codes fixed); module dropdowns arrive with their phases |
| FR-USER-09 branches seeded; add/rename/deactivate | ✅ Settings → Branches |
| FR-USER-10 districts per city; Area not a list | ✅ Settings → Districts; no areas table |
| FR-CONF-01 products and price list (FTTA, FTTH, FTTB, LTE) | ✅ Products screen |
| FR-CONF-03 price stored on each sale | ✅ `price_for` ready; snapshot stored by sales ➡ Phase 7 |
| FR-CONF-05 prices entered by Super Admin, effective dates, optional city; none loaded | ✅ no prices seeded; overlap refused |
| FR-CONF-07 target 20 / baseline 15 set by Super Admin | ✅ Settings → General (baseline must stay below target); bands shown ➡ Phases 10/14 |
| FR-LEAVE-07 weekend days and holidays configurable | ✅ settings + Public holidays (used in Phase 17) |
| FR-SALE-04 allowed prefixes configurable | ✅ setting (063, 065); enforced on sales ➡ Phase 7 |
| SDD §9 deactivated values readable on history, rejected for new records | ✅ active flags; new prices refused for inactive products; sales/stock refuse inactive values ➡ Phases 6–7 |

**Commands run (22 Oct 2026, local)**

| Command | Result |
|---|---|
| `npm run check` (lint, typecheck, tests, build) | Pass — 258 tests (new: 51 master-data database tests, 4 settings-form and date tests); build adds `/settings`, `/settings/branches`, `/settings/districts`, `/settings/lists`, `/settings/holidays`, `/products` |
| `npm run db:sql-editor` | Generated `supabase/sql-editor/20261022090000_master_data.sql` |

Not yet run: the owner's test of the new screens on "Outdoor" (the browser pane cannot sign in — the SMS code goes to the owner's phone); CI on GitHub (after upload).

**Acceptance gate**

| Criterion | Result |
|---|---|
| Admin can maintain all lists; others denied | ✅ database tests: Super Admin allowed; agent, Finance, deactivated Super Admin and anonymous refused for every function; direct table writes refused even for Super Admin; ⏳ owner UI test |
| Price lookup returns the correct effective price for a date/city | ✅ database tests (boundaries, city override, open-ended, gaps, overlaps) |
| Branch seed matches BRD §6.2.1; districts and prices enterable on staging | ✅ test compares the seed with the BRD table; ⏳ owner enters districts and prices on "Outdoor" |

**Manual steps for the owner** — `docs/06-operations/settings.md`: paste `supabase/sql-editor/20261022090000_master_data.sql`; run the tests in section 3.

**Risks / open items**
- Prices and districts must be entered by the business before go-live (D-04, D-29); Phase 11 readiness checks them.
- Turning **SMS code at sign-in** off disables the code for everyone; it is for emergencies only (e.g. SMS outage).

**Next prompt (not executed):**
> Proceed with Phase 6 only: stock ledger, custody and serials. Follow BRD/SDD v1.5 and CLAUDE.md, inspect first, implement only Phase 6, run `npm run check`, update the logs, report the gate and stop.
