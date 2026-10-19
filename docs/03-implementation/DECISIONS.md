# Decisions log

Business decisions use the BRD IDs (D-xx); technical decisions made during implementation use T-xx.
The BRD (§15) remains the authoritative business register; this file mirrors it for day-to-day work and adds technical decisions.
**Never record secret values here.**

## Business decisions — closed

| ID | Decision | BRD | Closed |
|---|---|---|---|
| D-01 | Customer identity model and duplicate definition | 6.4, 8.1 | v1.1 |
| D-02 | Index Number = customer's service account number; exactly 8 digits (e.g. 50091293) | 6.4, 8.1 | v1.2 |
| D-03 | Phone normalization (E.164, +252) | 6.4 | v1.1 |
| D-04 | Products and prices maintained by Super Admin in Settings | 6.3 | v1.2 |
| D-05 | Permanent staff: incentive only in this module | 6.9 | v1.1 |
| D-06 | Eligible-sale definition and payroll cutoff (3rd of next month) | 8.2 | v1.1 |
| D-07 | Incentive: MAX(0, eligible units − 15) × $5, all products, all agents | 8.1 | v1.1 |
| D-08 | Temporary base salary: flat amount set by Super Admin (currently $100), no pro-rating | 6.9 | v1.2 |
| D-09 | Revenue = amount collected; free-month handling (default $50, 1 unit) | 6.11 | v1.1 |
| D-10 | Stock item spelling is PDCOM | 6.12 | v1.3 |
| D-11 | Stock custody chain Central → Branch → Agent | 6.12 | v1.1 |
| D-12 | Serial tracking for WiFi Router, PDCOM, CALIX | 6.12 | v1.1 |
| D-13 | Audit case states Open → Under Review → Confirmed Issue / False Positive → Resolved | 7.2 | v1.1 |
| D-14 | Retention approver = Team Leader (Super Admin fallback), no self-approval, stock at submission | 6.4 | v1.1 |
| D-15 | Refund effects and timing | 6.5 | v1.1 |
| D-16 | Product switch FTTA ↔ FTTH only, never a sale | 6.10 | v1.1 |
| D-17 | Follow-up in month M+1: Active / Expire / Not Reached | 6.7 | v1.1 |
| D-18 | Leave process, attachments, working days excluding Fridays and holidays | 6.8 | v1.1 |
| D-19 | Best Agent = #1 of month; Hall of Fame = 3 consecutive months; Champion = 4+ | 6.13 | v1.2 |
| D-20 | OTP SMS provider is Telesom; credentials in environment settings only (no in-app page for the pilot) | 6.1, 12 | v1.3 |
| D-21 | No legacy data; system starts fresh | 3.2, 6.17 | v1.2 |
| D-22 | Data access matrix | 4.1 | v1.1 |
| D-23 | Notification channels (in-app + email; SMS only for OTP) | 6.16 | v1.1 |
| D-24 | Localization: EAT (UTC+3), USD 2 decimals, DD/MM/YYYY, English v1, Somali-ready | 11 | v1.1 |
| D-25 | Installable web app (PWA); no native app; no offline data; GPS/photo deferred | 3, 11 | v1.1 |
| D-26 | Exports CSV/XLSX, PDF payroll; every export logged | 6.14 | v1.1 |
| D-28 (part) | Volume: 46 agents (7 permanent, 39 temporary) for 2 years | 11 | v1.3 |
| D-29 | 16 branches seeded; districts per city by Super Admin; Area free text; teams by Super Admin | 6.2, 6.4 | v1.2 |
| D-30 | Sale month from server time (EAT); no backdating; after-midnight → new month; read-only past months; finalized months locked | 6.4, 8.1 | v1.4 |

## Business decisions — open (blocking)

| ID | Input needed | Provisional default | Blocks |
|---|---|---|---|
| D-27 | KoboToolbox form IDs and fields | — | Phase 18 |
| D-28 (part) | Data retention periods | 7 years financial/payroll/audit; 3 years leave attachments after employment ends | Phase 20 |

## Technical decisions

