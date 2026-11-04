# Traceability matrix

Requirement groups from BRD v1.5 Appendix C, with build and test status. Update at every phase gate.

Status: **Not started** · **In progress** · **Built** (code done, tests pass) · **Accepted** (owner approved at gate) · **Retired**

| Requirement group | SDD section | Roadmap phase | UAT | Status |
|---|---|---|---|---|
| FR-AUTH-01…09 | 6 | 3 (deactivation: 4) | 01, 02, 14, 33 | Accepted (Phase 3) — UAT-01, 02, 33 passed; FR-AUTH-06 deactivation and D-32 SMS code for staff accepted in Phase 4 (UAT-14, UAT-02 re-test passed) |
| FR-USER-01…10 | 7, 9 | 4 (branches, districts: 5) | 14, 16 | Accepted (Phase 4); FR-USER-04, -09 maintenance and -10 accepted in Phase 5 |
| FR-CONF-01, 03, 05 | 9 | 5 (snapshot on sale: 7) | 18 | Accepted (Phase 5) — products, plans and plan prices (D-34), `plan_price`; FR-CONF-03 snapshot stored by sales in Phase 7 |
| FR-CONF-02, 04, 06, 07 | 14 | 14 (band settings: 5) | 26, 38 | In progress — FR-CONF-07 band settings built (Phase 5); bands per agent shown on the dashboard from eligible sales (Phase 10, D-42); targets in Phase 14 |
| FR-SALE-01…06, 08…22 | 10, 22.4 | 7 (FR-SALE-21 lock: 16) | 03–05, 08, 09, 19–22, 30, 32, 37, 42–46 | Accepted (Phase 7) — FR-SALE-21 lock in Phase 16; FR-SALE-03 tightened in Phase 10 (nobody sells outside own city, D-42) |
| FR-SALE-07 | 10.3 | 8 | 05, 06, 36 | Accepted (Phase 8) — approval with one device by product (D-39); Team Leaders approve own sales (D-40) |
| FR-REF-01…08 | 10.5 | 12 | 07, 17, 23 | Not started |
| FR-AUD-01…03 | 11 | 7 (event log), 9 | 03, 04 | Built (Phase 9) — events grouped into cases, rule explained, Super Admin alerted in-app + email (email sending waits for the account, R-5) — Accepted (Phase 9) |
| FR-AUD-04…08 | 11 | 9 (hold effect: 16) | 31 | Built (Phase 9, D-41) — case states, Super Admin / assigned Auditor only, notes, no edit/delete; hold and ineligible flags exposed (`app.agent_audit_hold`, `app.sale_audit_state`); payroll use in Phase 16 — Accepted (Phase 9); Confirmed issue excluded from eligible sales and on-hold flagged on the dashboard (Phase 10) |
| FR-FUP-01…07 | 13 | 13 | 13, 24 | Not started |
| FR-LEAVE-01…08 | 16 | 17 | 25 | Not started |
| FR-PAY-01…15 | 15 | 16 | 10, 11, 23, 31, 40, 41 | Not started |
| FR-SW-01…06 | 10.4 | 8 | 12, 34 | Accepted (Phase 8, D-38, D-39, D-40) |
| FR-FREE-01…04 | 10.2 | 7 | 19 | Accepted (Phase 7, D-36) |
| FR-STK-01, 02, 04…10 | 12 | 6 | 08, 09, 22 | Accepted (Phase 6) — quantities, stock issued to Outdoor Supervisors with acceptance (D-35) |
| FR-STK-03 | 12 | 8 | 08, 22, 35 | Accepted (Phase 8) — equipment deducted from the team stock at approval |
| FR-PERF-01…04 | 14.4 | 19 | 27, 39 | Not started |
| FR-REP-01…05 | 14 | 10 (dashboard), 15 | 18, 28 | In progress — Phase 10 dashboard built: filters by city, branch, product, agent and period (today, week from Saturday, month, previous month, year to date, custom), drill-down to the sales behind a figure (FR-REP-03), EAT dates (FR-REP-05); exports in Phase 15 |
| FR-KOB-01…05 | 17.2 | 18 | 15 | Not started |
| FR-NOT-01, 03, 05 | 18 | 9 (alerts), 8 (approvals) | 03 | In progress — in-app notifications built (Phase 8); duplicate/case alerts and email in Phase 9 |
| FR-NOT-02, 04 | 17.1 | 3 | 01, 33 | Accepted (Phase 3) — real Telesom SMS confirmed |
| FR-MIG-01…05 | — | Retired (D-21) | — | Retired |

## Non-functional and foundation items

| Item | Source | Phase | Evidence | Status |
|---|---|---|---|---|
| Brand: colours only from brand kit, Signika only, lowercase titles, logo rules | BRD §11 Branding, SDD §22 | 1 | `tests/unit/brand.test.ts`; `/design-system` page | Accepted |
| Accessibility: WCAG 2.1 AA contrast for text and UI components | BRD §11 Usability, SDD §22.2 | 1 (then every phase) | `tests/unit/brand.test.ts` contrast checks | Accepted |
| Localization: EAT time zone, USD, DD/MM/YYYY, translation-ready text | D-24 | 1 | `tests/unit/format.test.ts`; `messages/en.json` | Accepted |
| Installable PWA (manifest, icons, shell-only service worker) | D-25 | 1 | `/manifest.webmanifest`; `public/sw.js` | Accepted |
| CI: lint, type-check, tests, build on every push | Roadmap Phase 1 | 1 | `.github/workflows/ci.yml` | Accepted |
| Staging deployment | Roadmap Phase 1 | 1 → deferred | — | Deferred (T-02) |
| Database foundation: migrations, RLS on every table, deny-by-default helpers | SDD §7.3, §8.1 | 2 | `tests/db/foundation.test.ts`, `supabase/tests/database` | Accepted |
| Insert-only activity log (FR-USER-06, FR-AUTH-07 storage) and audit events (FR-AUD-02 durable event) | SDD §8.1, §11.1, §20 | 2 | `tests/db/foundation.test.ts` | Accepted |
| Automatic before/after change history on every table (FR-SALE-09 change history, BRD §7 tamper-evident trail) | T-13 | 2 | `tests/db/change-log.test.ts` | Accepted |
| Business month in EAT for sale month (D-30) | SDD §8.1 | 2 | `app.business_month` tests | Accepted |
