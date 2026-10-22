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

Phases 1–2 accepted 19 Oct 2026; Phase 3 (sign-in with Telesom OTP) accepted 20 Oct 2026. Phase 4 (users, roles, permissions, teams; SMS code for every user, D-32) accepted 21 Oct 2026: [`docs/06-operations/users.md`](docs/06-operations/users.md). Phase 5 (settings, products and prices) — built, awaiting owner test: [`docs/06-operations/settings.md`](docs/06-operations/settings.md). Sign-in setup: [`docs/06-operations/auth.md`](docs/06-operations/auth.md). Database workflow: [`docs/06-operations/database.md`](docs/06-operations/database.md). See [`docs/03-implementation/PHASE_LOG.md`](docs/03-implementation/PHASE_LOG.md).
