# Sogasho Outdoor Field Sales & Audit System

Outdoor field sales, performance analytics and audit control for Sogasho ISP (Hargeisa, Burco, Berbera, Borama).

- Requirements: [`docs/01-business`](docs/01-business) · Design: [`docs/02-design`](docs/02-design) · Roadmap and logs: [`docs/03-implementation`](docs/03-implementation)
- Brand kit: [`brand/`](brand)

## Run it locally

Requirements: Node.js 20.9 or newer (24 recommended) and npm.

```bash
npm install
cp .env.example .env.local   # then fill in values yourself — never commit them
npm run dev
```

Open http://localhost:3000. The brand check page is at http://localhost:3000/design-system.

## Checks

```bash
npm run check   # lint + type-check + unit tests + production build
```

The same checks run on GitHub Actions for every push and pull request.

## Status

Phases 1–2 accepted 19 Oct 2026; Phase 3 (sign-in with Telesom OTP) accepted 20 Oct 2026. Phase 4 (users, roles, permissions, teams; SMS code for every user, D-32) accepted 21 Oct 2026: [`docs/06-operations/users.md`](docs/06-operations/users.md). Phase 5 (settings, products, plans and prices) accepted 22 Oct 2026: [`docs/06-operations/settings.md`](docs/06-operations/settings.md). Phase 6 (stock by quantity, issued to Outdoor Supervisors, D-35) accepted 22 Oct 2026: [`docs/06-operations/stock.md`](docs/06-operations/stock.md). Training site (T-24): [`docs/06-operations/training-site.md`](docs/06-operations/training-site.md). Phase 7 (sales registration; every sale waits for approval, D-36/D-37) accepted 25 Oct 2026: [`docs/06-operations/sales.md`](docs/06-operations/sales.md). Phase 8 (approvals with equipment, product switch, notifications, D-38…D-40) accepted 25 Oct 2026: [`docs/06-operations/approvals.md`](docs/06-operations/approvals.md). Phase 9 (duplicate detection, audit cases and alerts, D-41) accepted 28 Oct 2026: [`docs/06-operations/audit.md`](docs/06-operations/audit.md). Phase 10 (eligible-sale rule and dashboard, D-42) accepted 4 Nov 2026: [`docs/06-operations/dashboard.md`](docs/06-operations/dashboard.md). Phase 11 (pilot readiness, D-43) built 4 Nov 2026 — production waits for hosting and database choices: [`docs/06-operations/pilot-readiness.md`](docs/06-operations/pilot-readiness.md), [`incident-runbook.md`](docs/06-operations/incident-runbook.md), guides in [`docs/07-training/`](docs/07-training/). Sign-in setup: [`docs/06-operations/auth.md`](docs/06-operations/auth.md). Database workflow: [`docs/06-operations/database.md`](docs/06-operations/database.md). See [`docs/03-implementation/PHASE_LOG.md`](docs/03-implementation/PHASE_LOG.md).
