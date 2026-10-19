# Sogasho Outdoor Field Sales & Audit System
## Claude Code Implementation Roadmap — Phase 0 to Phase 19

**Technology baseline:** Next.js + Supabase  
**Business baseline:** `Sogasho_Outdoor_Field_Sales_Audit_System_BRD.md`  
**Operating cities:** Hargeisa, Burco, Berbera, Borama  
**Delivery method:** Sequential, one phase at a time, with explicit acceptance gates.

---

## Important numbering clarification

If the roadmap is numbered **Phase 0 through Phase 19**, that is **20 numbered stages** in total. Phase 0 is the orchestration/trigger stage: it tells Claude Code how to inspect the BRD, establish the rules of engagement, and begin Phase 1. Phases 1–19 are the implementation phases.

Do **not** ask Claude Code to build all phases at once. Complete one phase, run its checks, review the result, and only then issue the next phase prompt.

## Non-negotiable implementation rules

1. **The BRD is the source of truth.** Read the full BRD before changing code. Do not silently invent business policy. Identify ambiguities and ask before implementing a decision that materially changes business behavior.
2. **One phase per prompt.** Implement only the phase explicitly requested. Do not start later phases “for convenience.”
3. **Inspect before editing.** Examine the repository, existing conventions, installed dependencies, environment variable names, database setup, and current implementation before making changes.
4. **Preserve existing working code.** Avoid broad rewrites, destructive migrations, and unrelated refactoring.
5. **Secure by default.** Enforce authorization on the server and in Supabase Row Level Security (RLS), not only by hiding UI elements.
6. **No secrets in source control.** Use environment variables and provide an `.env.example` with placeholders only. Never print or commit real keys.
7. **Database changes must be versioned.** Use migration files and document how to apply them. Do not rely on undocumented manual dashboard edits.
8. **Every phase must be testable.** Add appropriate tests, run lint/type-check/build or equivalent checks available in the repo, and report actual results. Never claim a check passed unless it was run.
9. **Keep an implementation log.** Maintain `docs/implementation/ROADMAP.md` (or update this roadmap) and `docs/implementation/PHASE_LOG.md` with phase status, files changed, commands run, results, decisions, and known issues.
10. **Stop at the phase gate.** At the end of each phase, summarize what is complete, what is not complete, test results, any manual steps, and the exact prompt to use next. Then stop and wait for approval.
11. **Do not use fake production data.** Seed only clearly identified development/demo data. Never use real customer data in fixtures.
12. **Business rules already specified in the BRD must remain consistent.** In particular:
    - Customer phone number and Index Number must not be duplicated across valid customer/sales records, according to the approved data model.
    - Retention sales require Team Leader/Supervisor approval.
    - Refunds require Super Admin approval.
    - Incentive is **$5 for each eligible sale above 15 monthly sales**; the first 15 earn no incentive. Formula: `MAX(0, eligible monthly sales - 15) × $5`.
    - Do not count unapproved, duplicate, refunded, or otherwise ineligible records toward payroll unless the BRD/business owner explicitly approves the rule.
    - Do not silently resolve the BRD's terminology differences for inventory items (for example, BDCOM/PDCOM); flag them for confirmation and use a configurable or consistently named representation only after documenting the decision.

---

# Phase map

