# Sogasho Outdoor Field Sales & Audit System
## Claude Code Implementation Roadmap v1.4 — Phase 0 to Phase 20

**Technology baseline:** Next.js (TypeScript, installable PWA) + Supabase
**Business baseline:** `Sogasho_Outdoor_Field_Sales_Audit_System_BRD_v1.4.md`
**Design baseline:** `Sogasho_Outdoor_Field_Sales_Audit_System_SDD_v1.4.md`
**Operating cities:** Hargeisa (pilot), Burco, Berbera, Borama
**Delivery method:** Sequential, one phase at a time, with explicit acceptance gates; staging deployed from Phase 1; pilot release after Phase 11; production release after Phase 20.

## Change history

| Version | Date | Summary |
|---|---|---|
| 1.0 | 18 Oct 2026 | Phases 0–19. |
| 1.1 | 19 Oct 2026 | Approved restructure (C-1): Phases 0–20; OTP moved into Authentication; Targets moved after Sales; Audit and Dashboard moved before pilot; new Legacy Import & Pilot Readiness phase; Free-month added to Sales phase; staging + CI from Phase 1; per-phase RLS tests; Phase 0 reads BRD + SDD + Roadmap; blocking inputs listed per phase; pre-Phase-0 readiness checklist added. |
| 1.2 | 19 Oct 2026 | Applied business inputs of 19 Oct 2026: D-02, D-04, D-08, D-19, D-21, D-29 closed. Phase 11 is now Pilot Readiness only (no legacy import). Phase 5 seeds the 16 branches; prices, districts and teams entered by Super Admin; Area free text. Phase 7 enforces 8-digit Index. Phase 14 adds performance bands (target 20 / baseline 15). Phase 16 uses a flat base salary (no pro-rating) and freezes monthly rankings. Phase 19 implements Best Agent / Hall of Fame / Champion streaks. Remaining blocking inputs: D-10, D-20, D-27, D-28. |
| 1.3 | 19 Oct 2026 | D-10 closed (PDCOM), D-20 closed (Telesom), D-28 agent count closed (46 agents). Phases 3 and 5 no longer blocked by decisions; Phase 3 still needs Telesom API credentials (R-6). Phase 20 load test sized at 3× 46 agents. Remaining blocking inputs: D-27 (Phase 18) and D-28 retention periods (Phase 20). Telesom credentials stay in environment settings for the pilot (no in-app SMS page). |
| 1.4 | 19 Oct 2026 | Sales-month control (D-30, Option A) added to Phase 7 (server-set date, no backdating, previous-month draft warning, My Sales month selector with read-only past months) and Phase 16 (finalized-month lock). New UAT-42…46. |

---

## Numbering

Phase 0 through Phase 20 = **21 stages**. Phase 0 sets up the repository and working rules and then builds Phase 1. Phases 1–20 are implementation phases.

Never ask Claude Code to build several phases at once.

## Before Phase 0 — readiness checklist (outside Claude Code)

| # | Item | Owner | Needed for |
|---|---|---|---|
| R-1 | GitHub repository created (private) | IT | Phase 0 |
| R-2 | Supabase: development runs locally (Supabase CLI); **staging created** — project "Outdoor", ref `rovaveormshdgvpbehqf` (region to record); production project (paid plan) created at Phase 11 | IT | Phase 0 / 11 |
| R-3 | Hosting: **Vercel**, existing team "SO LTD" (currently Hobby plan; commercial use requires Pro before the pilot). Vercel project created in Phase 1 by importing the GitHub repository | IT | Phase 1 (Pro by Phase 11) |
| R-4 | Domain: proposed `outdoor.sogasho.com` (production) and `outdoor-staging.sogasho.com` (staging), added in Vercel with DNS records on sogasho.com | IT | Phase 1 / 11 |
| R-5 | Transactional email provider account | IT | Phase 9 |
| R-6 | **Telesom SMS test completed**: Telesom SMS API credentials and sender name obtained; phone + password + OTP tested on Telesom numbers and any other network temporary agents use; delivery rate, latency and cost recorded (provider chosen: Telesom, D-20) | IT | Phase 3 |
| R-7 | Original source PDF placed in `docs/00-source/` | Business owner | Phase 0 |
| R-8 | Branch list supplied (**done**, D-29); stock item spelling PDCOM (**done**, D-10) | — | Phase 5 |
| R-9 | Index Number definition (**done**, D-02: exactly 8 digits) | — | Phase 7 |
| R-10 | Super Admin ready to enter prices, districts, teams and users in Settings before the pilot (D-04, D-29) | Super Admin | Phase 11 |
| R-11 | Stock Officer physical count of opening stock with serial numbers, for entry as receipts (D-21) | Stock Officer | Phase 11 |

The auth/SMS spike (R-6) is throwaway code in a separate scratch folder, not the product repository.

## Non-negotiable implementation rules

