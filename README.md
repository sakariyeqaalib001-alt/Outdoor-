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

Phase 1 accepted 19 Oct 2026. Phase 2 (database foundation) — built, awaiting review. Database workflow: [`docs/06-operations/database.md`](docs/06-operations/database.md). See [`docs/03-implementation/PHASE_LOG.md`](docs/03-implementation/PHASE_LOG.md).