| Phase | Name | Main outcome |
|---|---|---|
| 0 | Trigger, repository assessment, and phase control | Establish working rules and initiate Phase 1 only |
| 1 | Project foundation and application shell | Runnable Next.js app, conventions, layout, quality scripts |
| 2 | Supabase database foundation | Versioned schema, migrations, RLS design baseline |
| 3 | Authentication and session handling | Temporary-agent phone login and permanent-user email login design/flows |
| 4 | User, role, and permission administration | Super Admin user management and role-based access |
| 5 | Master data and system settings | Cities, branches, districts, products, prices, types, stock item catalog |
| 6 | Targets and KPI assignment | Assign and track individual/team targets |
| 7 | Stock receiving and accountability | Receive, issue, balance, and reconcile stock |
| 8 | Sales registration and validation | New-sale entry, customer identity uniqueness, sale lifecycle foundation |
| 9 | Retention approvals and product switches | Controlled retention workflow and product-change records |
| 10 | Refund requests and approval | Refund request, Super Admin decision, traceability |
| 11 | Customer follow-up and Active/Expire status | Second-month follow-up workflow and status tracking |
| 12 | Duplicate detection, audit cases, and alerts | Detect suspicious records and provide reviewable audit evidence |
| 13 | Dashboard and operational analytics | Overall, monthly, product, city, and New/Retention views |
| 14 | Reports, filters, and exports | Agent/city/product/price/branch/time-period reporting |
| 15 | Payroll, reconciliation, and incentives | Calculate units, revenue, base pay, eligible incentives, gross pay |
| 16 | Leave management | Leave requests, Super Admin approval, attachments, history |
| 17 | OTP and KoboToolbox integrations | Configured integration boundaries, error handling, test mode |
| 18 | Agent performance and recognition | Leaderboards, top product/branch, Champion/Hall of Fame/Top Sales |
| 19 | End-to-end QA, security review, UAT, and deployment readiness | Integrated system validated and documented for release |

---

# Phase 0 — Trigger prompt (use this first in Claude Code)

Copy and paste the following prompt into Claude Code from the project root. Attach or place the BRD in the repository at the path shown, and save this roadmap as `docs/implementation/ROADMAP.md` if it is not already there.

```text
You are the lead engineer for the Sogasho Outdoor Field Sales, Performance Analytics & Audit Control System.

SOURCE OF TRUTH
- Read the entire `Sogasho_Outdoor_Field_Sales_Audit_System_BRD.md`.
- Read `docs/implementation/ROADMAP.md` if it exists.
- The BRD is the business source of truth. This roadmap controls implementation order.
- If either document is missing, search the repository for the matching file. If it cannot be found, STOP and tell me exactly what is missing. Do not invent requirements.

WORKING MODE
- We are building this product one phase at a time, from Phase 1 through Phase 19.
- This is Phase 0: setup, inspect, plan, and initiate Phase 1 only.
- Do not implement Phases 2–19 now.
- Do not create all modules, tables, pages, or workflows in advance.
- Do not replace the repository or perform a broad rewrite.

PHASE 0 TASKS
1. Inspect the repository structure, Git status, package manager, framework version, existing code, tests, lint/type-check/build commands, database configuration, and existing Supabase setup.
2. Read the BRD fully and extract the business requirements relevant to Phase 1 and its dependencies.
3. Compare the repository with the roadmap. Identify what already exists and what must be added for Phase 1.
4. Create or update:
   - `docs/implementation/ROADMAP.md`
   - `docs/implementation/PHASE_LOG.md`
   - `docs/implementation/DECISIONS.md`
   Keep the roadmap's Phase 0–19 sequence. Do not mark work complete unless verified.
5. Record any material ambiguity in DECISIONS.md. Do not silently decide unresolved business rules.
6. Implement Phase 1 only: project foundation and application shell, according to the roadmap. If the project already has a sound foundation, preserve it and make only the missing Phase 1 changes.
7. Use the existing stack and conventions where practical. Do not add a dependency unless there is a clear need; explain new dependencies.
8. Add or update the minimum appropriate automated checks for Phase 1.
9. Run the checks that are available: lint, type-check, tests, and build. Report the exact commands and actual outcomes.
10. Review the diff for accidental secrets, unrelated edits, unsafe defaults, and unfinished placeholder code.

ENGINEERING RULES
- TypeScript strictness and clear component/module boundaries are preferred.
- Keep secrets out of source control. Use `.env.example` with placeholder values only.
- Do not claim authentication, authorization, RLS, integrations, or business workflows are implemented unless they truly are.
- Do not use real customer data.
- Keep accessibility, responsive behavior, and useful loading/error/empty states in mind.
- Do not build a mock feature and describe it as production-ready.
- Preserve a clear distinction between confirmed BRD requirements and recommended implementation controls.

PHASE 1 ACCEPTANCE GATE
Before stopping, provide:
A. Repository assessment.
B. Phase 1 scope completed and explicitly excluded scope.
C. Files created/changed and why.
D. Commands run with actual pass/fail results.
E. Any manual setup steps required.
F. Risks, blockers, and unresolved decisions.
G. Confirmation that no later phase was implemented.
H. A suggested exact prompt for Phase 2, but do not execute it.

STOP RULE
After completing Phase 1 and reporting the acceptance gate, STOP. Do not continue to Phase 2 until I explicitly ask you to.
```

