# CLAUDE.md — Sogasho Outdoor Field Sales & Audit System

Standing rules for Claude Code in this repository. Read this first in every session.

@AGENTS.md

## Sources of truth (read before changing code)

| Document | Path | Role |
|---|---|---|
| BRD v1.4 | `docs/01-business/Sogasho_Outdoor_Field_Sales_Audit_System_BRD_v1.4.md` | Business requirements (the source of truth) |
| SDD v1.4 | `docs/02-design/Sogasho_Outdoor_Field_Sales_Audit_System_SDD_v1.4.md` | System design |
| Roadmap v1.4 | `docs/03-implementation/ROADMAP.md` | Implementation sequence, Phases 0–20 and acceptance gates |
| Decisions | `docs/03-implementation/DECISIONS.md` | Business (D-xx) and technical (T-xx) decisions made since |
| Phase log | `docs/03-implementation/PHASE_LOG.md` | What each phase delivered, commands run, results |
| Traceability | `docs/04-quality/traceability-matrix.md` | Requirement → phase → UAT status |
| Brand kit | `brand/` | Logos, Signika font, colours. The only source for visual design |

The BRD and SDD mention the roadmap file by its original name (`..._Claude_Code_Roadmap_v1.4.md`); it lives at `docs/03-implementation/ROADMAP.md`. Older versions are in `docs/archive/`.

## Phase discipline

1. **One phase per request.** Implement only the phase the owner explicitly asks for. Never pre-build later phases.
2. **Inspect before editing.** Read the relevant code, the previous phase's gate in `PHASE_LOG.md`, and open decisions.
3. **Do not decide business policy.** Open items are in BRD §15.3 and `DECISIONS.md`. If a phase needs one, build only with the SDD's provisional default and report the gate as **BLOCKED — awaiting D-xx**.
4. **Stop at the gate.** Report files changed, commands run with actual results, manual steps, risks, open decisions, and PASSED / FAILED / BLOCKED. Give the next phase prompt but do not run it.
5. **Never claim a check passed unless you ran it.**

## Non-negotiable rules

- **Security:** server-side authorization on every action **and** Supabase Row Level Security on every exposed table. Hiding a menu item is never a security control. Each phase tests denied access via the UI and via direct server/database calls.
- **Secrets:** never in code, docs, commits, logs or chat. Real values live only in `.env.local` (ignored) or host/Supabase environment settings. `.env.example` holds names only. Never ask the owner to paste a secret; never print one.
- **Database:** every change is a new versioned migration in `supabase/migrations/` (never edit an applied one). No manual dashboard edits. Follow `docs/06-operations/database.md` and T-12: helpers in private schema `app`; every `public` table gets RLS, `revoke all` from anon/authenticated, explicit grants and policies; SECURITY DEFINER functions set `search_path = ''`; append-only tables use `app.prevent_change()` triggers; write activity/audit rows only via `app.log_activity()` / `app.record_audit_event()`. Every new table needs `select app.enable_change_log('public.<table>')` (automatic before/after history, T-13) and tests in `tests/db/` (PGlite) proving allowed and denied access. After any migration change run `npm run db:sql-editor`: the owner applies database changes by pasting `supabase/sql-editor/` files into the Supabase SQL Editor (T-14) — tell them which files to paste at each phase gate.
- **Data:** no real customer data in fixtures, seeds or the repository.
- **Business rules that must stay consistent** (BRD §8): phone (E.164) and 8-digit Index Number globally unique; New sale with existing phone/Index blocked + durable audit event; one active sale per customer per month; Retention needs Team Leader approval, no self-approval; refunds need Super Admin approval; product switch FTTA↔FTTH only and never a sale; PDCOM/WiFi Router/CALIX serial-tracked from agent custody; incentive `MAX(0, eligible units − 15) × $5`; flat temporary base salary from Settings; one shared eligible-sale definition; sale month set by server time in EAT — never by the user (D-30); finalized months locked.

## Brand and UI rules (SDD §22)

- **Only** brand-kit colours, defined once in `src/lib/brand.ts` and mirrored in `src/app/globals.css`. `tests/unit/brand.test.ts` fails on any other colour or a contrast failure.
- **Signika** only (self-hosted from `src/app/fonts`). Page and section titles are semibold and **lowercase** (`h1`–`h3` or `.brand-title`); never lowercase data, names, buttons or labels.
- Logo only on **white or black**, via `BrandLogo` (keeps clear space and 30 px minimum). Never stretch or recolour.
- **Light theme only.** No dark mode.
- UI built with **shadcn/ui** (Radix, `components.json`), themed through CSS variables. Inspiration images guide layout only.
- Primary buttons use green-700 `#047B95` (white text passes AA); green-500 `#0095A9` is for highlights, focus rings and charts, never small text.
- All UI text in `messages/en.json` through `t()` (`src/lib/i18n.ts`).

## Stack and commands

Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui, Vitest. Node ≥ 20.9 (developed on 24). Package manager: **npm**.

| Command | Purpose |
|---|---|
| `npm run dev` | Local app at http://localhost:3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run test` | Unit tests + database tests (Vitest; database tests run all migrations on PGlite) |
| `npm run build` | Production build |
| `npm run check` | All of the above, in order — run before every phase gate |
| `npm run db:sql-editor` | Regenerate the SQL Editor paste files in `supabase/sql-editor/` from the migrations |
| `npm run icons` | Regenerate favicon and maskable icon from the brand kit |

Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using an API you are unsure of.

## Environments (current)

- **Local:** app on the owner's computer (`npm run dev`); no Docker.
- **Database:** Supabase project "Outdoor" (staging, fake data only) — used for development until a production project is created at Phase 11.
- **Hosting:** deferred (Vercel Hobby cannot be used commercially). Staging deploy steps in Phase 1 are postponed — see T-02.
