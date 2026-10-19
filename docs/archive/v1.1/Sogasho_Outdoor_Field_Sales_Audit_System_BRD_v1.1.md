# Business Requirements Document (BRD)

## Outdoor Field Sales, Performance Analytics & Audit Control System

Prepared for **Sogasho ISP**

*Source baseline: "Outdoor sales & Audit System" requirements note, dated 18 October 2026*

**Version 1.1 | Status: Approved baseline with open blocking inputs**

---

# Document Control

| Field | Details |
|---|---|
| Document | Business Requirements Document (BRD) |
| Product | Sogasho Outdoor Field Sales, Performance Analytics & Audit Control System |
| Business owner | Sogasho ISP — Outdoor Sales / Commercial Department |
| Technology baseline | Next.js web application (installable PWA) with Supabase (PostgreSQL, Auth, Storage) |
| Operating cities | Hargeisa, Burco, Berbera and Borama |
| Version / status | 1.1 — Approved baseline; items in §15.3 remain open and block the phases shown |
| Primary source | User-provided four-page "Outdoor sales & Audit System" PDF (to be stored in `docs/00-source/`) |
| Companion documents | `Sogasho_Outdoor_Field_Sales_Audit_System_SDD_v1.1.md`, `Sogasho_Outdoor_Field_Sales_Audit_System_Claude_Code_Roadmap_v1.1.md` |
| Audience | Management, Outdoor Sales, Super Admin, Team Leaders/Supervisors, Follow-up Team, Payroll/Finance, Stock Officer, Auditor, Developers and QA |

## Change history

| Version | Date | Summary |
|---|---|---|
| 1.0 | 18 Oct 2026 | Initial draft for stakeholder validation. |
| 1.1 | 19 Oct 2026 | Applied the approved v1.1 change proposal: editorial fixes E-01…E-13 and business decisions D-01…D-29. Added customer identity model, eligible-sale definition, stock custody and serial tracking, legacy data import, free-month handling, follow-up "Not Reached", localization, device approach, NFR targets, glossary, new UAT cases, traceability matrix and a consolidated decision register. Incentive rule recorded as closed. Stock item spelling standardized to **BDCOM** (pending confirmation, D-10). |

## Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Business owner (Outdoor Sales) | | Approved v1.1 change proposal ("Approve all") | 19 Oct 2026 |
| Finance / Payroll | | Pending | |
| Stock Officer / Operations | | Pending | |

## How to read this BRD

Source requirements remain the baseline. Requirement tags:

- **(Source)** — taken from the source note. Untagged requirements are also source requirements.
- **(Approved D-xx)** — a business decision approved in the v1.1 change proposal. These are now Sogasho policy for this system.
- **(Recommended control)** — a control added to make the product safe and buildable; approved as part of v1.1.
- **(OPEN — blocks Phase N)** — a business input is still required. The default shown is provisional and must not be treated as final until the input is supplied (see §15.3).

Phase numbers refer to the Roadmap v1.1 (Phases 0–20).

# Contents

1. Executive summary
2. Business context and objectives
3. Scope and boundaries
4. Stakeholders, roles and data access
5. End-to-end operating model
6. Functional requirements by module
7. Fraud, duplicate and audit control framework
8. Business rules and calculations
9. Dashboard and reporting requirements
10. Data requirements and relationships
11. Non-functional requirements
12. Integrations
13. Acceptance criteria and UAT
14. Risks, assumptions and dependencies
15. Delivery plan and decision register
16. Glossary
- Appendix A — Source-to-BRD coverage
- Appendix B — Build principles
- Appendix C — Requirement traceability (FR → Phase → UAT)

# 1. Executive Summary

Sogasho requires a centralized Outdoor Field Sales, Performance Analytics and Audit Control System for temporary and permanent field agents operating in Hargeisa, Burco, Berbera and Borama. The system is a Next.js web application, installable on agents' phones as a Progressive Web App (PWA), backed by Supabase.

The system makes every customer registration traceable from agent submission through approval, stock issue (including equipment serial number), follow-up, audit investigation and payroll eligibility. Each real customer has one customer record identified by a unique normalized phone number and a unique Index Number; a customer may have many sales over time. A New registration that reuses an existing phone or Index is blocked, logged as a duplicate attempt and reported to Super Admin. Retention registrations require Team Leader/Supervisor approval. Refunds require Super Admin approval. Temporary agents sign in with phone number, password and SMS one-time password (OTP); permanent users sign in with email and password.

One shared definition of an **eligible sale** (§8.2) drives targets, approved dashboard figures, payroll and rankings, so every screen counts sales the same way. Payroll is calculated from eligible sales: temporary agents receive a $100 base salary; all agents earn $5 for each eligible unit above 15 in the month.

The system is delivered in phases, with a **pilot release in Hargeisa** after core sales, stock, approval, audit, dashboard and legacy-data import are complete (Phase 11), followed by a full production release to all four cities (Phase 20).

# 2. Business Context and Objectives

## 2.1 Business problem

- Management needs daily and period-based performance visibility by agent, city, product, branch, price and customer type.
- Duplicate customer phone numbers or Index Numbers must not be registered as new independent sales; duplicate attempts must be escalated for investigation.
- Retention registrations need an approval control to prevent unapproved or misclassified retention activity.
- Customer follow-up in the second month must distinguish customers who remain active from those who expire.
- Equipment issued to customers must be deducted from the issuing agent's custody and reconciled against stock received from the Stock Officer, down to the serial number.
- Payroll should be calculated from recorded, eligible sales and configured incentive rules rather than manually re-keyed totals.
- Refunds and product switches need controlled workflows and clear records.

## 2.2 Business objectives

| ID | Objective | Evidence of achievement |
|---|---|---|
| BO-01 | Provide one operational source of truth for outdoor sales. | Sales, customer, stock, approval and audit records are linked and searchable. |
| BO-02 | Prevent duplicate customer registration. | Unique phone and Index constraints reject duplicates; attempts create audit events and alerts. |
| BO-03 | Improve fraud visibility and investigation. | Review queue shows risk reason, related records, timestamps and investigator disposition. |
| BO-04 | Track sales and targets daily. | Dashboards compare eligible actuals with agent targets by city, product and period. |
| BO-05 | Improve customer follow-up. | A dedicated list supports Active / Expire / Not Reached outcomes. |
| BO-06 | Improve stock accountability. | Receipts, transfers, issues, returns and balances reconcile by location and serial number. |
| BO-07 | Standardize payroll calculations. | System-calculated totals, incentive and payroll snapshots are reproducible. |
| BO-08 | Bring market-survey data into the same workspace. | KoboToolbox data is imported with source and sync status visible. |

## 2.3 Success measures

Baselines must be measured during the pilot. Target values are set by Management before production release (Phase 20). Measures:

- Duplicate attempts blocked per month.
- Percentage of sales with complete data and serial evidence.
- Unresolved audit cases older than 7 days.
- Stock variance by location.
- Follow-up completion rate (Active + Expire + Not Reached ÷ due).
- Payroll correction rate (adjustment lines ÷ payroll lines).
- Dashboard freshness.