1. **Sources of truth:** BRD v1.4 = business requirements; SDD v1.4 = design; this Roadmap = sequence; `DECISIONS.md` = decisions made since. Read them before changing code.
2. **One phase per prompt.** Implement only the requested phase.
3. **Inspect before editing.** Repository, conventions, dependencies, env variable names, database state.
4. **Preserve working code.** No broad rewrites, destructive migrations or unrelated refactors.
5. **Secure by default.** Server-side authorization + Supabase RLS on every exposed table. Every phase tests denied access through the UI *and* directly against the server action/database API.
6. **No secrets in source control.** `.env.example` with placeholders only.
7. **Versioned database changes** via migrations only.
8. **Every phase is tested** (lint, type-check, unit, DB/RLS tests, build, E2E where relevant) and **deployed to staging**. Report actual results; never claim a check passed without running it.
9. **Keep the logs:** `docs/03-implementation/PHASE_LOG.md`, `DECISIONS.md`, and `docs/04-quality/traceability-matrix.md`.
10. **Stop at the phase gate** and wait for explicit approval.
11. **No real customer data** in fixtures, seeds or the repository.
12. **OPEN decisions:** if a phase's blocking input (BRD §15.3) is not recorded in `DECISIONS.md`, build with the provisional default where the SDD allows, but report the gate as **BLOCKED — awaiting D-xx**, never as passed.
13. **Business rules that must stay consistent:**
    - Phone (E.164) and Index Number globally unique across all customers; old values stay reserved (D-01).
    - New sale with existing phone/Index → blocked + durable audit event + Super Admin alert.
    - One active sale per customer per month.
    - Retention requires Team Leader/Supervisor approval; no self-approval (D-14).
    - Refunds require Super Admin approval; finalized payroll is never edited (D-15).
    - Product switch FTTA ↔ FTTH only; never a sale (D-16).
    - Free-month: configurable amount (default $50), revenue = amount collected, 1 unit (D-09).
    - Equipment (WiFi Router, PDCOM, CALIX) is serial-tracked and issued only from the agent's custody (D-11, D-12).
    - Incentive = `MAX(0, eligible units − 15) × $5`, per agent per month, all products (D-07). Temporary base = flat amount from Settings (currently $100), no pro-rating (D-08); permanent base $0 in this module (D-05).
    - Index Number = exactly 8 digits (D-02).
    - Sale month is set by the server clock in EAT; agents never choose, backdate or future-date it; after-midnight submissions count in the new month; past months read-only; finalized months locked (D-30).
    - Performance bands: ≥ 20 Target met, 15–19 Baseline, < 15 Underperforming (configurable).
    - Titles: Best Agent = #1 of month; Hall of Fame = #1 three months running; Champion = #1 four or more months running (D-19).
    - No legacy data import; the system starts fresh (D-21).
    - One shared eligible-sale definition (BRD §8.2) for targets, dashboard, payroll and rankings (D-06).
    - Timezone EAT (UTC+3); currency USD (D-24).

---

# Phase map

| Phase | Name | Main outcome | Blocking inputs |
|---|---|---|---|
| 0 | Repository, environments and phase control | Repo structure, CLAUDE.md, docs in place, Phase 1 started | R-1, R-2, R-7 |
| 1 | Foundation, brand/design system, CI, staging | Runnable branded shell deployed to staging with CI | R-3 |
| 2 | Database foundation + logs | Conventions, RLS helpers, `activity_log`, `audit_events` | — |
| 3 | Authentication + OTP | Email login, phone + password + Telesom OTP, lockout, first-login change | R-6 (Telesom credentials) |
| 4 | Users, roles, permissions, teams | User admin, permission matrix, teams (created by Super Admin), deactivation | — |
| 5 | Master data and settings | Cities, 16 seeded branches, districts, products, prices (entered by Super Admin), stock items, settings incl. base salary and performance bands | — |
| 6 | Stock ledger, custody and serials | Receipt, transfer, acknowledge, return, adjustment, balances | — |
| 7 | Sales registration | New + Retention submission, identity model (8-digit Index), free-month, serial issue, duplicate events, idempotency | — |
| 8 | Retention approval and product switch | Approval workflow, switch transaction, notifications | — |
| 9 | Duplicate detection, audit cases and alerts | Rules, cases, history, email alerts, payroll-hold flag | R-5 |
| 10 | Eligibility service and operational dashboard | Shared eligible-sales function, dashboard | — |
| 11 | Pilot readiness | Settings populated, opening stock received, readiness checks, pilot go-live in Hargeisa | — |
| — | **▶ PILOT RELEASE — Hargeisa** | | |
| 12 | Refunds | Refund request/approval, reversal, returns | — |
| 13 | Customer follow-up | Monthly due list, Active/Expire/Not Reached, overdue | — |
| 14 | Targets, KPIs and performance bands | Target assignment, progress from eligible sales, Target met / Baseline / Underperforming | — |
| 15 | Reports and exports | Report catalogue, CSV/XLSX, export log | — |
| 16 | Payroll and incentives | Runs, lines, flat base, holds, adjustments, snapshots, monthly ranking freeze, PDFs, parallel run | — |
| 17 | Leave management | Requests, approval, entitlements, private attachments | — |
| 18 | KoboToolbox integration | One-way sync, error queue | **D-27** |
| 19 | Performance and recognition | Leaderboard, Best Agent / Hall of Fame / Champion, top product/branch | — |
| 20 | QA, security, UAT, production cutover | Full validation; all-city release | **D-28** (retention periods) |
| — | **▶ PRODUCTION RELEASE — all cities** | | |