---

# Phase 1 — Project foundation and application shell

**Goal:** Establish a clean, runnable foundation without implementing business modules.

**Scope**
- Inspect and preserve existing app conventions.
- Set up or verify the Next.js application structure, TypeScript, styling system, linting, and package scripts.
- Create the shared application layout and navigation shell only to the extent useful for later phases.
- Add a consistent page title/metadata pattern, basic responsive layout, and reusable UI foundations.
- Add basic error/not-found handling and loading/empty-state conventions where appropriate.
- Add `.env.example` placeholders and concise local setup documentation.
- Add implementation documentation and a phase log.

**Not in scope:** real authentication, Supabase business tables, sales, inventory, payroll, leave, or production integrations.

**Acceptance gate**
- The app installs using the documented package manager.
- Development server starts.
- Lint, type-check, tests, and production build pass where configured.
- No secrets are committed.
- The codebase remains runnable and no later phase has been started.

**Next prompt:** “Proceed with Phase 2 only: Supabase database foundation. Follow the BRD and roadmap, inspect the current implementation first, implement only Phase 2, run its checks, update the phase log, report the acceptance gate, and stop.”

---

# Phase 2 — Supabase database foundation

**Goal:** Create the versioned database foundation required by later modules.

**Scope**
- Verify the intended Supabase project/configuration approach.
- Define database conventions, migration workflow, primary keys, timestamps, audit fields, foreign keys, indexes, and constraints.
- Create only foundational schema elements needed for the approved roadmap and authentication/authorization model.
- Document the intended RLS strategy; implement policies for any tables created in this phase.
- Add safe local/development setup instructions and clearly labelled non-production seed data only if needed.

**Acceptance gate**
- Migrations apply cleanly in the documented environment.
- Constraints and indexes are verified.
- RLS is not accidentally left open on exposed tables.
- No service-role secret is exposed to the browser.
- Later business-module tables are not prematurely built.

**Next prompt:** “Proceed with Phase 3 only: authentication and session handling. Inspect Phase 2 and the BRD first; implement only the approved login flows and session handling, test them, update the phase log, and stop.”

---

# Phase 3 — Authentication and session handling

**Goal:** Establish secure sign-in and sign-out behavior for the two user types specified in the BRD.

**Scope**
- Temporary agents: phone number + password, with an approved secure implementation strategy.
- Permanent users: email + password.
- Session handling, protected routes, sign-out, and first-login password-change flow where supported by the chosen authentication design.
- Temporary-agent OTP integration should use an adapter/interface until Phase 17; do not pretend an SMS provider is connected.
- Friendly validation and error states without leaking whether sensitive accounts exist.

**Acceptance gate**
- Valid users can sign in using the appropriate flow.
- Invalid credentials fail safely.
- Protected routes cannot be accessed without a valid session.
- First-login password-change behavior is tested if enabled in this phase.
- No credentials or tokens are logged or stored insecurely.

**Next prompt:** “Proceed with Phase 4 only: user, role, and permission administration. Follow the BRD, preserve secure server-side authorization and RLS, test each role boundary, update the phase log, and stop.”

---

# Phase 4 — User, role, and permission administration

**Goal:** Let authorized Super Admin users manage accounts and access.