# 3. Scope and Boundaries

## 3.1 In scope

- Login for temporary agents (phone + password + SMS OTP) and permanent users (email + password); forced first-login password change for system-generated passwords.
- User creation, activation/deactivation, roles, permissions, team structure (Team Leader → agents), dashboard/module access and configurable dropdowns.
- Product catalog and price list with effective dates, set by Super Admin.
- Agent target and KPI assignment.
- Sales registration with customer identity model, New/Retention classification, catalog price, free-month payment option and serial-tracked equipment issue.
- Retention approval; refund approval; product switch; customer follow-up with Active/Expire/Not Reached.
- Duplicate-attempt logging, audit cases and notifications to Super Admin.
- Leave requests, approval and private attachment of signed leave record.
- Payroll month processing, eligibility, incentive calculation, holds, adjustments and payroll snapshots.
- Stock receipt, transfer, custody, issue, return and balance reporting with serial numbers for WiFi Router, BDCOM and CALIX.
- Agent performance rankings, sales reports and exports, KoboToolbox integration, notifications and OTP.
- One-time **legacy data import** of existing customers and opening stock balances/serials (Approved D-21).

## 3.2 Out of scope unless separately approved

- Replacing Sogasho's core billing, CRM, payment collection or provisioning platform.
- Automated confirmation of whether a customer's service is technically active.
- Automated bank/mobile-money disbursement of payroll or refunds.
- Native mobile applications (the system is an installable responsive web app, Approved D-25).
- Full offline operation (draft autosave and safe retry are in scope, D-25).
- GPS location capture, photo evidence, route tracking and biometric attendance — **deferred to Release 2** (D-25).
- Machine-learning fraud decisions; v1 uses deterministic, explainable rules.
- Customer self-service portal.
- Somali-language translation content for v1 (the UI is built translation-ready; D-24).

# 4. Stakeholders, Roles and Data Access

| Role | Core responsibilities | Access principles |
|---|---|---|
| Super Admin | Manage users, team structure, products/prices, permissions, targets; approve refunds; fallback Retention approver; receive fraud alerts; manage audit cases; approve leave. | Full administrative access; every privileged action logged. |
| Temporary Sales Agent | Sign in with phone, password and OTP; register sales; hold stock custody; request leave; view own performance and payroll line. | Own records only. |
| Permanent Sales Agent | Sign in with email and password; register sales; hold stock custody; request leave; view own performance and payroll line. | Own records only. |
| Team Leader / Supervisor | Approve/reject Retention for own team; submit refunds; view team performance; override agent city. | Own team's records. Cannot approve own submissions. |
| Follow-up Team | Work the follow-up due list; record Active / Expire / Not Reached. | Due-list fields only (§6.7). |
| Stock Officer | Record receipts, transfers to branches/agents, returns and adjustments (with approval). | Stock module; no customer phone/Index except serial linkage. |
| Payroll / Finance | Calculate, review, export and finalize payroll. | Payroll data; read access to sales for reconciliation. |
| Auditor / Management Viewer | Review audit trails, cases assigned to them, trends and reports. | Read-only except assigned audit cases. |

## 4.1 Data access matrix (Approved D-22)

| Data | Agent | Team Leader | Follow-up | Stock Officer | Finance | Auditor / Mgmt | Super Admin |
|---|---|---|---|---|---|---|---|
| Sales | own | team | – | – | read | read | full |
| Customer phone / Index | own customers | team | due list only | – | – | read | full |
| Stock | own custody | team | – | full | read | read | full |
| Payroll | own line | – | – | – | full | read | full |
| Audit cases | – | – | – | – | – | assigned / read | full |
| Leave | own | – | – | – | – | – | full |
| Exports | – | team | – | stock | payroll | yes | yes |

Permissions are enforced server-side and by database Row Level Security (RLS); hiding a menu item is never the only control.

# 5. End-to-End Operating Model

1. Super Admin configures cities, branches, districts, areas, products, price list, customer types, stock items, users, teams, permissions and targets.
2. Before go-live, existing customers and opening stock (with serials) are imported (§6.17).
3. Stock Officer records stock received into Central Store and transfers it to branches and agents; the receiving agent acknowledges receipt.
4. Agent signs in (temporary: phone + password + OTP; permanent: email + password). First login forces a password change.
5. Agent registers a sale. The system validates required fields, catalog price, customer identity, same-month rule and equipment serials from the agent's custody.
6. New sales that pass validation are **Approved** automatically. Retention sales are **Pending** until the agent's Team Leader (or Super Admin) decides.
7. Equipment issue is recorded in the same transaction as the sale, deducting the serial(s) from the agent's custody.
8. Duplicate attempts and rule hits create audit events and notify Super Admin; cases are investigated and closed with a disposition.
9. In the month after the sale, the Follow-up Team records Active, Expire or Not Reached.
10. Refunds (Super Admin approval) and product switches create linked records and stock returns.
11. At month end, after the payroll cutoff, Finance calculates payroll from eligible sales, resolves holds and mismatches, and finalizes. Corrections after finalization are made as adjustment lines in the next run.

# 6. Functional Requirements

## 6.1 Login and Authentication

| ID | Requirement |
|---|---|
| FR-AUTH-01 | The system shall support temporary and permanent agent account types. |
| FR-AUTH-02 | Temporary agents shall sign in using phone number and password, followed by an SMS OTP. (Source; Approved D-20) |
| FR-AUTH-03 | Permanent agents and staff shall sign in using email and password. |
| FR-AUTH-04 | When Super Admin creates a user, the system shall generate a temporary password and require a password change at first login. Temporary-agent phone numbers are marked verified at creation by Super Admin. (Approved D-20) |
| FR-AUTH-05 | The system shall send the temporary-agent sign-in OTP through the selected SMS provider. **Provider: OPEN — blocks Phase 3 (D-20).** |
| FR-AUTH-06 | The system shall prevent deactivated users from signing in and invalidate their active sessions. |
| FR-AUTH-07 | The system shall record successful and failed logins, password changes and OTP outcomes as security events. (Recommended control) |
| FR-AUTH-08 | After 5 consecutive failed sign-in attempts the account is locked for 15 minutes. OTP is valid for 5 minutes; at most 3 OTP resends per 15 minutes. (Approved D-20) |
| FR-AUTH-09 | Sign-in errors shall not reveal whether an account exists. (Recommended control) |

## 6.2 Users, Roles, Teams and Settings

| ID | Requirement |
|---|---|
| FR-USER-01 | Super Admin shall create and maintain user accounts. |
| FR-USER-02 | Super Admin shall assign roles, permissions, dashboard access and module access. |
| FR-USER-03 | Super Admin shall activate or disable users. |
| FR-USER-04 | Super Admin shall manage customer types and configurable dropdown options. |
| FR-USER-05 | Permissions shall be enforced on the server and database layer, not only by hiding interface elements. (Recommended control) |
| FR-USER-06 | Changes to roles, permissions, team assignment and status shall be recorded in the activity log. (Recommended control) |
| FR-USER-07 | Super Admin shall assign each agent to a city, branch and Team Leader; each Team Leader supervises a defined set of agents. **Team structure, branches, districts and areas: OPEN — blocks Phases 4–5 (D-29).** |
| FR-USER-08 | Each user record shall hold employment type (temporary/permanent), start date and, when deactivated, end date (used for base-salary pro-rating, D-08). |