---

# Phase 0 — Trigger prompt (paste first in Claude Code)

Run Claude Code from the project root after R-1, R-2 and R-7 are done.

```text
You are the lead engineer for the Sogasho Outdoor Field Sales, Performance Analytics & Audit Control System.

SOURCES OF TRUTH
- Read completely:
  - Sogasho_Outdoor_Field_Sales_Audit_System_BRD_v1.4.md (business requirements)
  - Sogasho_Outdoor_Field_Sales_Audit_System_SDD_v1.4.md (system design)
  - Sogasho_Outdoor_Field_Sales_Audit_System_Claude_Code_Roadmap_v1.4.md (this roadmap)
- If any is missing, search the repository. If still missing, STOP and tell me exactly what is missing.
- Do not invent requirements. OPEN decisions are listed in BRD §15.3.

WORKING MODE
- We build one phase at a time, Phase 1 through Phase 20.
- This is Phase 0: set up, inspect, plan, then implement Phase 1 only.
- Do not implement Phase 2 or later.

PHASE 0 TASKS
1. Inspect the repository: Git status, package manager, framework, existing code, scripts, tests, Supabase setup.
2. Create the documentation structure from SDD §5.3 and move/copy the documents:
   - BRD → docs/01-business/
   - SDD → docs/02-design/
   - Roadmap → docs/03-implementation/ROADMAP.md
   - Source PDF → docs/00-source/ (if provided)
   - Brand kit → brand/ (copy of "Sogasho Brand Asset/sogasho-brand")
3. Create:
   - CLAUDE.md (standing rules: sources of truth, the non-negotiable rules from the roadmap, phase-gate behaviour, commands to run)
   - docs/03-implementation/PHASE_LOG.md
   - docs/03-implementation/DECISIONS.md, pre-filled with BRD §15.2 (closed) and §15.3 (open, with blocking phase)
   - docs/04-quality/traceability-matrix.md from BRD Appendix C
   - .gitignore, .env.example (placeholders only, including TELESOM_USERNAME, TELESOM_PASSWORD, TELESOM_API_KEY, TELESOM_SENDER, TELESOM_API_URL), README.md (setup)
4. Record in DECISIONS.md: D-20 = Telesom (closed). Record the Telesom SMS test result (R-6) if I provide it; otherwise note that Phase 3 needs Telesom API credentials.
5. Implement Phase 1 only (see roadmap).
6. Run lint, type-check, tests and build. Report exact commands and actual results.
7. Review the diff for secrets, unrelated edits and placeholder code.

PHASE 0/1 ACCEPTANCE GATE — report:
A. Repository assessment.
B. Files/folders created and why.
C. Phase 1 scope completed and excluded.
D. Commands run with actual results.
E. Manual setup steps (accounts, env variables, staging deploy).
F. Open decisions and which phases they block.
G. Confirmation no later phase was implemented.
H. The exact prompt for Phase 2 (do not execute it).

STOP after reporting. Wait for my explicit instruction.
```

---

# Phase 1 — Foundation, brand/design system, CI and staging

**Goal:** A clean, branded, runnable shell that deploys to staging automatically.

**Scope**
- Next.js (App Router) + TypeScript strict; package scripts: dev, build, lint, typecheck, test.
- Tailwind with Sogasho tokens; Signika self-hosted; logo, favicon and PWA icons per SDD §22; produce `favicon.ico` and a maskable 512 icon.
- App layout: white top bar with logo, sidebar navigation placeholder, mobile navigation; lowercase titles rule.
- Status badge and button components meeting WCAG AA contrast (SDD §22.2).
- Error, not-found, loading and empty-state conventions.
- i18n structure with `messages/en.json`; date/currency helpers fixed to EAT and USD.
- PWA manifest and app-shell service worker (no data caching).
- GitHub Actions CI: install, lint, typecheck, unit tests, build, secret scan.
- Staging deployment from `main`.
- `.env.example`, README setup.

**Not in scope:** authentication, business tables, any module.

**Acceptance gate**
- Installs and runs locally with documented commands.
- CI green on a pull request.
- Staging URL serves the shell; Lighthouse PWA installable check passes.
- Brand: logo only on white/black; contrast checks pass for text tokens.
- No secrets committed; no later phase started.