**Scope**
- Create, activate, disable, and maintain users.
- Generate a temporary password or secure invitation flow as supported by the chosen authentication architecture.
- Assign role, employment category, city, branch, and other approved user attributes.
- Implement role/permission definitions and server-side enforcement.
- Allow Super Admin to control which modules/menu items roles can see, while ensuring hiding a menu is never the only security control.
- Record administrative changes where practical.

**Acceptance gate**
- Super Admin can manage users within approved permissions.
- Unauthorized roles cannot invoke restricted actions directly.
- Disabled users lose access according to the agreed session policy.
- Temporary/permanent login types are represented consistently.
- Tests cover allowed and denied role actions.

**Next prompt:** “Proceed with Phase 5 only: master data and system settings. Build the configurable cities, branches, districts, products, prices, customer types, and stock-item catalog grounded in the BRD. Record unresolved terminology such as BDCOM/PDCOM instead of silently changing it. Test and stop.”

---

# Phase 5 — Master data and system settings

**Goal:** Centralize the configurable values used by forms, reports, and workflows.

**Scope**
- Cities: Hargeisa, Burco, Berbera, Borama.
- Branches and districts/areas.
- Products and prices.
- Customer types: New and Retention.
- Stock item catalog: WiFi Router, CALIX, and the BRD's BDCOM/PDCOM terminology pending business confirmation.
- Controlled dropdowns and active/inactive status for master data.
- Validate references so historical records are not silently broken when a value is deactivated.

**Acceptance gate**
- Authorized admins can maintain master data.
- Forms use configured values rather than duplicated hard-coded lists where appropriate.
- Existing historical records remain readable after deactivation.
- Invalid/inactive values are rejected for new records.
- Key changes are auditable.

**Next prompt:** “Proceed with Phase 6 only: targets and KPI assignment. Implement target assignment and progress tracking from the BRD, including role/city/period context where supported. Do not build the full dashboard yet. Test and stop.”

---

# Phase 6 — Targets and KPI assignment

**Goal:** Allow management to assign targets and compare progress with verified performance.

**Scope**
- Create and assign targets to an agent/team/city for a defined period.
- Validate target periods and ownership.
- Display target, achieved, and remaining amounts using eligible sales only.
- Keep target data distinct from actual sales records.
- Apply authorization to target creation and changes.

**Acceptance gate**
- Target assignments can be created, viewed, and updated by authorized roles.
- Progress calculations are reproducible from source records.
- Unauthorized users cannot alter targets.
- Period-boundary and zero-target cases are tested.

**Next prompt:** “Proceed with Phase 7 only: stock receiving and accountability. Implement stock receipt from Stock Officer and traceable stock movements/balances for the approved item catalog. Do not yet wire all sales workflows. Test and stop.”

---

# Phase 7 — Stock receiving and accountability

**Goal:** Track received stock, stock issued to customers, and remaining balances.

**Scope**
- Record stock receipts from the Stock Officer.
- Record item, quantity, receiving/issuing user, date, branch/location, and reference.
- Maintain an auditable stock movement ledger.
- Calculate balances from movements; prevent negative stock unless a formally approved exception exists.
- Support stock reporting: received, issued, and remaining balance.
- Do not allow silent edits that destroy the stock history.

**Acceptance gate**
- Receipts increase stock balances correctly.
- Test movements reconcile to opening + received − issued.
- Invalid quantities and unauthorized actions are rejected.
- Concurrent updates do not cause incorrect balances.
- Stock movement history can be inspected.

**Next prompt:** “Proceed with Phase 8 only: sales registration and validation. Implement the New-sale registration flow and core uniqueness/validation controls from the BRD. Do not add retention approval, payroll, or the audit engine beyond the basic validations required for this phase. Test and stop.”

---

# Phase 8 — Sales registration and validation

**Goal:** Capture new field sales consistently and create the canonical sales record used by downstream modules.