| ID | Date | Decision | Reason |
|---|---|---|---|
| T-01 | 19 Oct 2026 | UI built with **shadcn/ui** (Radix primitives, `radix-nova` style, lucide icons), fully re-themed to the brand kit through CSS variables; light theme only | Owner's choice; accessible components, dashboard/sidebar/table building blocks; components live in the repo so they can be branded completely |
| T-02 | 19 Oct 2026 | **Hosting deferred.** Development runs locally (`npm run dev`). The Phase 1 "staging URL" acceptance item is postponed until a hosting plan is chosen — required before Phase 11 (pilot). Vercel Hobby is not used because it is for non-commercial use | Owner cannot use Vercel Pro yet |
| T-03 | 19 Oct 2026 | **Development database = Supabase project "Outdoor"** (ref `rovaveormshdgvpbehqf`), fake data only. No local Supabase/Docker. A separate production project on a paid plan is created at Phase 11 | Docker not installed; simplest path for the owner. SDD §26.1 listed local Supabase; this replaces it until further notice |
| T-04 | 19 Oct 2026 | **Contrast-driven colour mapping** (all brand-kit colours): primary buttons green-700 `#047B95` (hover green-900); destructive solid orange-700 (hover orange-900); input borders gray-500; status badges approved green-700, refunded gray-700, on hold blue-700 (others as SDD §22.2) | SDD §22.2 draft colours green-500 / gray-500 / orange-500 fail WCAG AA with white or dark text; verified by `tests/unit/brand.test.ts` |
| T-05 | 19 Oct 2026 | **i18n:** minimal typed `t()` helper over `messages/en.json`; no library until a second language is added | Avoid an unneeded dependency (Roadmap rule); keeps all text in message files (D-24) |
| T-06 | 19 Oct 2026 | Stack versions: Next.js 16.4.2 (App Router, Turbopack, Cache Components + Partial Prefetching as scaffolded), React 19.3, Tailwind CSS 4, TypeScript 5 strict, Vitest 5; npm; Node ≥ 20.9 (developed on 24) | Current stable versions at project start |
| T-07 | 19 Oct 2026 | Brand assets: `brand/` is the source. Runtime copies live in `public/brand/` (logos, icons, pattern) and `src/app/fonts/` (Signika WOFF2). `npm run icons` builds `favicon.ico` and a maskable 512 px icon (logo on white) from the brand icons | Next.js serves only from `public/` and bundles fonts via `next/font/local` |
| T-08 | 19 Oct 2026 | PWA: web manifest + service worker caching only static brand assets, registered in production builds only | D-25 (installable, no offline data) |
| T-09 | 19 Oct 2026 | Repository layout: documents moved to `docs/` (BRD → `docs/01-business`, SDD → `docs/02-design`, Roadmap → `docs/03-implementation/ROADMAP.md`, older versions → `docs/archive`); brand kit → `brand/` | Phase 0 structure (SDD §5.3) |
| T-10 | 19 Oct 2026 | **Database tests:** behaviour tests run on PGlite (PostgreSQL 18 in WebAssembly) with a Supabase shim (roles anon/authenticated/service_role, `auth.uid()`/`auth.jwt()`, Supabase default grants) — `tests/db`, part of `npm run test`. CI also applies the migrations to a real Supabase Postgres (`supabase db start`, PG 17) and runs pgTAP checks (`supabase/tests/database`) | No Docker on the owner's computer; tests must run locally and in CI. The real-Supabase job guards against PGlite/Supabase differences |
| T-11 | 19 Oct 2026 | **Staging migrations via CI:** job `migrate-staging` runs `supabase db push` to "Outdoor" after every green push to `main`, only when the owner has added `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (secrets) and `SUPABASE_STAGING_PROJECT_REF` (variable). Production migrations stay manual | SDD §26.2; keeps the database password out of chat and off the owner's command line history |
| T-12 | 19 Oct 2026 | **Database conventions:** private schema `app` for helpers (not exposed by the API); tables in `public` always `revoke all` from anon/authenticated before explicit grants; SECURITY DEFINER functions use `set search_path = ''`; append-only tables protected by grants **and** `app.prevent_change()` triggers (blocks even the owner); writers `app.log_activity()` / `app.record_audit_event()` take the actor from the session. `app.is_active_user()`, `app.has_permission()` and `app.in_scope()` are deny-by-default stubs until Phase 4 | SDD §7.3, §8.1, §11.1 |
| T-13 | 19 Oct 2026 | **Automatic before/after change history on every table:** `change_log` (append-only) filled by the `zz_change_log` trigger (`app.record_change()`), attached with `app.enable_change_log()` to every business table; stores actor, role, table, record key, operation, old/new values, changed columns; optional masked columns. A test fails if any public table (other than the three logs) lacks it | Owner requirement: "everything recorded in the Supabase database", as in the Sogasho stock system's `audit_logs`, extended from sensitive tables to all tables |
| T-14 | 19 Oct 2026 | **Owner applies database changes with the Supabase SQL Editor (copy and paste).** `npm run db:sql-editor` generates `supabase/sql-editor/*.sql` from the migrations: one transaction each, refuses re-runs and out-of-order runs, records itself in `supabase_migrations.schema_migrations`. The GitHub `migrate-staging` job (T-11) remains optional | Owner preference; keeps the database password out of chat and tools while keeping one migration history |