## 6.3 Products, Prices and Targets

| ID | Requirement |
|---|---|
| FR-CONF-01 | Super Admin shall create and maintain products and a price list. Products: **FTTA, FTTH, FTTB, LTE**. (Approved D-04) |
| FR-CONF-02 | Super Admin shall assign targets and KPIs to each sales agent. |
| FR-CONF-03 | The applicable price shall be stored on each sale (price snapshot) so later price changes do not rewrite history. |
| FR-CONF-04 | Target assignments shall include agent (or team/city), period, KPI definition, target value and effective dates. |
| FR-CONF-05 | Prices have effective-from/effective-to dates and may differ by city if configured. **Actual price list: OPEN — blocks Phase 5 (D-04).** |
| FR-CONF-06 | Target progress shall be calculated from eligible sales (§8.2) only. (Approved D-06) |

## 6.4 Sales Registration

| ID | Requirement |
|---|---|
| FR-SALE-01 | The sales form shall capture Customer Name, Phone Number, Index Number, District, Area, City, Product, Price, Branch, Stock Given and Customer Type. |
| FR-SALE-02 | District and Area shall be selected from dropdowns maintained in Settings. |
| FR-SALE-03 | City shall default to the agent's assigned city; only Team Leader or Super Admin may override it. (Approved) |
| FR-SALE-04 | Phone Number shall be normalized to E.164 (`+252…`); agents may type it with or without `+252` or a leading `0`. Allowed mobile prefixes are configurable. Normalized phone is globally unique across all customers, including expired customers. (Approved D-01, D-03) |
| FR-SALE-05 | Index Number shall be globally unique. It is stored trimmed and upper-case; format validation is configurable. **Definition and format: OPEN — blocks Phase 7 (D-02).** |
| FR-SALE-06 | Customer Type shall be New or Retention. |
| FR-SALE-07 | Retention registration shall require Team Leader/Supervisor approval before it is Approved/eligible. |
| FR-SALE-08 | Stock Given shall list WiFi Router, BDCOM and CALIX. The agent selects the equipment serial number(s) from their own custody. (Approved D-10, D-12) |
| FR-SALE-09 | The system shall store submitting agent (from the authenticated session, never from client input), submission time, status, approval history and change history. |
| FR-SALE-10 | The system shall display a clear validation message when a duplicate or invalid record is rejected. |
| FR-SALE-11 | **New sale:** if the phone or Index already exists on any customer, submission is blocked, a duplicate-attempt event is logged and Super Admin is notified. (Approved D-01) |
| FR-SALE-12 | **Retention sale:** if the customer exists, the sale links to that customer; if not found, the agent creates the customer record and the sale proceeds to approval. If phone matches one customer and Index matches a different customer, or names materially differ, submission is blocked and logged as a duplicate attempt. (Approved D-01) |
| FR-SALE-13 | A customer may not have two non-reversed sales in the same calendar month (business timezone). (Approved D-01) |
| FR-SALE-14 | Price is selected from the active price list for the product (and city); agents cannot type a price. One sale = one unit. (Approved D-04) |
| FR-SALE-15 | The sales form shall autosave a draft on the device and submission shall be idempotent, so retrying on a poor connection never creates a second sale or a second stock deduction. (Approved D-25) |
| FR-SALE-16 | Changing a customer's phone or Index after registration is a Super Admin action requiring a reason; the old value is kept in history and remains reserved. (Approved D-01) |

## 6.5 Refunds

| ID | Requirement |
|---|---|
| FR-REF-01 | Refund request shall capture Customer Name, Phone Number, Index, Product Purchased, Refund Amount, Reason and Branch, linked to the original sale. |
| FR-REF-02 | Reason options: Out of boundary, Technical delay, Refused, No signal, Other (Other requires a note). |
| FR-REF-03 | Every refund shall require Super Admin approval. Agents and Team Leaders may submit. (Approved D-15) |
| FR-REF-04 | Pending, Approved and Rejected states shall be visible; decision maker, date, amount and reason retained. |
| FR-REF-05 | Approval shall not delete the original sale; it creates a linked reversal record. |
| FR-REF-06 | Refund amount shall be greater than zero and not exceed the amount collected on the sale. (Recommended control) |
| FR-REF-07 | Refund approved **before** the sale's payroll month is finalized → the sale is excluded from units, revenue and incentive for that month. Approved **after** finalization → a negative adjustment line is created in the next payroll run; finalized payroll is never edited. (Approved D-15) |
| FR-REF-08 | Returned equipment shall be recorded as a stock return movement by serial. (Approved D-15) |

## 6.6 Audit and Duplicate/Fraud Detection

| ID | Requirement |
|---|---|
| FR-AUD-01 | The system shall prevent duplicate Phone Number and Index Number values from being accepted as separate customers. |
| FR-AUD-02 | A duplicate attempt shall create a durable audit event (which survives the rejected submission) and notify Super Admin. |
| FR-AUD-03 | Audit events shall show rule triggered, attempted values, matching record(s), agent, date/time and case status. |
| FR-AUD-04 | Audit case states: **Open → Under Review → Confirmed Issue or False Positive → Resolved.** (Approved D-13) |
| FR-AUD-05 | No user may edit or delete audit events or cases; only state, assignment and notes change, with history. (Approved D-13) |
| FR-AUD-06 | A duplicate attempt is a risk indicator, not proof of fraud; only a reviewer can set Confirmed Issue. |
| FR-AUD-07 | Only Super Admin and the assigned Auditor may change a case's state. (Approved D-13) |
| FR-AUD-08 | Sales linked to an Open or Under Review case place the agent's payroll line on **hold**; sales linked to a Confirmed Issue case are ineligible. (Approved D-06) |

## 6.7 Customers and Follow-up

| ID | Requirement |
|---|---|
| FR-FUP-01 | A customer whose sale is in month M is due for follow-up during month M+1 (New and Retention). (Approved D-17) |
| FR-FUP-02 | The follow-up list shows only Customer Name, Index, Phone Number, Branch, City and Customer Type, plus the outcome field. |
| FR-FUP-03 | Outcomes: **Active**, **Expire**, **Not Reached**. (Approved D-17) |
| FR-FUP-04 | Reports show counts and rates for each outcome and for Not Reviewed. |
| FR-FUP-05 | The system records who completed each follow-up and when. |
| FR-FUP-06 | Items not completed by the end of M+1 remain **Not Reviewed** and appear on an overdue list. (Approved D-17) |
| FR-FUP-07 | Exactly one follow-up item exists per customer per due month, even if generation is retried. |

## 6.8 Leave Management