**Scope**
- Capture the BRD fields: customer name, phone, Index Number, district, area, city (default from agent location), product, price, branch, stock given, and customer type.
- Implement customer phone and Index Number duplicate prevention at the database level as well as in the UI.
- Bind submitted sales to the authenticated agent and timestamps.
- Validate product/price/branch/city relationships.
- Record stock issuance in a transaction-safe manner when stock is issued as part of the sale.
- Use explicit sale statuses so later approvals/audits can be added without rewriting the record model.

**Acceptance gate**
- A valid New sale can be submitted and viewed by authorized roles.
- Duplicate phone/Index attempts are rejected and handled clearly.
- Invalid/inactive master data is rejected.
- Stock cannot be deducted twice on retries.
- Sales are attributable to the authenticated agent; client-supplied agent IDs cannot be trusted.

**Next prompt:** “Proceed with Phase 9 only: retention approvals and product switches. Implement the Retention approval workflow and FTTA/FTTH product-switch records from the BRD, ensuring customer identity fields match. Do not implement refunds or payroll. Test and stop.”

---

# Phase 9 — Retention approvals and product switches

**Goal:** Control retention registrations and capture product changes.

**Scope**
- Retention sale submission and Team Leader/Supervisor approval or rejection.
- Record reviewer, timestamp, decision, and reason.
- Ensure pending/rejected retention records are clearly distinguished from approved records.
- Product-switch form: customer name, phone, Index Number, branch, city, From Product and To Product (FTTA/FTTH), and stock issued (WiFi Router, BDCOM/PDCOM, CALIX as confirmed).
- Validate that identity fields correspond to the existing customer record.
- Keep product switches distinct from new sales to avoid double-counting.

**Acceptance gate**
- Retention cannot become approved without an authorized reviewer.
- Agents cannot approve their own retention record unless explicitly allowed by an approved policy.
- Approval/rejection history is preserved.
- Product switches validate customer identity and inventory effects.
- Reports can distinguish New, Retention, and Product Switch records.

**Next prompt:** “Proceed with Phase 10 only: refund requests and approval. Implement refund submission and Super Admin approval, the BRD reason options, amount validation, and audit history. Ensure refunds do not silently delete sales or stock movements. Test and stop.”

---

# Phase 10 — Refund requests and approval

**Goal:** Make refunds controlled, traceable, and reviewable.

**Scope**
- Capture customer name, phone, Index Number, purchased product, refund amount, reason, and branch.
- Reasons: Out of boundary, technical delay, refused, no signal, other.
- Require Super Admin approval.
- Record submitter, reviewer, decision, timestamp, and reason.
- Preserve the original sale and create a linked refund/adjustment record.
- Define and test how approved refunds affect revenue and payroll eligibility according to confirmed policy.

**Acceptance gate**
- A refund cannot be finalized without Super Admin approval.
- Amount and customer/sale references are validated.
- Rejected refunds do not change financial totals.
- Approved refunds create traceable adjustments rather than deleting history.
- Authorization and audit tests pass.

**Next prompt:** “Proceed with Phase 11 only: customer follow-up and Active/Expire status. Implement the second-month follow-up workflow for first-month registrations and the required customer/status fields. Keep follow-up outcomes separate from sale approval. Test and stop.”

---

# Phase 11 — Customer follow-up and Active/Expire status

**Goal:** Support follow-up in the month after registration and track customer status.

**Scope**
- Identify customers registered in the first month for follow-up in the second month.
- Show customer name, Index Number, phone, branch, city, and New/Retention type.
- Capture Active/Expire status and follow-up metadata.
- Avoid creating duplicate follow-up tasks when jobs are retried or a page is refreshed.
- Provide controlled access for the Follow-up Team and relevant managers.

**Acceptance gate**
- Follow-up population is derived consistently from registration date.
- Follow-up records are unique for the intended customer/period.
- Active/Expire updates are timestamped and attributable.
- Missing or conflicting customer data is surfaced for review.

