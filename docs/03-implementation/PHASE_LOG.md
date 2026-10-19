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

**Date:** 19 Oct 2026 · **Status:** Built — awaiting owner review. Staging deploy item deferred (T-02).

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