| ID | Requirement |
|---|---|
| FR-LEAVE-01 | Super Admin shall assign annual leave entitlement and approve or reject requests. |
| FR-LEAVE-02 | Leave form: Employee Name, Department (default Outdoor), date range, number of days, reason, Leave Type and attachment. |
| FR-LEAVE-03 | Leave types: Annual, Sick, Maternity. |
| FR-LEAVE-04 | After approval, the signed-by-Super-Admin document is attached (PDF/JPG/PNG, max 5 MB) in private storage. (Approved D-18) |
| FR-LEAVE-05 | Leave status and approval history are retained. |
| FR-LEAVE-06 | Agents submit their own leave requests. (Approved D-18) |
| FR-LEAVE-07 | Number of days = working days in the range, excluding Fridays and configured public holidays. Weekend days and holiday list are configurable. (Approved D-18) |
| FR-LEAVE-08 | Approved leave does not reduce temporary-agent base salary. (Approved D-08 default) |

## 6.9 Payroll

| ID | Requirement |
|---|---|
| FR-PAY-01 | Payroll shall be processed by payroll month and agent. |
| FR-PAY-02 | Payroll shows Agent Name, City, FTTA, FTTH, FTTB, LTE units, Grand Total, New, Retention, Revenue, Incentive, Base Salary and Gross Pay. |
| FR-PAY-03 | All counts and revenue are derived from eligible sales (§8.2); they cannot be typed. |
| FR-PAY-04 | Grand Total = FTTA + FTTH + FTTB + LTE units. |
| FR-PAY-05 | New + Retention must equal Grand Total; a mismatch flags the line and blocks finalization. |
| FR-PAY-06 | Incentive = MAX(0, eligible units − 15) × $5, per agent per month, all products combined, same rule for temporary and permanent agents. (Confirmed; Approved D-07) |
| FR-PAY-07 | Temporary-agent base salary = $100 per month. Permanent staff: payroll module calculates incentive only; Base Salary shown as $0 ("paid via HR payroll"). (Approved D-05) |
| FR-PAY-08 | Gross Pay = Base Salary + Incentive (+ adjustment lines, §FR-PAY-13). |
| FR-PAY-09 | Payroll summary shows totals for all numeric columns. |
| FR-PAY-10 | Each finalized run stores a snapshot (source sale IDs, rule version, values) so it can be reproduced. |
| FR-PAY-11 | Temporary-agent base salary is pro-rated by calendar days active in the month (start/end date). **Rule: OPEN — Finance confirmation blocks Phase 16 (D-08).** |
| FR-PAY-12 | A line on hold (open audit case, FR-AUD-08) cannot be finalized until released. |
| FR-PAY-13 | Corrections after finalization (e.g., late refunds) are separate adjustment lines in the next run, referencing the original sale and run. |
| FR-PAY-14 | Payroll cutoff is the 3rd day of the following month by default (configurable). Retention approved after cutoff counts in the month approved. (Approved D-06) |
| FR-PAY-15 | Payroll can be exported as PDF summary and per-agent payslip, and as XLSX. (Approved D-26) |

## 6.10 Product Switch

| ID | Requirement |
|---|---|
| FR-SW-01 | The switch form captures the customer's name, phone, Index, branch and city, plus From Product. |
| FR-SW-02 | The switch form captures To Product and stock given (serials from agent custody). |
| FR-SW-03 | Name, phone and Index must match the existing customer record; otherwise the switch is rejected with an explanation. |
| FR-SW-04 | A switch is one linked transaction with before/after product, new equipment issued and old equipment returned. |
| FR-SW-05 | Only FTTA ↔ FTTH is allowed; same-product switches are blocked. (Approved D-16) |
| FR-SW-06 | A switch is never counted as a sale, unit or incentive. (Approved D-16) |

## 6.11 Free-Month Compensation

| ID | Requirement |
|---|---|
| FR-FREE-01 | Free-month compensation is handled within sales registration, not a separate module. |
| FR-FREE-02 | The sales form offers a payment option "Pay 2 months, get 1 free". (Approved D-09) |
| FR-FREE-03 | Such sales are flagged `free_month = true` and reported separately. |
| FR-FREE-04 | The qualifying amount is configurable (default **$50**). Revenue = amount collected; the sale counts as **1 unit**. (Approved D-09) |

## 6.12 Stock

| ID | Requirement |
|---|---|
| FR-STK-01 | The system records stock received from the Stock Officer into Central Store. |
| FR-STK-02 | Stock items: **WiFi Router, BDCOM, CALIX**. Display names editable in Settings. **Spelling confirmation: OPEN — blocks Phase 5 (D-10).** |
| FR-STK-03 | A New or Retention sale deducts the issued serial(s) from the submitting agent's custody in the same transaction. Retention stock is deducted at submission; if the Retention is rejected, a return movement is required. (Approved D-11, D-14) |
| FR-STK-04 | Stock report compares received, transferred, issued, returned, adjusted and current balance per item and location. |
| FR-STK-05 | No location balance may go negative. |
| FR-STK-06 | Each movement records item, quantity, serial(s), from/to location, linked sale/switch/refund, user, timestamp and movement type. |
| FR-STK-07 | Adjustments require a reason and Super Admin approval. |
| FR-STK-08 | Locations: **Central Store → Branch → Agent custody**. Transfers to an agent require the agent's acknowledgement before the stock counts in their custody. (Approved D-11) |
| FR-STK-09 | WiFi Router, BDCOM and CALIX are serial-tracked: serials captured at receipt (scan or paste in bulk), tracked through transfers, selected at sale. A serial may be issued to only one active customer. (Approved D-12) |
| FR-STK-10 | Returns (refund, switch, rejected Retention, faulty) move the serial back to Branch or Central Store with a reason. (Approved D-11) |

## 6.13 Agent Performance and Recognition

| ID | Requirement |
|---|---|
| FR-PERF-01 | The system shows the top three agents by eligible units for the selected month with the titles Champion, Top Sales and Hall of Fame. Provisional order: **#1 Champion, #2 Top Sales, #3 Hall of Fame. Order: OPEN — blocks Phase 19 (D-19).** |
| FR-PERF-02 | The system identifies the top-selling product and top-selling branch. |
| FR-PERF-03 | Ties are broken by higher eligible revenue, then by earlier approval time of the agent's last counted unit. Agents with a Confirmed Issue case that month are excluded. (Approved D-19) |

## 6.14 Sales Reports and Exports

| ID | Requirement |
|---|---|
| FR-REP-01 | Reports filter or group by city, branch, product, price, agent, week, month, quarter, six months and year. |
| FR-REP-02 | Reports show Active / Expire / Not Reached / Not Reviewed for New and Retention customers. |
| FR-REP-03 | Totals drill down to the underlying records, subject to permissions. |
| FR-REP-04 | Exports: CSV and XLSX for reports; PDF for payroll summary and payslip. Every export is logged with user, time and filters. Exports carry generated-at time and filters applied. (Approved D-26) |
| FR-REP-05 | Dates are reported in business timezone EAT (UTC+3). The week start day is configurable in Settings. (Approved D-24) |

## 6.15 KoboToolbox Survey Integration