**Next prompt:** “Proceed with Phase 12 only: duplicate detection, audit cases, and alerts. Build a reviewable audit workflow for duplicate and suspicious records based on the BRD. Do not auto-label an allegation as proven fraud. Test false-positive handling and stop.”

---

# Phase 12 — Duplicate detection, audit cases, and alerts

**Goal:** Detect and investigate possible duplicate or suspicious sales without destroying evidence.

**Scope**
- Detect duplicate phone numbers and Index Numbers.
- Identify repeated or suspicious sales patterns and cross-agent use of identifiers where the available data supports it.
- Notify Super Admin of configured duplicate/audit flags.
- Maintain an audit case or flag record with reason, linked records, status, reviewer, notes, and resolution.
- Distinguish automated flags from human findings; support false-positive resolution.
- Restrict access to sensitive customer and investigation details.

**Acceptance gate**
- Duplicate constraints prevent invalid records while audit views can explain the conflict.
- Flagged cases link to source records and explain why they were flagged.
- Only authorized roles can review/resolve cases.
- A flag alone does not automatically assert fraud or modify payroll without an approved rule.
- Audit history is retained.

**Next prompt:** “Proceed with Phase 13 only: dashboard and operational analytics. Build dashboard views for units sold, product, revenue, city, New/Retention, overall totals, and monthly totals using the correct eligibility rules. Do not build the full report/export center yet. Test calculations and stop.”

---

# Phase 13 — Dashboard and operational analytics

**Goal:** Provide a trusted operational snapshot based on source records.

**Scope**
- Overall and monthly units sold.
- Breakdown by product, city, New/Retention, and revenue.
- Role-appropriate views for Super Admin and relevant operational roles.
- Date filters and clear definitions of each metric.
- Loading, empty, error, and permission-denied states.
- Ensure the same eligibility rules are used consistently across dashboard metrics.

**Acceptance gate**
- Dashboard totals reconcile with verified underlying records.
- Date and city filters work correctly.
- Unauthorized users cannot access data outside their permissions.
- The UI labels pending/approved/flagged records accurately.

**Next prompt:** “Proceed with Phase 14 only: reports, filters, and exports. Implement reporting by city, product, price, agent, branch, week, month, quarter, six months, and year, plus Active/Expire by New/Retention. Test filters and totals, update documentation, and stop.”

---

# Phase 14 — Reports, filters, and exports

**Goal:** Provide consistent management and operational reports.

**Scope**
- Reports by city, product, price, agent, branch, and time period: week, month, quarter, six months, and year.
- Active versus Expire by New/Retention.
- Appropriate date range, city, branch, agent, product, and status filters.
- Export only formats actually implemented and safely supported by the project.
- Respect authorization and avoid exposing unnecessary personal data.
- Include generated-at time and applied filters on exported reports.

**Acceptance gate**
- Filtered results match the underlying records.
- Totals reconcile with dashboard figures for equivalent filters.
- Exported content matches the current filters and access rights.
- Large reports are handled without avoidable timeouts.

**Next prompt:** “Proceed with Phase 15 only: payroll, reconciliation, and incentives. Implement payroll calculations from approved eligible records, including the $100 temporary-agent base salary and the confirmed $5 incentive per eligible monthly sale above 15. First 15 sales earn $0 incentive. Test threshold boundaries and reconciliation, then stop.”

---

# Phase 15 — Payroll, reconciliation, and incentives

**Goal:** Generate explainable payroll calculations from eligible sales and approved policy.

**Scope**
- Payroll period/month, agent, city, FTTA/FTTH/FTTB/LTE units, New and Retention counts, revenue, incentive, base salary, and gross pay.
- Select counts from system records rather than allowing users to type inconsistent totals.
- Temporary-agent base salary: $100, as specified in the BRD.
- Permanent staff: incentive only, as specified in the BRD.
- Incentive: **$5 for each eligible sale above 15 in the monthly period**.
- Formula: `MAX(0, eligible monthly sales - 15) × $5`.
- Threshold examples:
  - 14 eligible sales → $0 incentive
  - 15 eligible sales → $0 incentive
  - 16 eligible sales → $5 incentive
  - 20 eligible sales → $25 incentive
  - 25 eligible sales → $50 incentive
  - 30 eligible sales → $75 incentive