**Next prompt:** "Proceed with Phase 2 only: database foundation. Follow BRD/SDD v1.4, inspect first, implement only Phase 2, run checks, deploy to staging, update logs, report the gate and stop."

---

# Phase 2 — Database foundation, activity log and audit event log

**Goal:** The database conventions and cross-cutting tables every later phase relies on.

**Scope**
- Supabase CLI setup for local, staging and production; migration workflow documented.
- Conventions per SDD §8.1 (UUIDs, timestamps, money, statuses, no hard deletes).
- Helper functions: `app.business_month(ts)`, RLS helpers (`app.is_active_user()`, `app.has_permission(key)` stub returning deny until Phase 4, `app.in_scope(...)`).
- `activity_log` and `audit_events` tables, insert-only, with RLS and tests proving UPDATE/DELETE are impossible for application roles.
- `app_settings` table skeleton (values added in Phase 5).
- DB test harness (pgTAP or SQL tests) wired into CI.

**Not in scope:** user, customer, sales or stock tables.

**Acceptance gate**
- Migrations apply cleanly locally and on staging.
- RLS enabled on every created table; denial tests pass.
- Insert-only tables reject updates/deletes.
- No service-role key reachable from the browser.

**Next prompt:** "Proceed with Phase 3 only: authentication with OTP. Use the D-20 decision in DECISIONS.md. Implement only Phase 3, test, deploy to staging, update logs and stop."

---

# Phase 3 — Authentication and OTP

**Goal:** Secure sign-in for both user types (SDD §6).

**Provider:** Telesom (D-20, closed). **Needs:** Telesom API credentials and the OTP option chosen in the SMS test (R-6). Until credentials are available, implement with the `test` SMS adapter and report the gate as **BLOCKED — awaiting Telesom credentials**.

**Scope**
- `user_profiles` table linked to `auth.users`.
- Permanent: email + password.
- Temporary: phone (E.164 normalization) + password, then OTP (Supabase phone MFA or app OTP per spike decision); temporary-agent sessions without OTP limited to the OTP screen.
- SMS adapter interface with `test` and `telesom` implementations.
- Telesom credentials read only from environment settings (SDD §17.1); no SMS configuration screen. The owner sets the real values on staging with `supabase secrets set` or the host's environment settings; Claude Code never asks for, prints or stores the values.
- Lockout: 5 failures → 15 minutes; OTP 5-minute validity; max 3 sends / 15 minutes.
- First-login forced password change (`must_change_password`).
- Protected routes, sign-out, session refresh; generic error messages.
- Security events in `activity_log` (login success/failure, OTP outcome, password change).
- A bootstrap Super Admin created by a documented one-off script (not a seed in production).

**Acceptance gate (UAT-01, 02, 33)**
- Both sign-in flows work on staging (OTP delivered by Telesom to a real test phone).
- Wrong credentials fail generically; lockout and OTP limits enforced.
- Unauthenticated access to protected routes denied.
- First-login change enforced.
- No passwords, OTPs or tokens in logs.

**Next prompt:** "Proceed with Phase 4 only: users, roles, permissions and teams…"

---

# Phase 4 — Users, roles, permissions and teams

**Goal:** Super Admin manages accounts, access and team structure (SDD §7).

**Blocking input:** none (teams are created by Super Admin in Settings, D-29).

**Scope**
- Tables: `roles`, `permissions`, `role_permissions`, `user_roles`, `teams`, `team_members`; seed permission keys and default role mapping (SDD §7.2).
- Real `app.has_permission` and scope helpers.
- Create user (temporary or permanent) with generated temporary password; edit; assign role, city, branch, team, start date.
- Deactivate: profile inactive, auth user banned, sessions revoked, end date set.
- Navigation driven by permissions.
- All changes in `activity_log`.

**Acceptance gate (UAT-14, UAT-16 for users)**
- Allowed/denied tests for every role on user/team actions, via UI and direct API.
- Deactivated user loses access immediately.
- Permission matrix editable by Super Admin only.

**Next prompt:** "Proceed with Phase 5 only: master data and settings…"

---

# Phase 5 — Master data and settings

**Goal:** Configurable reference data for all forms and reports (SDD §9).

**Blocking input:** none (D-10 closed: PDCOM; D-04 and D-29 closed: prices and districts are entered by Super Admin; branches are seeded).

**Scope**
- Cities (seeded 4); branches seeded from `data/master/branches.csv` (16, BRD §6.2.1) with admin UI to add/rename/deactivate; districts per city entered by Super Admin; **no areas table** (Area is free text on the sales form).
- Products FTTA/FTTH/FTTB/LTE seeded; **prices entered by Super Admin** in Settings (none seeded), with effective dates and optional city; no overlapping ranges.
- Customer types New/Retention (fixed codes).
- Stock items WiFi Router, PDCOM, CALIX (serialized; editable display names).
- `app_settings` values (cutoff day 3, threshold 15, rate 5, temp base 100 (flat, editable), performance target 20, performance baseline 15, free-month amount 50, phone prefixes, week start day, weekend days, OTP enabled) and `public_holidays`.
- Deactivated values readable on history, rejected for new records; changes logged.