| ID | Requirement |
|---|---|
| FR-KOB-01 | The system integrates with KoboToolbox so survey and market-insight data can be viewed in one place. |
| FR-KOB-02 | The integration shows sync status, source submission ID, submission time and import errors. |
| FR-KOB-03 | Sync is one-way (Kobo → system), hourly and on demand ("Sync now"). Re-imports never duplicate a submission. (Approved D-27) |
| FR-KOB-04 | Survey data is stored separately from sales/customer records. |
| FR-KOB-05 | **Form IDs and fields to import: OPEN — blocks Phase 18 (D-27).** |

## 6.16 Notifications and OTP

| ID | Requirement |
|---|---|
| FR-NOT-01 | Super Admin receives in-app and email notification for duplicate attempts and new audit cases. (Approved D-23) |
| FR-NOT-02 | OTP for temporary-agent sign-in is sent by SMS. |
| FR-NOT-03 | Approvers receive in-app notifications for Retention approvals and refunds awaiting decision. (Approved D-23) |
| FR-NOT-04 | OTP codes expire, are rate-limited and are never stored or logged in plaintext. |
| FR-NOT-05 | SMS is used only for OTP; no customer data is sent by SMS. (Approved D-23) |

## 6.17 Legacy Data Import (new in v1.1)

| ID | Requirement |
|---|---|
| FR-MIG-01 | Before pilot go-live, existing customers (name, phone, Index, product, city, branch) are imported as identity records so duplicate checks work from day one. (Approved D-21) |
| FR-MIG-02 | Opening stock balances and serials per location are imported. |
| FR-MIG-03 | The import runs first on staging and produces a data-quality report (invalid phones, missing Index, internal duplicates). Duplicates must be resolved by the business before production load. |
| FR-MIG-04 | Imported records are marked with source "legacy import" and import batch ID; they are not sales and do not count toward targets or payroll. |
| FR-MIG-05 | **Availability and format of legacy data: OPEN — blocks Phase 11 (D-21).** |

# 7. Fraud, Duplicate and Audit Control Framework

A duplicate attempt is blocked immediately and logged; it is not treated as proven fraud without investigation.

| Control | System behaviour | Priority |
|---|---|---|
| Unique identity | Normalized phone and Index are each unique at database level across all customers. | Must |
| Concurrent submission protection | Database constraints guarantee two simultaneous submissions cannot create duplicates. | Must |
| Duplicate attempt alert | A durable audit event is written even though the submission is rejected; Super Admin notified. | Must |
| Same-month rule | One non-reversed sale per customer per month. | Must |
| Retention approval | Pending until Team Leader decision; no self-approval. | Must |
| Serial-tracked equipment | A serial can be issued once to one active customer, only from the issuing agent's custody. | Must |
| Stock reconciliation | Opening + receipts + returns ± approved adjustments − issues − transfers out = closing, per location. | Must |
| Refund traceability | Approval creates a linked reversal; original sale remains. | Must |
| Payroll integrity | Units reconcile to New + Retention; open cases hold the line; finalized runs immutable. | Must |
| Tamper-evident audit trail | Approvals, overrides, exports and configuration changes logged; logs cannot be edited by users. | Must |
| Risk case workflow | Owner, state, notes, evidence links and disposition per case. | Must |
| Sales attribution review | Agent, timestamps, approval history and device/session metadata visible to investigators. | Should |

## 7.1 Additional risk rules (enabled individually by Super Admin after the pilot)

- Unusual concentration of registrations by one agent or in a narrow time window.
- Repeated attempts to register the same Index or phone under different agents.
- Retention edited after approval.
- Sale requiring equipment with no serial issued, or serial movement without a sale/switch/transfer.
- Changes to price, customer type, city, branch or product after submission.
- High refund rate by agent, product, branch or reason.
- Follow-up outcomes concentrated in one status for one agent's customers.

## 7.2 Audit case states (Approved D-13)

| State | Meaning |
|---|---|
| Open | Rule fired; not yet reviewed. |
| Under Review | A reviewer is investigating (use notes for "more information needed"). |
| Confirmed Issue | Evidence supports a policy violation; linked sales become ineligible. |
| False Positive | Legitimate explanation found; linked sales unaffected. |
| Resolved | Required action complete; history kept. Reached from Confirmed Issue or False Positive. |

# 8. Business Rules and Calculations

## 8.1 Rules

| Rule | Business rule |
|---|---|
| BR-01 | Normalized phone and Index Number are each globally unique across all customers, including expired ones. Old values after a change remain reserved. (D-01) |
| BR-02 | Retention requires Team Leader/Supervisor approval; Super Admin may approve as fallback; no self-approval. (D-14) |
| BR-03 | Refunds require Super Admin approval. |
| BR-04 | City defaults from the agent's assignment; only Team Leader/Super Admin may override. |
| BR-05 | Grand Total = FTTA + FTTH + FTTB + LTE units. |
| BR-06 | New + Retention must equal Grand Total, otherwise the payroll line is flagged and cannot be finalized. |
| BR-07 | Gross Pay = Base Salary + Incentive + adjustments. |
| BR-08 | Temporary-agent base salary = $100 per month, pro-rated by days active (D-08, OPEN). Approved leave does not reduce it. |
| BR-09 | Permanent staff: payroll module calculates incentive only; base salary $0 in this module. (D-05) |
| BR-10 | Incentive = MAX(0, eligible units − 15) × $5, per agent, per month, all products combined. **Closed decision.** (D-07) |
| BR-11 | Location stock balance can never be negative. |
| BR-12 | Product switch: FTTA ↔ FTTH only; identity must match; not a sale. (D-16) |
| BR-13 | Free-month: qualifying amount configurable (default $50); revenue = amount collected; counts as 1 unit. (D-09) |
| BR-14 | Only eligible sales (§8.2) count toward targets, approved dashboard figures, payroll and rankings. (D-06) |
| BR-15 | One non-reversed sale per customer per calendar month. (D-01) |
| BR-16 | 1 sale = 1 unit; price from catalog only. (D-04) |
| BR-17 | Revenue = amount collected at registration (price snapshot × months paid). (D-09) |
| BR-18 | All periods use business timezone EAT (UTC+3). (D-24) |

## 8.2 Eligible sale definition (Approved D-06)

A sale is **eligible** for a month when all of the following are true:

1. Status is **Approved** (New: approved automatically on successful validation; Retention: approved by Team Leader or Super Admin).
2. It has not been reversed by an approved refund (subject to FR-REF-07 timing).
3. It is not linked to an audit case in **Confirmed Issue** state.
4. It is a sale, not a product switch.
5. Its **submission date** falls in the month, and it was approved before that month's payroll cutoff (default 3rd day of the next month). If approved after the cutoff, it counts in the month it was approved.

Sales linked to an **Open** or **Under Review** case are counted but the agent's payroll line is held until the case is closed.

## 8.3 Confirmed incentive examples

| Eligible units in month | Incentive |
|---:|---:|
| 0 | $0 |
| 14 | $0 |
| 15 | $0 |
| 16 | $5 |
| 20 | $25 |
| 25 | $50 |
| 30 | $75 |