- Gross pay = base salary + incentive, using the appropriate employment category.
- Reconcile New + Retention counts to the total as required by the BRD, and flag mismatches instead of silently adjusting data.
- Preserve payroll snapshots or calculation details so a reviewer can explain a past payroll result.

**Acceptance gate**
- Threshold boundary tests pass.
- Counts and revenue reconcile with the underlying eligible sales.
- Pending retention, duplicate records, refunds, and audit flags follow a documented, approved eligibility policy.
- Payroll is reproducible and changes are traceable.
- Only authorized users can view or finalize payroll.

**Next prompt:** “Proceed with Phase 16 only: leave management. Implement annual leave assignment, employee leave requests, Super Admin approval, leave type/date range/days/reason, signed attachment support, and history. Validate file access and permissions. Test and stop.”

---

# Phase 16 — Leave management

**Goal:** Manage employee leave requests and approvals.

**Scope**
- Employee name and department (Outdoor default).
- Start/end date, number of days, reason, and leave type: Annual, Sick, Maternity.
- Employee request and Super Admin approval.
- Super Admin assignment of annual leave where required.
- Attachment upload for signed/approved documentation, with private storage and authorized access.
- Leave status, decision history, and date validation.

**Acceptance gate**
- Invalid date ranges and day counts are rejected.
- Only authorized users approve or assign leave.
- Private attachments are not publicly exposed.
- Leave records and decisions remain traceable.

**Next prompt:** “Proceed with Phase 17 only: OTP and KoboToolbox integrations. Build secure integration adapters/configuration, test-mode behavior, error handling, and documented setup for temporary-agent OTP and KoboToolbox survey data. Do not invent credentials or claim a live connection without verification. Test and stop.”

---

# Phase 17 — OTP and KoboToolbox integrations

**Goal:** Integrate external services through documented, replaceable boundaries.

**Scope**
- OTP provider adapter for temporary-agent sign-in/verification and relevant alert workflows as approved.
- KoboToolbox API integration for market-insight/survey data.
- Environment-based credentials and configuration.
- Timeouts, retries where safe, rate limiting, error logging without secrets, and graceful failure states.
- Test/mock mode clearly separated from production.
- Document required credentials, scopes, endpoints, and setup steps without embedding secrets.

**Acceptance gate**
- Automated tests cover success, failure, timeout, and malformed responses.
- Secrets remain server-side.
- No claim of live integration unless tested against an authorized environment.
- Imported survey data is validated, traceable to source, and does not overwrite core sales/customer records without an approved mapping.

**Next prompt:** “Proceed with Phase 18 only: agent performance and recognition. Implement top-three agent recognition (Champion, Hall of Fame, Top Sales), top-selling product, and top-selling branch using transparent, documented metrics. Test ties, date filters, and eligibility rules, then stop.”

---

# Phase 18 — Agent performance and recognition

**Goal:** Recognize performance using consistent and explainable metrics.

**Scope**
- Rank the top three agents using a documented metric and selected period.
- Apply the labels Champion, Hall of Fame, and Top Sales according to the approved business interpretation.
- Show top-selling product and top-selling branch.
- Exclude or separately identify pending/unapproved/ineligible sales according to documented rules.
- Support appropriate city/time filters and access controls.
- Handle ties deterministically and explain tie handling.

**Acceptance gate**
- Rankings match an independently checked calculation.
- Tie behavior is consistent.
- The metric and date period are visible to users.
- The leaderboard does not expose data users are not authorized to see.

**Next prompt:** “Proceed with Phase 19 only: end-to-end QA, security review, UAT, and deployment readiness. Do not add new business features. Test the full BRD workflows, resolve defects, document deployment/rollback/backup procedures, report any remaining blockers honestly, and stop for final approval.”

---