**Acceptance gate**
- Admin can maintain all lists; others denied.
- Price lookup returns the correct effective price for a date/city (tests).
- Branch seed matches BRD §6.2.1; Super Admin can enter districts and prices on staging.

**Next prompt:** "Proceed with Phase 6 only: stock ledger, custody and serials…"

---

# Phase 6 — Stock ledger, custody and serials

**Goal:** Track every equipment unit from receipt to customer (SDD §12).

**Scope**
- `stock_locations` (central, branch, one per agent), `stock_serials`, `stock_movements` (append-only), `stock_transfers`.
- Receive into Central (bulk scan/paste serials; duplicate serials rejected).
- Transfer Central → Branch → Agent; agent/branch acknowledgement.
- Returns with reason; adjustments requested by Stock Officer and approved by Super Admin.
- Balance and reconciliation report (received, transferred, issued, returned, adjusted, closing) per item/location, with serial-level drill-down.
- Agent "My custody" mobile view.
- Issue operation exposed as an internal function for Phase 7/8 (not wired to a UI yet).

**Acceptance gate (UAT-09 basis)**
- Movements reconcile to balances; serial counts agree with ledger.
- Concurrent transfers/issues of the same serial cannot both succeed (parallel-session test).
- No negative balances; invalid or unauthorized actions rejected.
- Movement history immutable and inspectable.

**Next prompt:** "Proceed with Phase 7 only: sales registration…"

---

# Phase 7 — Sales registration

**Goal:** The canonical sale record with identity control (SDD §10.1, 10.2, 10.6, 11.1).

**Blocking input:** none (D-02 closed: Index Number = exactly 8 digits, e.g. 50091293).

**Scope**
- `customers`, `customer_identifiers` (unique type/value), `sales`, `sale_items`.
- Mobile-first sales form with all BRD fields; district dropdown filtered by city; Area free text; Index Number validated as exactly 8 digits; city default with override only for permitted roles; price from catalog; months paid; free-month option.
- `create_sale` RPC: identity resolution for New and Retention; same-month rule; serial issue from agent custody in the same transaction; New → approved, Retention → pending_approval.
- Durable duplicate-attempt `audit_events` (DUP_PHONE, DUP_INDEX, IDENTITY_CONFLICT, SAME_MONTH, SERIAL_REUSE) that survive rejection.
- Idempotency via `client_request_id`; draft autosave on device.
- **Sales month (D-30):** no date field on the form; `submitted_at` set by the database only; client dates ignored; warning when a previous-month draft is submitted; My Sales month selector (current month default, past months read-only, server rejects writes to past months).
- Agent's "My sales" list and sale detail.
- Super Admin identity change (phone/Index) with reason and history.

**Not in scope:** approval UI, audit case management, notifications by email.

**Acceptance gate (UAT-03, 04, 05, 08, 09, 19, 20, 21, 22, 30, 32, 37, 42, 43, 44, 45)**
- All listed UAT cases pass in automated tests.
- Concurrency tests: two simultaneous New sales with the same phone → exactly one succeeds; one audit event for the other.
- Agent ID taken from session only.
- Free-month sale stored with correct flag, revenue and unit.
- A request carrying a past or future date still records server time; a draft submitted after midnight on the last day of the month counts in the new month.

**Next prompt:** "Proceed with Phase 8 only: retention approval and product switch…"

---

# Phase 8 — Retention approval and product switch

**Goal:** Controlled Retention decisions and product changes (SDD §10.3, 10.4).

**Scope**
- Team Leader approval queue (own team only); Super Admin fallback; no self-approval.
- Approve/reject with reason; `sale_approvals` history; `approved_at`.
- Rejection → "return required" task; return movement for issued serials.
- Product switch form and RPC: FTTA ↔ FTTH only, identity match, new serial issued, old serial returned; never a sale.
- In-app notifications table and bell (Retention awaiting review, rejection, transfer awaiting acknowledgement).

**Acceptance gate (UAT-06, 12, 34, 35, 36)**
- Self-approval and cross-team approval denied (UI and API).
- Switch identity mismatch rejected; same-product switch blocked.
- Switches excluded from sale counts.

**Next prompt:** "Proceed with Phase 9 only: duplicate detection, audit cases and alerts…"

---

# Phase 9 — Duplicate detection, audit cases and alerts

**Goal:** Reviewable investigations without destroying evidence (SDD §11).

**Scope**
- `audit_rules` (with enable flags and thresholds), `audit_cases`, `audit_case_links`, `audit_case_history`.
- Automatic grouping of events into cases; manual case creation.
- Case states Open → Under Review → Confirmed Issue / False Positive → Resolved; only Super Admin or assigned Auditor changes state; notes required.
- Additional rules from SDD §11.2 (disabled by default except POST_APPROVAL_EDIT).
- Email + in-app alerts to Super Admin (email adapter; no phone/Index in email).
- `on_hold` / `confirmed_issue` flags exposed for the eligibility service.