# 9. Dashboard and Reporting Requirements

## 9.1 Super Admin dashboard

Interactive, with daily, month-to-date and overall views:

- Units sold, units per product, revenue.
- Performance by city and branch.
- New and Retention customers, overall and this month.
- Monthly sales and revenue trend.
- Agent target progress (eligible sales).
- Top-selling product, branch and top-three agents.
- Audit: duplicate attempts, open cases, cases older than 7 days.
- Stock: received, issued, balance and variance by location.
- Follow-up completion.

Every figure states whether it counts **submitted** or **eligible** sales.

## 9.2 Report catalogue

| Report | Dimensions / measures | Primary users |
|---|---|---|
| Sales performance | City, branch, product, price, agent, period; units and revenue | Super Admin, Management |
| Customer classification | New vs Retention; Active / Expire / Not Reached / Not Reviewed | Sales, Follow-up, Management |
| Agent performance | Actual vs target, product mix, New/Retention, revenue, rank | Super Admin, Team Leaders |
| Audit and duplicates | Attempts, matched identity, rule, investigator, state, disposition | Super Admin, Auditor |
| Refunds | Requested/approved/rejected amounts, reason, branch, product, approver | Super Admin, Finance |
| Stock reconciliation | Opening, receipts, transfers, issues, returns, adjustments, closing, variance by item/location/serial | Stock Officer, Super Admin |
| Payroll summary | Product totals, New, Retention, revenue, incentive, base, adjustments, gross pay | Finance, Super Admin |
| Follow-up outcome | Due, completed, each outcome, overdue | Follow-up, Management |
| Free-month sales | Count, revenue, agent, branch | Management, Finance |
| Leave report | Requests, approved days, type, attachment status | Super Admin |
| Survey insights | Kobo submissions, sync status, mapped fields | Management |
| Export log | Who exported what, when, with which filters | Super Admin, Auditor |

## 9.3 Dashboard usability

- Consistent filters showing selected period and city/branch scope.
- Clicking a chart segment opens the authorized detail list.
- Metric definitions visible; submitted, pending, approved, reversed and under-review labelled distinctly.
- Empty, loading and error states; a freshness indicator on cached figures.
- Usable on phone-sized screens.

# 10. Data Requirements and Relationships

## 10.1 Core records

| Entity | Key data / relationships |
|---|---|
| User / Agent | ID, employment type, name, phone/email login, city, branch, Team Leader, role, active status, start/end date, first-login flag |
| Team | Team Leader, member agents |
| Role / Permission | Role, permission keys, data scope |
| Product / Price | Product code (FTTA/FTTH/FTTB/LTE), active status, price, city (optional), effective dates |
| Target / KPI | Agent/team/city, period, KPI, target value, effective dates, creator |
| Customer | ID, name, normalized phone, display phone, Index Number, district, area, city, branch, source (field / legacy import), identity change history |
| Sale | ID, customer, agent, product, price snapshot, months paid, amount collected, free-month flag, branch/city, New/Retention, status, timestamps, idempotency key, approval, refund links |
| Approval | Entity, approval type, requester, decider, decision, reason, timestamps |
| Audit Event / Case | Rule, attempted values, related records, user, case owner, state, notes, history |
| Stock Item / Serial / Location / Movement | Item, serial, location (central/branch/agent), movement type, quantity, from/to, linked record, actor, timestamp, approval |
| Refund | Sale, amount, reason, requester, state, approver, reversal, payroll adjustment link |
| Product Switch | Customer, from/to product, equipment issued and returned, actor, date |
| Follow-up | Customer, sale, due month, outcome, reviewer, date, notes |
| Leave Request | Agent, dates, working days, type, reason, status, attachment, approver |
| Payroll Run / Line / Adjustment | Month, status, cutoff, agent, counts, revenue, base, incentive, adjustments, hold flag, snapshot |
| Survey Submission | Kobo submission ID, form ID, source time, mapped fields, sync status |
| Import Batch | Source file, type, counts, errors, run by, environment |

## 10.2 Data integrity rules

- Stable internal IDs; phone and Index are never primary keys.
- Normalized phone stored for matching; display form kept.
- Database-level uniqueness for phone, Index, equipment serial (active issue) and follow-up per customer/month.
- Transactional sale + stock movement.
- Explicit statuses and timestamps for all workflow records.
- History kept for price, role, team, agent location, identity changes, approvals and states.
- No hard deletes of business, financial, stock or audit records; use reversal or archival.
- Timestamps stored in UTC; displayed in EAT.

# 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | RBAC with least privilege, provider-managed password hashing, OTP and login rate limiting, secure sessions, server-side authorization and RLS. |
| Privacy | Each role sees only the fields in §4.1; customer data never sent by SMS; exports logged. |
| Integrity | Database constraints, transactional mutations, idempotent submissions, reproducible payroll. |
| Auditability | Privileged actions, approvals, rejected attempts, configuration changes and exports logged with actor and time. |
| Performance | Dashboard and list pages load in under 3 seconds (95th percentile) on 3G/4G at expected volume. **Expected agent count and sales/day: OPEN — blocks Phase 20 (D-28).** |
| Availability | 99.5% during 07:00–21:00 EAT. (D-28) |
| Backup & recovery | Daily backups; RPO 24 h (≤ 1 h if Point-in-Time Recovery add-on approved); RTO 8 h; restore tested before production. (D-28) |
| Data retention | Financial, payroll and audit records 7 years; leave attachments 3 years after employment ends. **Confirmation by Legal/Finance: OPEN — blocks Phase 20 (D-28).** |
| Usability | Mobile-first sales form, clear validation messages, accessible labels (WCAG 2.1 AA contrast), responsive layout. |
| Device | Installable PWA on current Android/iOS browsers and desktop Chrome/Edge/Firefox/Safari; no native app; draft autosave; safe retry. (D-25) |
| Localization | Timezone EAT (UTC+3); currency USD with 2 decimals; date DD/MM/YYYY; English UI in v1, translation-ready for Somali. (D-24) |
| Branding | Sogasho brand kit (logo, Signika font, colours) applied per SDD §22. |
| Scalability | Additional cities, branches, agents, products and survey forms added through configuration. |
| Maintainability | Versioned migrations, documented environments, automated tests and CI. |

# 12. Integrations

| Integration | Purpose | Requirements |
|---|---|---|
| Supabase | Database, authentication, private file storage | Versioned schema, RLS, separate dev/staging/production projects, backups. |
| SMS / OTP provider | Temporary-agent OTP | Must reach Somaliland mobile numbers; connected through the Supabase Send-SMS hook or server adapter. **Provider: OPEN (D-20).** |
| Email | Super Admin alerts | Transactional email service; no customer phone/Index in email body (link to the app). |
| KoboToolbox | Survey and market insight | One-way, hourly + manual; error queue; **form IDs OPEN (D-27).** |
| File storage | Leave attachments | Private bucket; PDF/JPG/PNG; max 5 MB; signed short-lived links. |

# 13. Acceptance Criteria and User Acceptance Testing