# Phase 19 — End-to-end QA, security review, UAT, and deployment readiness

**Goal:** Validate the integrated system and prepare it for a controlled release.

**Scope**
- End-to-end tests across authentication, roles, master data, targets, stock, sales, retention approval, product switch, refunds, follow-up, audit, dashboards, reports, payroll, leave, integrations, and leaderboard.
- Regression tests for previously completed phases.
- Security review of server-side authorization, RLS policies, file storage, secrets, input validation, rate limiting, and sensitive logging.
- Accessibility and responsive behavior review for key workflows.
- Performance checks for likely operational data volumes.
- UAT test cases mapped to BRD requirements and sign-off checklist.
- Production environment variable checklist, migration instructions, backup/restore notes, monitoring, deployment, and rollback procedure.
- Fix defects in scope; document out-of-scope improvements rather than silently expanding the release.

**Acceptance gate**
- All critical UAT cases pass or have explicitly accepted, documented exceptions.
- No known critical/high security issue remains unresolved without explicit business-owner acceptance.
- Migrations, backup/restore, and rollback steps are documented and reviewed.
- Production secrets are configured outside source control.
- The business owner approves go-live.
- The application is not described as production-ready if critical acceptance criteria remain unmet.

**Final output**
- Release readiness report.
- BRD-to-test traceability matrix.
- Open-defect and accepted-risk register.
- Deployment and rollback guide.
- Known limitations and next-release backlog.

---

# Phase control template for every phase after Phase 1

Paste this with the phase number and title each time:

```text
Proceed with Phase [N] only: [PHASE TITLE].

Before coding:
1. Read the BRD, roadmap, phase log, decisions log, and relevant existing code.
2. Check the previous phase's acceptance gate and identify dependencies.
3. State a short implementation plan and the exact scope you will change.
4. If a material business decision is unresolved, stop and ask me before implementing that decision.

Implementation:
- Implement only Phase [N].
- Do not begin later phases or add unrelated refactors.
- Preserve working behavior and follow existing repository conventions.
- Enforce authorization on the server and at the database/RLS layer where applicable.
- Add/update tests and documentation.
- Keep the phase log and decisions log current.
- Do not claim a check passed unless you ran it.

Before stopping:
- Run applicable lint, type-check, tests, and build.
- Review the diff for secrets, unrelated changes, and regressions.
- Report files changed, behavior implemented, checks and results, manual steps, risks, and known gaps.
- Map this phase's requirements to its acceptance criteria.
- State clearly whether the phase acceptance gate passed.
- Provide the exact suggested prompt for the next phase, but do not execute it.

STOP after this phase and wait for my explicit instruction.
```

---

# Recommended working routine

1. Put the BRD and roadmap inside the project repository.
2. Start Claude Code at the repository root.
3. Paste the **Phase 0 trigger prompt**. It should assess the repository and build Phase 1 only.
4. Review the diff and run the app yourself. Do not accept “done” without actual test output and a reviewable diff.
5. When Phase 1 is accepted, paste the Phase 2 prompt. Repeat one phase at a time.
6. Keep the same BRD, roadmap, phase log, and decisions log in the repository so future sessions can recover the project state.
7. If Claude Code finds a business-rule ambiguity, resolve it in `DECISIONS.md` and, if it changes the agreed requirement, update the BRD before proceeding.

## Important business-policy items to confirm before the relevant phase

- Whether the stock item name is **BDCOM** or **PDCOM**.
- The exact method for temporary-agent phone-based authentication and OTP delivery provider.
- The definition of “eligible sale” for payroll: treatment of pending retention, approved refunds, duplicate flags, rejected records, and reversals.
- The precise ranking meaning/order of Champion, Hall of Fame, and Top Sales.
- Which roles can see individual customer details, payroll, audit investigations, and exported data.
- The official list of branches, districts, areas, products, prices, and sales statuses.

These items should be confirmed at the latest before their implementation phase. Do not block unrelated foundation work unless the unresolved item affects that phase.