**Acceptance gate (UAT-03 alert part)**
- Events link to source records and explain the rule.
- Cases and history cannot be edited or deleted.
- False-positive path leaves sales unaffected; Confirmed Issue marks them ineligible.
- Email alert received on staging.

**Next prompt:** "Proceed with Phase 10 only: eligibility service and operational dashboard…"

---

# Phase 10 — Eligibility service and operational dashboard

**Goal:** One trusted definition of an eligible sale and a dashboard built on it (SDD §14.1–14.2).

**Scope**
- `app.eligible_sales(month)` and supporting SQL with cutoff logic and hold flag; fixture tests for each rule in BRD §8.2.
- Dashboard: units, units by product, revenue, by city/branch, New vs Retention, monthly trend, duplicate attempts and open cases, stock balances, top product/branch (simple), with Submitted vs Eligible labels.
- Role-scoped views (agent own, Team Leader team, management all).
- Filters: period, city, branch, product, agent.

**Acceptance gate**
- Dashboard totals reconcile with hand-checked fixture data.
- Each eligibility condition proven by a test.
- Scope: no user sees data outside permission.

**Next prompt:** "Proceed with Phase 11 only: pilot readiness…"

---

# Phase 11 — Pilot readiness

**Goal:** Go live in Hargeisa on a fresh system (SDD §19, §26.3). There is **no legacy data import** (D-21).

**Scope**
- Automated readiness checks (admin page + script): every active product has an active price; every Hargeisa agent has a team, branch and custody location; districts exist for Hargeisa; base salary and performance settings set; no test data in production.
- Production setup by Super Admin: prices, Hargeisa districts, teams, users (R-10).
- Opening stock: Stock Officer enters the physical count as receipts with serials, then transfers to branches and agents; reconciliation report agrees with the count (R-11).
- Production environment, secrets, backups + restore drill, monitoring, incident runbook, support owner.
- Agent training material (quick guide for sales form, custody, Index Number entry) and Team Leader guide (Retention approval, spotting returning customers registered as New).
- Pilot UAT across Phases 3–10 workflows.

**Acceptance gate (pilot UAT)**
- All readiness checks pass in production.
- Opening stock reconciles with the Stock Officer's count.
- Restore drill succeeded.
- Business owner signs pilot go-live.

**▶ PILOT RELEASE — Hargeisa.** Run the pilot for an agreed period (recommended ≥ 2 weeks) while Phases 12+ continue. Record pilot defects in PHASE_LOG.md; fix critical ones before Phase 12 continues.

**Next prompt:** "Proceed with Phase 12 only: refunds…"

---

# Phase 12 — Refunds

**Goal:** Controlled, traceable refunds (SDD §10.5).

**Scope**
- `refunds` table (one per sale); request form (agent/Team Leader); reasons with "Other" note; amount ≤ amount collected.
- Super Admin approval/rejection; approval sets sale reversed; links equipment return.
- Payroll effect hook: if the counting month is finalized, create a pending adjustment record (consumed in Phase 16).
- HIGH_REFUND_RATE rule available (disabled by default).

**Acceptance gate (UAT-07, 17)**
- Only Super Admin approves; rejected refunds change nothing.
- Approved refunds remove the sale from eligible sales for unfinalized months.
- Original sale and stock history preserved.

**Next prompt:** "Proceed with Phase 13 only: customer follow-up…"

---

# Phase 13 — Customer follow-up

**Goal:** Second-month follow-up with clear outcomes (SDD §13).

**Scope**
- Monthly job generating `follow_ups` (unique per customer/month), safe to re-run.
- Follow-up team list with minimal fields; outcomes Active / Expire / Not Reached; notes; who/when.
- Overdue (Not Reviewed) list after month end.
- Outcome counts on dashboard; FOLLOWUP_SKEW rule available (disabled).

**Acceptance gate (UAT-13, 24)**
- Job idempotent; outcomes attributable; follow-up users cannot see other fields.

**Next prompt:** "Proceed with Phase 14 only: targets and KPIs…"

---

# Phase 14 — Targets, KPIs and performance bands

**Goal:** Assign targets and show progress and performance bands from eligible sales (SDD §14.5).

**Scope**
- `targets` for agent/team/city, period, KPI (units, revenue, retention units), value.
- Progress: target, achieved (from `app.eligible_sales`), remaining, %.
- **Performance bands** per agent per month: ≥ 20 eligible units Target met; 15–19 Baseline; < 15 Underperforming (values from Settings).
- Agent view of own targets and band; Team Leader team view with band per agent; dashboard widget with count of agents per band and the underperforming list.