| ID | Scenario | Expected result | Phase |
|---|---|---|---|
| UAT-01 | Temporary agent signs in with phone, generated password and OTP. | Login succeeds; forced password change at first login. | 3 |
| UAT-02 | Permanent user signs in with email and password. | Login succeeds. | 3 |
| UAT-03 | New sale with an already-registered phone (any format). | Blocked; clear error; durable audit event; Super Admin notified. | 7, 9 |
| UAT-04 | New sale with duplicate Index Number. | Blocked; event references the matching customer. | 7, 9 |
| UAT-05 | Retention submitted. | Pending; excluded from eligible metrics and payroll. | 7 |
| UAT-06 | Team Leader approves own team's Retention. | Approved; approver/time recorded; becomes eligible. | 8 |
| UAT-07 | Refund submitted. | Cannot be finalized without Super Admin decision. | 12 |
| UAT-08 | Sale issuing one router serial from custody holding that serial. | Serial moves to customer; custody decreases by one in same transaction. | 7 |
| UAT-09 | Issue equipment not in the agent's custody. | Blocked; no negative balance. | 7 |
| UAT-10 | Payroll where product sum differs from New + Retention. | Line flagged; finalization blocked. | 16 |
| UAT-11 | Payroll at 0, 14, 15, 16, 20, 30 eligible units. | Incentive $0, $0, $0, $5, $25, $75. | 16 |
| UAT-12 | Product switch with mismatched phone or Index. | Rejected with explanation. | 8 |
| UAT-13 | Follow-up user records Active, Expire or Not Reached. | Outcome, user and time recorded; reports update. | 13 |
| UAT-14 | Super Admin deactivates an agent. | Sessions ended; sign-in denied; change logged. | 4 |
| UAT-15 | Kobo API unavailable or returns invalid data. | Error recorded; retry creates no duplicates. | 18 |
| UAT-16 | User without permission calls a payroll/audit operation directly. | Denied server-side and by RLS; logged. | 4 → 20 |
| UAT-17 | Refund approved before payroll finalization. | Sale traceable; excluded from units, revenue, incentive. | 12, 16 |
| UAT-18 | City/product/month report. | Totals reconcile to records and dashboard for same filters. | 15 |
| UAT-19 | Sale with "Pay 2 months, get 1 free" at $50. | Flagged free-month; revenue $50; 1 unit. | 7 |
| UAT-20 | Retention for an existing customer. | Sale links to existing customer; no new customer created. | 7 |
| UAT-21 | New sale using phone of an expired customer. | Blocked as duplicate. | 7 |
| UAT-22 | Issue a serial already issued to an active customer. | Blocked. | 7 |
| UAT-23 | Refund approved after the month is finalized. | Finalized run unchanged; negative adjustment in next run. | 16 |
| UAT-24 | Follow-up item not completed by end of M+1. | Shown as Not Reviewed on overdue list. | 13 |
| UAT-25 | Unauthorized user requests a leave attachment. | Access denied; no public URL exists. | 17 |
| UAT-26 | Target progress with pending, approved and refunded sales. | Only eligible sales count. | 14 |
| UAT-27 | Two agents tie on units. | Tie broken by revenue, then earlier approval time. | 19 |
| UAT-28 | Export a report. | File matches filters and permissions; export logged. | 15 |
| UAT-29 | Legacy import file containing internal duplicates and invalid phones. | Data-quality report lists them; production load blocked until resolved. | 11 |
| UAT-30 | Agent taps Submit twice / retries after timeout. | One sale and one stock deduction only. | 7 |
| UAT-31 | Agent has a sale linked to an Open audit case at month end. | Payroll line on hold; cannot be finalized. | 16 |
| UAT-32 | Second sale for the same customer in the same month. | Blocked. | 7 |
| UAT-33 | 5 wrong passwords / excessive OTP requests. | Account locked 15 min / OTP rate-limited. | 3 |
| UAT-34 | Product switch FTTA → FTTH. | Recorded; not counted as sale or incentive; equipment swapped in stock. | 8 |
| UAT-35 | Retention rejected after equipment issued. | Return movement required; serial back in stock. | 8 |
| UAT-36 | Agent tries to approve own Retention. | Denied. | 8 |

# 14. Risks, Assumptions and Dependencies

| Type | Item | Response |
|---|---|---|
| Risk | SMS delivery to Somaliland numbers unreliable or costly. | Technical spike before Phase 3; choose provider by measured delivery (D-20). |
| Risk | Phone numbers entered inconsistently. | E.164 normalization and configurable prefixes (D-03). |
| Risk | Legacy data has duplicates or is unavailable. | Data-quality report; business resolves before load (D-21). Without legacy data, duplicate control is weak at pilot start. |
| Risk | Index Number undefined. | OPEN D-02; Phase 7 blocked until defined. |
| Risk | Poor field connectivity. | Draft autosave, idempotent submit (D-25). |
| Risk | Kobo form fields or API limits change. | Versioned mappings and error queue. |
| Risk | Agents dispute payroll. | Payroll snapshot with drill-down to each counted sale. |
| Assumption | Operations in Hargeisa, Burco, Berbera and Borama; pilot in Hargeisa. | Additional cities via configuration. |
| Assumption | Next.js + Supabase remain the approved stack. | Hosting provider selected in Phase 0. |
| Dependency | SMS provider account (D-20). | Business/IT. |
| Dependency | Price list (D-04), team structure and location lists (D-29). | Commercial department. |
| Dependency | Legacy data extract (D-21). | IT / Sales Operations. |
| Dependency | Finance pro-rating rule (D-08), retention periods (D-28). | Finance / Legal. |

# 15. Delivery Plan and Decision Register

## 15.1 Release plan

| Release | Roadmap phases | Content |
|---|---|---|
| Pilot — Hargeisa | 0–11 | Foundation, auth with OTP, users/teams, master data, stock with serials, sales (incl. free-month), Retention approval, product switch, duplicate detection and audit cases, operational dashboard, legacy import. |
| Production — all cities | 12–20 | Refunds, follow-up, targets, reports/exports, payroll (with one-month parallel run), leave, KoboToolbox, recognition, full QA/UAT and cutover. |

## 15.2 Closed decisions (approved 19 Oct 2026)

| ID | Decision | Section |
|---|---|---|
| D-01 | Customer identity model and duplicate definition | 6.4, 8.1 |
| D-03 | Phone normalization (E.164, +252) | 6.4 |
| D-05 | Permanent staff: incentive only in this module | 6.9 |
| D-06 | Eligible-sale definition and payroll cutoff | 8.2 |
| D-07 | Incentive: MAX(0, units − 15) × $5, all products, all agents | 8.1 |
| D-09 | Revenue = amount collected; free-month handling | 6.11 |
| D-11 | Stock custody chain | 6.12 |
| D-12 | Serial tracking for WiFi Router, BDCOM, CALIX | 6.12 |
| D-13 | Audit case states | 7.2 |
| D-14 | Retention approver, no self-approval, stock at submission | 6.4, 8.1 |
| D-15 | Refund effects and timing | 6.5 |
| D-16 | Product switch rules | 6.10 |
| D-17 | Follow-up timing and outcomes | 6.7 |
| D-18 | Leave process, attachments, working-day count | 6.8 |
| D-22 | Data access matrix | 4.1 |
| D-23 | Notification channels | 6.16 |
| D-24 | Localization | 11 |
| D-25 | Device approach (PWA), GPS/photo deferred | 3, 11 |
| D-26 | Export formats and logging | 6.14 |

## 15.3 Open decisions — blocking inputs

The provisional default may be used for design but **the named phase may not be completed (acceptance gate cannot pass) until the input is supplied and recorded in `DECISIONS.md`.**

| ID | Input needed | Provisional default | Owner | Blocks |
|---|---|---|---|---|
| D-02 | Index Number definition, issuer, format, reuse rule | Trimmed upper-case text, unique | Sales Operations | Phase 7 |
| D-04 | Product price list (per product, per city if different) | — | Commercial | Phase 5 |
| D-08 | Temporary-agent base salary pro-rating rule | Pro-rate by calendar days active; leave does not reduce | Finance | Phase 16 |
| D-10 | Confirm stock item spelling "BDCOM" | BDCOM | Stock Officer | Phase 5 |
| D-19 | Order of Champion / Top Sales / Hall of Fame | #1 Champion, #2 Top Sales, #3 Hall of Fame | Sales management | Phase 19 |
| D-20 | SMS/OTP provider (must reach Somaliland numbers) | — (spike to evaluate) | IT | Phase 3 |
| D-21 | Legacy customer and stock data: availability and format | — | IT / Sales Ops | Phase 11 |
| D-27 | KoboToolbox form IDs and fields | — | Market Research | Phase 18 |
| D-28 | Agent count and sales/day; data retention periods | 7 years financial/audit; 3 years leave attachments | Management / Legal | Phase 20 |
| D-29 | Branches, districts, areas and team structure | — | Sales Operations | Phases 4–5 |

# 16. Glossary

| Term | Meaning |
|---|---|
| Agent custody | Stock location representing equipment held by one agent. |
| Approved (sale) | A New sale that passed validation, or a Retention sale approved by Team Leader/Super Admin. |
| Audit event | A durable, immutable record that a rule fired (e.g., duplicate attempt). |
| Audit case | A reviewable investigation grouping one or more audit events and records. |
| Confirmed Issue | Case state meaning a policy violation was established; linked sales become ineligible. |
| Duplicate attempt | A submission blocked because its phone or Index matches an existing customer contrary to the identity rules. |
| Eligible sale | A sale meeting all conditions in §8.2. |
| EAT | East Africa Time, UTC+3, the business timezone. |
| Free-month sale | A sale with payment option "Pay 2 months, get 1 free". |
| Hold (payroll) | A payroll line that cannot be finalized while a linked audit case is Open or Under Review. |
| Index Number | Customer identifier required to be unique; definition OPEN (D-02). |
| Legacy import | One-time load of existing customers and stock before go-live. |
| New | Customer type for a customer not previously in the system. |
| Not Reached / Not Reviewed | Follow-up outcome when the customer could not be contacted / no outcome recorded by end of M+1. |
| Payroll cutoff | Last day (default 3rd of next month) for approvals to count in the previous month. |
| Product switch | Change of a customer's product between FTTA and FTTH; not a sale. |
| PWA | Progressive Web App — a website that can be installed on a phone like an app. |
| Retention | Customer type for an existing/returning customer; requires approval. |
| Risk flag | A rule hit that needs review; not proof of fraud. |
| RLS | Row Level Security — database rules restricting which rows each user can access. |
| Serial | Unique manufacturer serial number of a WiFi Router, BDCOM or CALIX unit. |
| Unit | One sale. Grand Total = number of eligible units. |

# Appendix A — Source-to-BRD Coverage

| Source brief section | Covered in this BRD |
|---|---|
| Login and user creation | 6.1–6.2 |
| Products/prices, settings, targets | 6.2–6.3 |
| Dashboard and sales registration | 6.4, 9 |
| Refunds and audit/duplicate detection | 6.5–6.6, 7 |
| Customer follow-up / Active-Expire | 6.7, 9 |
| Leave management | 6.8 |
| Payroll | 6.9, 8 |
| Product switch | 6.10 |
| Free-month compensation | 6.11 |
| Stock | 6.12 |
| Agent performance / rankings | 6.13 |
| Sales reports | 6.14, 9 |
| KoboToolbox integration | 6.15, 12 |
| Notifications and OTP | 6.16, 12 |

# Appendix B — Build Principles

- Validate critical rules in the database or trusted server code, not only in forms.
- One canonical sale record, linked to approvals, refunds, switches, stock movements, follow-up and audit cases.
- Never silently overwrite approved records; use correction or reversal workflows.
- Keep duplicate attempt, risk flag, confirmed issue and resolved case distinct.
- One shared eligible-sale definition used by every screen.
- Payroll and dashboard totals drill down to the records and rules that produced them.
- Seed test cases for duplicates, concurrent submissions, approval bypass, stock races, serial reuse, idempotent retry and payroll boundaries.

# Appendix C — Requirement Traceability (FR → Phase → UAT)

| Requirement group | SDD section | Roadmap phase | UAT |
|---|---|---|---|
| FR-AUTH-01…09 | 6 | 3 (deactivation: 4) | 01, 02, 14, 33 |
| FR-USER-01…08 | 7 | 4 (dropdowns: 5) | 14, 16 |
| FR-CONF-01, 03, 05 | 9 | 5 | 18 |
| FR-CONF-02, 04, 06 | 14 | 14 | 26 |
| FR-SALE-01…06, 08…16 | 10 | 7 | 03–05, 08, 09, 19–22, 30, 32 |
| FR-SALE-07 | 10.3 | 8 | 06, 36 |
| FR-REF-01…08 | 10.5 | 12 | 07, 17, 23 |
| FR-AUD-01…03 | 11 | 7 (event log), 9 | 03, 04 |
| FR-AUD-04…08 | 11 | 9 (hold effect: 16) | 31 |
| FR-FUP-01…07 | 13 | 13 | 13, 24 |
| FR-LEAVE-01…08 | 16 | 17 | 25 |
| FR-PAY-01…15 | 15 | 16 | 10, 11, 23, 31 |
| FR-SW-01…06 | 10.4 | 8 | 12, 34 |
| FR-FREE-01…04 | 10.2 | 7 | 19 |
| FR-STK-01, 02, 04…10 | 12 | 6 | 08, 09, 22 |
| FR-STK-03 | 12 | 7 | 08, 35 |
| FR-PERF-01…03 | 14.4 | 19 | 27 |
| FR-REP-01…05 | 14 | 10 (dashboard), 15 | 18, 28 |
| FR-KOB-01…05 | 17.2 | 18 | 15 |
| FR-NOT-01, 03, 05 | 18 | 9 (alerts), 8 (approvals) | 03 |
| FR-NOT-02, 04 | 17.1 | 3 | 01, 33 |
| FR-MIG-01…05 | 19 | 11 | 29 |

*End of BRD v1.1*