**Acceptance gate (UAT-26, 38)**
- Pending, rejected, refunded and Confirmed Issue sales excluded.
- Band boundaries 14 / 15 / 19 / 20 tested; changing the settings changes bands for unfrozen months only.
- Period boundaries and zero targets tested; only Super Admin edits targets and band settings.

**Next prompt:** "Proceed with Phase 15 only: reports and exports…"

---

# Phase 15 — Reports and exports

**Goal:** The BRD §9.2 report catalogue (SDD §14.3).

**Scope**
- Reports: sales performance, customer classification, agent performance, audit and duplicates, refunds, stock reconciliation, follow-up outcome, free-month sales, export log (payroll and leave reports arrive with their phases).
- Filters: city, branch, product, price, agent, status; week, month, quarter, six months, year.
- CSV and XLSX exports, server-generated, with generated-at time and filters; `export_log`.
- Masking of phone/Index by role.

**Acceptance gate (UAT-18, 28)**
- Report totals equal dashboard totals for the same filters.
- Exports respect permissions and are logged.
- Large exports stream without timeouts at 3× the expected volume (46 agents).

**Next prompt:** "Proceed with Phase 16 only: payroll and incentives…"

---

# Phase 16 — Payroll and incentives

**Goal:** Explainable, reproducible payroll (SDD §15).

**Blocking input:** none (D-08 closed: flat base salary from Settings, no pro-rating).

**Scope**
- `payroll_runs`, `payroll_lines`, `payroll_adjustments`, `monthly_rankings`.
- Calculate from `app.eligible_sales(month)`: product units, Grand Total, New/Retention, revenue, base (temporary: full flat amount from Settings, currently $100, if active at any time in the month; permanent $0), incentive `MAX(0, units − 15) × $5`, adjustments, gross.
- Holds (open audit cases) and mismatches block finalization.
- Adjustments for refunds approved after finalization and Confirmed Issues on previously paid sales.
- Finalize with snapshot (including the base-salary amount used); finalized runs immutable.
- **Finalized-month lock (D-30):** database trigger blocks changes to sales, sale items and approvals of a finalized month for every role; corrections only as next-run adjustments. Refunds, follow-ups, audit cases and stock returns remain possible.
- On finalization, write the month's `monthly_rankings` (rank, eligible units/revenue, band, streak, title) — used by Phase 19.
- Drill-down from every figure; exports XLSX, PDF summary, PDF payslips (brand letterhead).
- **Parallel run:** one full month calculated in the system alongside the existing manual payroll; differences explained and signed off by Finance.

**Acceptance gate (UAT-10, 11, 23, 31, 40, 41, 46)**
- Boundary tests: 0, 1, 14, 15, 16, 17, 20, 30 units.
- Cutoff before/after; refund before/after finalization; mid-month start/end still receives full base; changing the base-salary setting leaves finalized runs unchanged.
- `monthly_rankings` written exactly once per finalized month.
- Recalculation reproduces the snapshot.
- Only Finance/Super Admin calculate/finalize; agents see own line only.
- Parallel-run reconciliation signed by Finance.

**Next prompt:** "Proceed with Phase 17 only: leave management…"

---

# Phase 17 — Leave management

**Goal:** Leave requests, approvals and private documents (SDD §16).

**Scope**
- `leave_entitlements`, `leave_requests`, `private_attachments`.
- Agents request (type, dates, reason); working days computed (excluding Fridays and public holidays); entitlement check with override reason.
- Super Admin approve/reject; signed document upload (PDF/JPG/PNG ≤ 5 MB) to private bucket; signed URLs ≤ 5 minutes.
- Leave report.

**Acceptance gate (UAT-25)**
- Invalid date ranges rejected; working-day calculation tested with holidays.
- Attachments never publicly reachable; unauthorized download denied.
- Leave does not change payroll base.

**Next prompt:** "Proceed with Phase 18 only: KoboToolbox integration…"

---

# Phase 18 — KoboToolbox integration

**Goal:** Survey data in the same workspace (SDD §17.2).

**Blocking input:** **D-27** form IDs and field mappings.

**Scope**
- Server-side Kobo adapter; token in env variables.
- Hourly job + Sync now; incremental, paginated; mapping configuration per form.
- `survey_forms`, `survey_submissions` (unique per form/submission), `integration_runs`, error queue.
- Survey insights view (authorized roles).

**Acceptance gate (UAT-15)**
- Tests for success, timeout, malformed data, API errors, re-sync without duplicates.
- Live sync verified on staging against the real form before claiming it works.
- Survey data never modifies customers or sales.

**Next prompt:** "Proceed with Phase 19 only: performance and recognition…"

---

# Phase 19 — Performance and recognition

**Goal:** Fair, explainable recognition (SDD §14.4).

**Blocking input:** none (D-19 closed).

**Scope**
- Monthly leaderboard by eligible units; tie-breaks (revenue, then earliest last-approval time); exclusion of agents with Confirmed Issue that month.
- Titles from frozen `monthly_rankings` (D-19): **Best Agent** = #1 of the month; **Hall of Fame** = Best Agent 3 consecutive months; **Champion** = Best Agent 4 or more consecutive months (replaces Hall of Fame). A month not at #1 resets the streak.
- Current (unfinalized) month shown as a provisional leaderboard.
- Recognition history per agent (titles by month).
- Top product and top branch; city and period filters; metric and period shown on screen.

**Acceptance gate (UAT-27, 39)**
- Rankings match an independent calculation on fixtures; ties deterministic; scope respected.
- Streak fixture: #1 for 1, 3, 4, 5 months then not #1 → Best Agent, Hall of Fame, Champion, Champion, reset.

**Next prompt:** "Proceed with Phase 20 only: QA, security, UAT and production cutover…"

---

# Phase 20 — QA, security review, UAT and production cutover

**Goal:** Validate everything and release to all four cities.

**Blocking input:** **D-28** data retention periods (volume closed: 46 agents).

**Scope**
- Full E2E regression of all BRD workflows (UAT-01…46, excluding retired UAT-29) on staging.
- Security review: RLS per table and role, direct-API bypass tests, storage, secrets, rate limits, logging of sensitive data, security headers, dependency audit; threat model updated.
- Performance/load test at 3× expected volume (≈ 140 agents, ≈ 150 sales/day, month-end burst); p95 < 3 s target.
- Accessibility review (axe + manual) of agent and admin journeys.
- Data retention/archival job per D-28.
- Production checklist: env variables, migrations reviewed, backup + restore drill, monitoring/alerts, incident runbook, support model, rollback guide.
- Cutover plan for Burco, Berbera and Borama: user accounts, districts, teams, opening stock receipts for their branches, training (no legacy import, D-21).
- Fix in-scope defects; log out-of-scope items for Release 2 (GPS/photo evidence, Somali translation, offline mode).

**Acceptance gate**
- All critical UAT cases pass or have documented, business-accepted exceptions.
- No unresolved critical/high security finding without written business acceptance.
- All open decisions in BRD §15.3 closed.
- Business owner approves production go-live.

**Final outputs:** release readiness report; completed traceability matrix; open-defect and accepted-risk register; deployment and rollback guide; known limitations and Release 2 backlog.

**▶ PRODUCTION RELEASE — all cities.**

---

# Phase control template (every phase after Phase 1)

```text
Proceed with Phase [N] only: [PHASE TITLE].

Before coding:
1. Read CLAUDE.md, BRD v1.4, SDD v1.4, ROADMAP.md, PHASE_LOG.md, DECISIONS.md and the relevant code.
2. Confirm the previous phase's gate passed; list dependencies.
3. Check this phase's blocking inputs in DECISIONS.md. If missing, say so and build only with the
   provisional default where the SDD allows; the gate will be reported as BLOCKED.
4. State a short plan and the exact scope you will change.

Implementation:
- Implement only Phase [N]; no later phases, no unrelated refactors.
- Server-side authorization + RLS; denied-access tests via UI and direct API.
- Migrations, tests, documentation, traceability matrix and logs updated.

Before stopping:
- Run lint, type-check, unit, DB/RLS tests, build and relevant E2E; deploy to staging.
- Review the diff for secrets and unrelated changes.
- Report files changed, behaviour, checks with actual results, manual steps, risks, open decisions.
- Map the phase's requirements and UAT IDs to results.
- State: PASSED / FAILED / BLOCKED — awaiting D-xx.
- Give the exact prompt for the next phase; do not execute it.

STOP and wait for my explicit instruction.
```

---

# Recommended working routine

1. Complete the readiness checklist (R-1…R-11) as far as possible.
2. Put the three v1.4 documents, the source PDF and the brand kit in the project folder.
3. Start Claude Code at the repository root and paste the Phase 0 prompt.
4. After each phase: review the diff, open the staging URL, check the reported test output. Do not accept "done" without evidence.
5. Paste the next phase prompt only when satisfied.
6. When an OPEN input arrives, record it in `DECISIONS.md` (and update the BRD if it changes a requirement) before the blocked phase continues.
7. Keep the BRD, SDD, Roadmap, PHASE_LOG and DECISIONS in the repository so any new session can recover the state.

## Open inputs by phase (from BRD §15.3)

| Needed before | Input |
|---|---|
| Phase 18 | D-27 Kobo form IDs/fields (to be provided when this phase is reached) |
| Phase 20 | D-28 data retention periods |

Closed on 19 Oct 2026: D-02 Index Number, D-04 prices via Settings, D-08 flat base salary, D-19 titles, D-21 no legacy data, D-29 branches/districts/teams (v1.2); D-10 PDCOM, D-20 Telesom, D-28 agent count 46 (v1.3). Not a decision but still needed before Phase 3: Telesom API credentials (R-6).

*End of Roadmap v1.4*
