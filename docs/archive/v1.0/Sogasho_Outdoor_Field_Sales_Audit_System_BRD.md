 **BUSINESS REQUIREMENTS  
DOCUMENT**

**Outdoor Field Sales, Performance Analytics  
& Audit Control System**

Prepared for Sogasho ISP

*Source baseline: “Outdoor sales & Audit System” requirements note,
dated 18 October 2026*

Version 1.0 \| Status: Draft for stakeholder validation

# Document Control

| **Field**                     | **Details**                                                                                                                         |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| Document                      | Business Requirements Document (BRD)                                                                                                |
| Product                       | Sogasho Outdoor Field Sales, Performance Analytics & Audit Control System                                                           |
| Business owner                | Sogasho ISP — Outdoor Sales / Commercial Department                                                                                 |
| Technology baseline in source | Next.js application with Supabase database                                                                                          |
| Operating cities in source    | Hargeisa, Burco, Berbera and Borama                                                                                                 |
| Version / status              | 1.0 — Draft for stakeholder validation                                                                                              |
| Primary source                | User-provided four-page “Outdoor sales & Audit System” PDF                                                                          |
| Audience                      | Management, Outdoor Sales, Super Admin, Team Leaders/Supervisors, Follow-up Team, Payroll/Finance, Stock Officer, Developers and QA |

## How to read this BRD

Source requirements are treated as the baseline and retained wherever
possible. Where this BRD adds acceptance criteria, fraud controls,
workflow detail, security safeguards or implementation recommendations
to make the product buildable, those additions are identified as
“Recommended control” or “Proposed clarification”. They are not
presented as confirmed existing Sogasho policy.

# Contents

- 1\. Executive summary

- 2\. Business context and objectives

- 3\. Scope and boundaries

- 4\. Stakeholders and roles

- 5\. End-to-end operating model

- 6\. Functional requirements by module

- 7\. Fraud, duplicate and audit control framework

- 8\. Business rules and calculations

- 9\. Reporting and dashboard requirements

- 10\. Data requirements and relationships

- 11\. Non-functional requirements

- 12\. Integrations

- 13\. Acceptance criteria and UAT

- 14\. Risks, assumptions and dependencies

- 15\. Delivery priorities and open decisions

# 1. Executive Summary

Sogasho requires a centralized Outdoor Field Sales, Performance
Analytics and Audit Control System for temporary and permanent field
agents operating in Hargeisa, Burco, Berbera and Borama. The source
brief calls for a Next.js application backed by Supabase, with a strong
focus on daily sales visibility, customer retention follow-up, stock
accountability, payroll calculations, target tracking, and detection of
duplicate or potentially fraudulent sales.

The system must make customer registration traceable from agent
submission through approval, inventory deduction, follow-up status,
audit investigation and payroll eligibility. Phone number and Index
Number are explicitly required to be unique. Retention registrations
require Team Leader or Supervisor approval. Refunds require Super Admin
approval. Temporary agents authenticate with phone number and password;
permanent agents use email and password. Temporary-agent sign-in OTP
notifications, audit alerts, KoboToolbox integration and agent leave
management are included in the source requirements.

The goal is not merely to digitize a sales spreadsheet. The system
should act as a controlled operational record: one customer/sale record,
validated stock movements, traceable approvals, explainable fraud flags,
reconciled reporting and payroll totals generated from verified records.

# 2. Business Context and Objectives

## 2.1 Business problem

- Management needs daily and period-based performance visibility by
  agent, city, product, branch, price and customer type.

- Duplicate customer phone numbers or Index Numbers must not be
  registered as new independent sales, and suspected duplicate activity
  must be escalated for investigation.

- Retention registrations need an approval control to prevent unapproved
  or misclassified retention activity.

- Customer follow-up in the second month must distinguish customers who
  remain active from those who expire.

- Stock issued to customers must be deducted from available balances and
  reconciled against stock received from the Stock Officer.

- Payroll should be calculated from recorded sales, approved customer
  classifications and configured incentive rules rather than manually
  re-keyed totals.

- Refunds and product switches need controlled workflows and clear
  records.

## 2.2 Business objectives

| **ID** | **Objective**                                              | **Evidence of achievement**                                                                    |
|--------|------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| BO-01  | Provide one operational source of truth for outdoor sales. | Sales, customer, stock, approval and audit records are linked and searchable.                  |
| BO-02  | Prevent duplicate customer registration.                   | Unique phone and Index constraints reject duplicates; attempts create audit events and alerts. |
| BO-03  | Improve fraud visibility and investigation.                | Review queue shows risk reason, related records, timestamps and investigator disposition.      |
| BO-04  | Track sales and targets daily.                             | Dashboards compare actuals with agent targets and KPIs by city, product and period.            |
| BO-05  | Improve customer follow-up.                                | A dedicated list supports Active/Expire outcomes and follow-up team workflow.                  |
| BO-06  | Improve stock accountability.                              | Receipts, allocations, issues and balances reconcile with an immutable movement history.       |
| BO-07  | Standardize payroll calculations.                          | System-calculated totals, incentive eligibility and payroll summaries are reproducible.        |
| BO-08  | Bring market-survey data into the same workspace.          | KoboToolbox data is imported or synchronized with source and sync status visible.              |

## 2.3 Success measures to baseline

The source does not provide numeric service-level targets or a current
baseline for fraud, data quality, adoption or reporting speed.
Management should approve measurable targets before go-live. Suggested
measures include duplicate attempts blocked, percentage of sales with
complete evidence, unresolved audit cases, stock variance, follow-up
completion rate, payroll correction rate and dashboard freshness.

# 3. Scope and Boundaries

## 3.1 In scope

- Login and authentication for temporary and permanent agents; forced
  first-login password change for system-generated temporary passwords.

- User creation, activation/deactivation, roles, permissions,
  dashboard/module access and configurable dropdowns.

- Product and sale-price setup by Super Admin.

- Agent target and KPI assignment.

- Sales registration, customer identity uniqueness,
  city/branch/product/price capture, stock issued and New/Retention
  classification.

- Retention approval; refund approval; customer follow-up and
  Active/Expire status.

- Audit queue for duplicate/fraud indicators and notifications to Super
  Admin.

- Leave request, approval and attachment of Super Admin-signed leave
  record.

- Payroll month processing and automatic calculations based on recorded
  agent sales.

- FTTA/FTTH product switch workflow and stock issuance.

- Free-month compensation classification for qualifying \$50 payments,
  as described in the source.

- Stock receipt, deduction and balance reporting for WiFi Router,
  BPDCOM and CALIX.

- Agent performance rankings/badges, sales reports, KoboToolbox
  integration, notification and OTP API integration.

## 3.2 Out of scope unless separately approved

- Replacing Sogasho's core billing, CRM, payment collection or
  provisioning platform.

- Automated confirmation of whether a customer's internet service is
  technically active, unless a source system/API is identified and
  integrated.

- Automated bank/mobile-money disbursement of payroll or refunds.

- GPS tracking, live route monitoring, biometric attendance, photo-based
  identity checks or offline-first mobile synchronization; these are not
  specified in the source.

- Machine-learning fraud decisions. The source asks for intelligent
  detection; this BRD defines deterministic controls first. Any ML model
  requires data, governance and validation.

- Customer self-service portal or external customer application.

# 4. Stakeholders and Roles

| **Role**                    | **Core responsibilities**                                                                                                                                             | **Access principles**                                                                      |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Super Admin                 | Create/manage users, products/prices, permissions, targets; approve refunds; oversee dashboards; receive fraud alerts; manage leave approvals and signed attachments. | Full administrative access subject to audit logging; privileged actions must be traceable. |
| Temporary Sales Agent       | Sign in with phone and password; register sales/customers; see own permitted work and performance.                                                                    | Own records and permitted modules only; OTP required at sign-in as configured.             |
| Permanent Sales Agent       | Sign in with email and password; register sales/customers; see own permitted work and performance.                                                                    | Own records and permitted modules only.                                                    |
| Team Leader / Supervisor    | Approve retention registrations; support agent oversight and investigations if granted.                                                                               | Approval and team scope configured by Super Admin.                                         |
| Follow-up Team              | Work the second-month customer list and record Active/Expire outcome.                                                                                                 | Only required customer fields and follow-up status, per source.                            |
| Stock Officer               | Issue/receive stock to the field operation; source says stock is received from Stock Officer.                                                                         | Stock receipt/assignment access to be explicitly configured.                               |
| Payroll / Finance Reviewer  | Review generated payroll summaries and totals.                                                                                                                        | Read/review/export access; approval/sign-off workflow is a proposed clarification.         |
| Auditor / Management Viewer | Review audit trails, fraud cases, trends and reports.                                                                                                                 | Read-only by default; case disposition access only if assigned.                            |

Proposed clarification: the source explicitly defines Super Admin but
does not fully define permissions for Team Leader/Supervisor, Stock
Officer, Follow-up Team or Payroll. These role permissions must be
confirmed in the Settings module before development is finalized.

# 5. End-to-End Operating Model

1.  Super Admin configures cities, branches, products, sale prices,
    customer types, user accounts, permissions, agent targets and KPIs.

2.  Agent signs in using the account type's required identifier;
    temporary agent OTP is verified if enabled, and first-login
    temporary password change is mandatory.

3.  Agent registers a customer and sale. The system validates required
    fields, product/price configuration, customer identity uniqueness,
    city/branch defaults and any required approval.

4.  New registrations may proceed subject to validation. Retention
    registrations remain pending until Team Leader/Supervisor approval.

5.  Where equipment is issued, the system records the specific stock
    type and quantity, creates a stock movement and updates the
    available balance atomically.

6.  System generates duplicate/risk events and notifies Super Admin when
    configured rules are triggered.

7.  Follow-up team receives eligible customer records for the
    second-month review and records Active or Expire.

8.  Sales, stock, approvals, refunds, switches, follow-up and audit
    events feed reports and the payroll calculation preview.

9.  Payroll is calculated from eligible records for the selected month;
    exceptions and reconciliation mismatches must be resolved before
    finalization.

# 6. Functional Requirements

## 6.1 Login and Authentication

| **ID**     | **Requirement**                                                                                                                           |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| FR-AUTH-01 | The system shall support temporary and permanent agent account types.                                                                     |
| FR-AUTH-02 | Temporary agents shall sign in using phone number and password.                                                                           |
| FR-AUTH-03 | Permanent agents shall sign in using email and password.                                                                                  |
| FR-AUTH-04 | When Super Admin creates a user, the system shall generate a temporary password and require a password change at first login.             |
| FR-AUTH-05 | The system shall support OTP API integration for temporary-agent sign-in.                                                                 |
| FR-AUTH-06 | The system shall prevent deactivated users from signing in and invalidate active sessions after deactivation.                             |
| FR-AUTH-07 | The system shall record successful and failed login attempts, password changes and OTP outcomes as security events. (Recommended control) |

## 6.2 Users, Roles and Settings

| **ID**     | **Requirement**                                                                                                          |
|------------|--------------------------------------------------------------------------------------------------------------------------|
| FR-USER-01 | Super Admin shall create and maintain user accounts.                                                                     |
| FR-USER-02 | Super Admin shall assign roles, permissions, dashboard access and module access.                                         |
| FR-USER-03 | Super Admin shall activate or disable users.                                                                             |
| FR-USER-04 | Super Admin shall manage customer types and configurable dropdown options.                                               |
| FR-USER-05 | The system shall apply permissions on the server/database layer, not only hide interface elements. (Recommended control) |
| FR-USER-06 | User changes to roles, permissions and status shall be recorded in an audit log. (Recommended control)                   |

## 6.3 Products, Prices and Targets

| **ID**     | **Requirement**                                                                                                                         |
|------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| FR-CONF-01 | Super Admin shall create and maintain products and sale prices.                                                                         |
| FR-CONF-02 | Super Admin shall assign targets and KPIs to each sales agent.                                                                          |
| FR-CONF-03 | The system shall retain the applicable price on each sale so later price changes do not rewrite historical sales. (Recommended control) |
| FR-CONF-04 | Target assignments shall include agent, period, KPI definition, target value and effective dates. (Proposed clarification)              |

## 6.4 Sales Registration

| **ID**     | **Requirement**                                                                                                                                  |
|------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-SALE-01 | Sales form shall capture Customer Name, Phone Number, Index Number, District, Area, City, Product, Price, Branch, Stock Given and Customer Type. |
| FR-SALE-02 | District shall be selected from a dropdown.                                                                                                      |
| FR-SALE-03 | City shall default to the agent's assigned location, with changes restricted by permission. (Recommended control)                                |
| FR-SALE-04 | Phone Number shall be unique according to the approved normalization rule.                                                                       |
| FR-SALE-05 | Index Number shall be unique.                                                                                                                    |
| FR-SALE-06 | Customer Type shall include New and Retention.                                                                                                   |
| FR-SALE-07 | Retention registration shall require Team Leader/Supervisor approval before it is treated as approved/eligible.                                  |
| FR-SALE-08 | Stock Given shall support WiFi Router, BDCOM and CALIX, using standardized inventory item names.                                                 |
| FR-SALE-09 | System shall store creator, submission time, approval state, timestamps and change history. (Recommended control)                                |
| FR-SALE-10 | The system shall display a clear validation message when a duplicate or invalid record is rejected.                                              |

## 6.5 Refunds

| **ID**    | **Requirement**                                                                                                                                 |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-REF-01 | Refund request shall capture Customer Name, Phone Number, Index, Product Purchased, Refund Amount, Reason and Branch.                           |
| FR-REF-02 | Reason dropdown shall include Out of boundary, Technical delay, Refused, No signal and Other.                                                   |
| FR-REF-03 | Every refund request shall require Super Admin approval.                                                                                        |
| FR-REF-04 | Pending, approved and rejected refund states shall be visible; decision maker, date, amount and reason shall be retained. (Recommended control) |
| FR-REF-05 | Refund approval shall not silently delete the original sale; it shall create a linked reversal/adjustment record. (Recommended control)         |

## 6.6 Audit and Duplicate/Fraud Detection

| **ID**    | **Requirement**                                                                                                                                                                                          |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-AUD-01 | The system shall prevent duplicate Phone Number and Index Number values from being accepted as separate customer registrations.                                                                          |
| FR-AUD-02 | A duplicate attempt shall generate a reviewable audit event and notify Super Admin, as required by the source.                                                                                           |
| FR-AUD-03 | Audit event shall show rule triggered, attempted record, matching record(s), agent, date/time and current case status. (Recommended control)                                                             |
| FR-AUD-04 | Authorized investigators shall be able to mark a case Open, Under Review, Confirmed Issue, False Positive or Resolved. (Proposed clarification)                                                          |
| FR-AUD-05 | The system shall preserve evidence and event history; users shall not be able to erase their own audit events. (Recommended control)                                                                     |
| FR-AUD-06 | The system shall distinguish a blocked duplicate attempt from a confirmed fraudulent sale; a duplicate is a risk indicator and requires investigation before being labelled fraud. (Recommended control) |

## 6.7 Customers and Follow-up

| **ID**    | **Requirement**                                                                                                                                            |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-FUP-01 | The system shall provide a separate follow-up list for customers registered in their first month and due for second-month review.                          |
| FR-FUP-02 | Follow-up list shall show only Customer Name, Index, Phone Number, Branch, City and Customer Type, plus the Active/Expire dropdown required by the source. |
| FR-FUP-03 | Follow-up user shall record Active or Expire outcome.                                                                                                      |
| FR-FUP-04 | The system shall report counts and rates for Active and Expire outcomes.                                                                                   |
| FR-FUP-05 | System shall record who completed follow-up and when. (Recommended control)                                                                                |
| FR-FUP-06 | Eligibility timing and handling of missed/unknown outcomes shall be configurable and approved by the business. (Proposed clarification)                    |

## 6.8 Leave Management

| **ID**      | **Requirement**                                                                                                                           |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| FR-LEAVE-01 | Super Admin shall be able to assign annual leave to an agent and approve leave requests.                                                  |
| FR-LEAVE-02 | Leave form shall include Employee Name, Department (default Outdoor), date range, number of days, reason, Leave Type and file attachment. |
| FR-LEAVE-03 | Leave Type options shall include Annual, Sick Leave and Maternity Leave.                                                                  |
| FR-LEAVE-04 | The system shall support attaching the signed-by-Super-Admin leave document.                                                              |
| FR-LEAVE-05 | Leave status and approval history shall be retained. (Recommended control)                                                                |

## 6.9 Payroll

| **ID**    | **Requirement**                                                                                                                                                           |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-PAY-01 | Payroll shall be processed by payroll month and agent.                                                                                                                    |
| FR-PAY-02 | Payroll shall show Agent Name, City, FTTA units, FTTH units, FTTB units, LTE units, Grand Total, New, Retention, Revenue, Incentive, Base Salary and Gross Pay.           |
| FR-PAY-03 | FTTA/FTTH/FTTB/LTE unit counts and New/Retention counts shall be selected or derived from system sales records, not re-keyed without validation.                          |
| FR-PAY-04 | Grand Total shall be automatically calculated as the sum of the four product-unit counts.                                                                                 |
| FR-PAY-05 | New plus Retention counts must equal Grand Total; any mismatch shall be flagged and the payroll row shall not be finalized.                                               |
| FR-PAY-06 | Incentive shall be system-generated based on the source rule: \$5 per sale after reaching 15 units. Exact threshold calculation must be confirmed (see open decisions).   |
| FR-PAY-07 | Temporary-agent base salary shall be \$100; permanent staff base salary is not included in this source rule, and their incentive is \$5 per sale after reaching 15 sales. |
| FR-PAY-08 | Gross Pay shall equal Base Salary plus Incentive.                                                                                                                         |
| FR-PAY-09 | Payroll summary shall show totals for FTTA, FTTH, FTTB, LTE, New, Retention, Revenue, Incentive, Base Salary and Gross Pay.                                               |
| FR-PAY-10 | Payroll calculations shall be reproducible from the underlying sales records and configuration in force for that payroll period. (Recommended control)                    |

## 6.10 Product Switch

| **ID**   | **Requirement**                                                                                                                                              |
|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-SW-01 | Switch form shall capture original customer name, phone, Index, branch and city, plus From Product (FTTA or FTTH).                                           |
| FR-SW-02 | Switch form shall capture destination customer name, phone, Index, branch, city, To Product (FTTA or FTTH) and stock given.                                  |
| FR-SW-03 | The system shall validate that customer name, phone and Index information is consistent between source and destination records before completing the switch. |
| FR-SW-04 | Switch shall be recorded as one linked transaction with before/after product details and any stock movement. (Recommended control)                           |
| FR-SW-05 | The system shall prevent invalid same-product switches unless the business explicitly allows them. (Proposed clarification)                                  |

## 6.11 Free-Month Compensation

| **ID**     | **Requirement**                                                                                                                                                     |
|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-FREE-01 | Free-month compensation shall be handled within sales registration rather than as a separate module.                                                                |
| FR-FREE-02 | The source identifies qualifying payments of \$50 where a customer pays two months in advance and receives one month free.                                          |
| FR-FREE-03 | The system shall provide a clear flag or classification for this case so reporting does not mistake it for a standard sale. (Recommended control)                   |
| FR-FREE-04 | Eligibility evidence, whether \$50 is a fixed qualifying amount and how the free month affects revenue shall be confirmed by the business. (Proposed clarification) |

## 6.12 Stock

| **ID**    | **Requirement**                                                                                                                             |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| FR-STK-01 | The system shall record stock received from the Stock Officer.                                                                              |
| FR-STK-02 | Stock categories shall include WiFi Router, BDCOM/PDCOM (standard name to confirm) and CALIX.                                               |
| FR-STK-03 | When stock is given to a customer for a New or Retention sale, the system shall deduct the applicable quantity from available stock.        |
| FR-STK-04 | Stock report shall compare stock received with issued quantities and current balance.                                                       |
| FR-STK-05 | System shall prevent issuing more stock than is available, unless an explicitly authorized exception is configured. (Recommended control)   |
| FR-STK-06 | Each movement shall record item, quantity, source/destination, linked sale/switch, user, timestamp and movement type. (Recommended control) |
| FR-STK-07 | Stock adjustment shall require reason and authorized approval, with an audit trail. (Recommended control)                                   |

## 6.13 Agent Performance and Recognition

| **ID**     | **Requirement**                                                                                                                                       |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-PERF-01 | System shall show top-performing agents and support Champion, Hall of Fame and Top Sales titles for the top three performers.                         |
| FR-PERF-02 | System shall identify top-selling product and top-selling branch.                                                                                     |
| FR-PERF-03 | Ranking rules shall use approved metrics and period; ties and disqualified/under-review sales shall be handled consistently. (Proposed clarification) |

## 6.14 Sales Reports and Performance

| **ID**    | **Requirement**                                                                                                                          |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------|
| FR-REP-01 | Reports shall filter or group by city, product, price, agent, week, month, quarter, six months and one year.                             |
| FR-REP-02 | Reports shall show Active versus Expire status for New and Retention customer categories.                                                |
| FR-REP-03 | Reports shall support totals and drill-down to the underlying records, subject to permissions. (Recommended control)                     |
| FR-REP-04 | Export formats, time zone, date-boundary rules and retention periods shall be confirmed during solution design. (Proposed clarification) |

## 6.15 KoboToolbox Survey Integration

| **ID**    | **Requirement**                                                                                                                                                                       |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-KOB-01 | System shall integrate with KoboToolbox so survey and market-insight data can be managed from one place.                                                                              |
| FR-KOB-02 | Integration shall display sync status, source submission identifier, submission time and import errors. (Recommended control)                                                         |
| FR-KOB-03 | System shall define which survey fields are stored, who can view them, how duplicate submissions are identified and whether updates flow one-way or two-way. (Proposed clarification) |
| FR-KOB-04 | Survey data shall remain distinguishable from sales/customer registration records unless a governed matching process is approved. (Recommended control)                               |

## 6.16 Notifications and OTP

| **ID**    | **Requirement**                                                                                                                                               |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-NOT-01 | System shall notify Super Admin about duplicate/fraud detection events.                                                                                       |
| FR-NOT-02 | System shall integrate an OTP API for temporary-agent sign-in.                                                                                                |
| FR-NOT-03 | Notification channel, retry policy, delivery status, provider and escalation timing shall be configurable once provider is selected. (Proposed clarification) |
| FR-NOT-04 | OTP codes shall expire, be rate-limited and never be stored in plaintext. (Recommended control)                                                               |

# 7. Fraud, Duplicate and Audit Control Framework

The source requires clear duplicate detection and Super Admin
notifications, with phone number and Index Number never duplicated. The
controls below translate that requirement into an implementable control
framework. A duplicate attempt should be blocked immediately; it should
not automatically be treated as proven fraud without investigation.

| **Control**                      | **System behaviour**                                                                                                                                                                      | **Priority** |
|----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| Unique identity controls         | Normalize phone numbers under an agreed country-code format; enforce database-level uniqueness on normalized phone and Index Number. Reject conflicting submissions with a clear message. | Must         |
| Concurrent submission protection | Enforce uniqueness at database level so two agents submitting simultaneously cannot create duplicate records.                                                                             | Must         |
| Duplicate attempt alert          | Create a durable audit event and notify Super Admin with attempted agent, time, duplicate field and matching record reference.                                                            | Must         |
| Sales attribution review         | Show submitting agent, creation time, approval history and permitted audit metadata to support investigation of questionable attribution.                                                 | Should       |
| Retention approval               | Keep retention record pending until Team Leader/Supervisor decision; do not count it as approved payroll-eligible retention until approved.                                               | Must         |
| Stock reconciliation             | Compare opening balance + receipts + approved adjustments - issues = closing balance; surface variance.                                                                                   | Must         |
| Refund traceability              | Approval creates linked refund/reversal record; original sale remains traceable.                                                                                                          | Must         |
| Payroll integrity                | Reconcile product totals and New + Retention to grand total; block finalization on mismatch.                                                                                              | Must         |
| Tamper-evident audit trail       | Record important create/update/delete attempts, approvals, overrides, exports and configuration changes; restrict modification of logs.                                                   | Should       |
| Risk case workflow               | Assign owner, status, notes, evidence links and final disposition to each review case.                                                                                                    | Should       |

## 7.1 Proposed risk rules beyond hard duplicates

These are recommendations, not explicit source requirements. Enable them
only after the business approves the rules and false-positive handling.

- Unusual concentration of registrations by one agent, customer phone
  pattern or narrow time window.

- Repeated attempts to register the same Index or phone under different
  agents.

- Retention records submitted without required approval or edited after
  approval.

- Sales with missing stock movement where stock is required, or stock
  movements not linked to a sale/switch.

- Unexpected changes to sale price, customer type, city, branch or
  product after submission.

- High refund rate by agent, product, branch or reason over an approved
  observation window.

- Follow-up outcomes repeatedly missing or unusually concentrated in one
  status.

- Payroll totals inconsistent with verified sales, approval state or
  stock evidence.

## 7.2 Audit case states

| **State**       | **Meaning**                                                        |
|-----------------|--------------------------------------------------------------------|
| New / Open      | Rule fired; not yet reviewed.                                      |
| Under Review    | An authorized reviewer is investigating.                           |
| Confirmed Issue | Evidence supports a policy violation or invalid transaction.       |
| False Positive  | Investigation found a legitimate explanation.                      |
| Resolved        | Required correction/action is complete; history remains available. |

# 8. Business Rules and Calculations

| **Rule ID** | **Business rule**                                                                                                                                                                                                                                       |
|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| BR-01       | A customer Phone Number and Index Number must each be unique for accepted customer registrations. Define whether phone uniqueness is global across all customer records or only active records; source wording indicates global uniqueness.             |
| BR-02       | Retention sale registration requires Team Leader/Supervisor approval before final acceptance.                                                                                                                                                           |
| BR-03       | Refund requests require Super Admin approval.                                                                                                                                                                                                           |
| BR-04       | City defaults from the agent's assigned location.                                                                                                                                                                                                       |
| BR-05       | Grand Total = FTTA + FTTH + FTTB + LTE units.                                                                                                                                                                                                           |
| BR-06       | New count + Retention count must equal Grand Total; otherwise payroll is invalid and must be flagged.                                                                                                                                                   |
| BR-07       | Gross Pay = Base Salary + Incentive.                                                                                                                                                                                                                    |
| BR-08       | Temporary-agent base salary = \$100 per payroll month, subject to approved eligibility/attendance rules if any.                                                                                                                                         |
| BR-09       | Permanent-staff base salary is not specified in the source; incentive rule is specified as \$5 per sale after reaching 15 sales.                                                                                                                        |
| BR-10       | Incentive rule confirmed by the business: incentive is \$5 per qualifying sale above the 15-unit threshold. The first 15 units do not earn incentive. Formula: MAX(0, eligible units - 15) × \$5, subject to the approved definition of eligible sales. |
| BR-11       | Stock balance = opening balance + receipts + approved adjustments - issues/consumption; do not permit negative balances by default.                                                                                                                     |
| BR-12       | Product switch must retain source and destination product and consistent customer identity.                                                                                                                                                             |
| BR-13       | Free-month compensation is within sales registration; source cites a \$50 payment for two months in advance plus one free month.                                                                                                                        |
| BR-14       | Only approved, non-reversed sales should contribute to final payroll and performance rankings; this is a recommended control requiring business sign-off.                                                                                               |

## 8.1 Incentive examples requiring approval

| **Interpretation**                          | **At 14 units** | **At 15 units** | **At 20 units** |
|---------------------------------------------|-----------------|-----------------|-----------------|
| Confirmed rule — \$5 for each unit above 15 | \$0             | \$0             | \$25            |

Business clarification received: the incentive applies only to sales
above the 15-unit threshold. The system shall calculate incentive as
MAX(0, eligible sales units − 15) × \$5. Example: 14 units = \$0; 15
units = \$0; 20 units = \$25. The definition of eligible sales (for
example, approved and non-reversed sales) should follow the approved
payroll policy.

# 9. Dashboard and Reporting Requirements

## 9.1 Super Admin dashboard

The dashboard must be interactive and provide daily performance views,
as well as month-to-date and overall totals. Source-required metrics:

- Sales units sold; units per product; revenue generated.

- Performance by city and overall sales/revenue.

- New customers and retention customers: overall and this month.

- Monthly sales and monthly revenue.

- Agent targets and KPI progress.

- Top-selling product, top-selling branch and top-three agent
  recognition.

- Audit alerts, duplicate attempts and unresolved cases (audit summary
  is a recommended addition).

- Stock received, issued, balance and variances (recommended dashboard
  addition).

## 9.2 Report catalogue

| **Report**              | **Required dimensions / measures**                                                                   | **Primary users**                |
|-------------------------|------------------------------------------------------------------------------------------------------|----------------------------------|
| Sales performance       | City, product, price, agent, branch, week, month, quarter, six months, year; units and revenue.      | Super Admin, Management          |
| Customer classification | New vs Retention; Active vs Expire; city, branch, agent and period.                                  | Sales, Follow-up, Management     |
| Agent performance       | Actual vs target, KPI attainment, product mix, New/Retention, revenue and rank.                      | Super Admin, Sales Leads         |
| Audit and duplicates    | Attempts, matched identity, triggering rule, assigned investigator, case status and disposition.     | Super Admin, Auditor             |
| Refunds                 | Requested/approved/rejected amounts, reason, branch, product and approver.                           | Super Admin, Finance             |
| Stock reconciliation    | Opening balance, receipts, issues, adjustments, closing balance and variance by item/location.       | Stock Officer, Super Admin       |
| Payroll summary         | Product totals, New, Retention, revenue, incentive, base salary and gross pay; monthly grand totals. | Payroll/Finance, Super Admin     |
| Follow-up outcome       | Due, completed, Active, Expire and not-yet-reviewed counts.                                          | Follow-up, Management            |
| Leave report            | Requests, approved periods, leave type, days and attachments status.                                 | Super Admin, HR/authorized users |
| Survey insights         | KoboToolbox submissions, sync status and approved market-insight fields.                             | Market Research, Management      |

## 9.3 Dashboard usability requirements

- Filters should be consistent across dashboards and clearly show the
  selected time range and city/branch scope.

- Clicking a chart segment should open the corresponding authorized
  detail list.

- Show metric definitions and distinguish submitted, approved, reversed
  and under-review transactions.

- Provide empty states, loading states and clear errors; do not display
  stale data as current without a freshness indicator.

- Charts must remain usable on desktop and mobile-sized screens.

# 10. Data Requirements and Relationships

## 10.1 Core records

| **Entity**                 | **Key data / relationships**                                                                                                                   |
|----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| User / Agent               | User ID, agent type, name, phone/email login identifier, city, branch/team, role, active status, first-login password-change flag.             |
| Role / Permission          | Role name, module permissions, dashboard scope, approval permissions.                                                                          |
| Product / Price            | Product code/name, active status, price, effective dates, allowed city/branch or sale type if applicable.                                      |
| Target / KPI               | Agent, period, KPI, target value, effective dates, creator.                                                                                    |
| Customer                   | Customer name, normalized phone, Index Number, district, area, city, branch, current customer classification and follow-up state.              |
| Sale                       | Sale ID, customer, agent, product, price snapshot, branch/city, New/Retention, submission status, timestamps, approval, reversal/refund links. |
| Approval                   | Entity type/ID, approval type, requested by, decided by, decision, reason, timestamps.                                                         |
| Audit Event / Case         | Rule, triggering event, user, related records, details, case owner, state, investigation notes, resolution.                                    |
| Stock Item / Movement      | Item, quantity, movement type, source/destination, linked sale/switch, actor, timestamp, approval where applicable.                            |
| Refund                     | Original sale/customer, amount, reason, requested by, approval state, approver, linked reversal.                                               |
| Product Switch             | Customer identity, from/to product, old/new stock movement, actor, date and state.                                                             |
| Follow-up                  | Customer, due period, Active/Expire outcome, reviewer, date and notes if approved.                                                             |
| Leave Request              | Agent, date range, days, type, reason, status, attachment, approver.                                                                           |
| Payroll Run / Payroll Line | Month, agent, source sales, product counts, New/Retention counts, revenue, incentive, base salary, gross pay, validation state.                |
| Survey Submission          | Kobo submission ID, form ID, source timestamp, selected mapped fields, sync status, source payload reference.                                  |

## 10.2 Data integrity rules

- Use stable internal IDs; do not use phone number or Index Number as
  the database primary key.

- Store phone numbers in a normalized canonical form while preserving a
  display form where needed.

- Use database-level uniqueness and transactional stock deductions.

- Use explicit status fields and timestamps for submitted, pending
  approval, approved, rejected, reversed and archived records.

- Preserve history for changes to price, role, agent location, approvals
  and transaction states.

- Use soft archival or controlled reversal for business records rather
  than hard deletion where a financial, stock or audit trail exists.

# 11. Non-Functional Requirements

| **Category**        | **Requirement**                                                                                                                                                                 |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Security            | Role-based access control, least privilege, secure password hashing via the authentication provider, OTP rate limiting, secure session handling and server-side authorization.  |
| Privacy             | Only expose the limited customer fields required for each role; protect phone numbers and survey responses; define access, retention and export rules.                          |
| Integrity           | Database constraints for unique phone/index; transactional stock movement; atomic approval/state changes; reproducible payroll calculation.                                     |
| Auditability        | Record privileged actions, approvals, rejected attempts, configuration changes and exports with actor and timestamp.                                                            |
| Performance         | Interactive dashboards and common lists should be responsive under the agreed expected data volume; performance targets must be set after volume and concurrency are estimated. |
| Availability        | Define uptime, backup frequency, recovery point objective (RPO) and recovery time objective (RTO) before production.                                                            |
| Usability           | Simple forms, clear validation messages, low-friction agent workflow, accessible labels and responsive layout.                                                                  |
| Compatibility       | Support current major desktop and mobile browsers; confirm whether agents need a dedicated mobile application or responsive web app.                                            |
| Scalability         | Data model and reporting should accommodate additional cities, branches, agents, products and survey forms without redesign.                                                    |
| Maintainability     | Use Next.js and Supabase as the stated baseline; document environment setup, migrations, API integrations and release process.                                                  |
| Localization        | Confirm currency display, date format, timezone, Somali/English language needs and phone-number country-code rules.                                                             |
| Backup and recovery | Automated backups, tested restoration and a documented incident recovery procedure are recommended.                                                                             |

# 12. Integrations

| **Integration**         | **Purpose**                                                                  | **Requirements / dependencies**                                                                                                    |
|-------------------------|------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Supabase                | Database and likely authentication/storage services within the stated stack. | Define schema, row-level security, migration process, backup plan and privileged server-side operations.                           |
| OTP / Notification API  | Temporary-agent OTP and duplicate/fraud notifications.                       | Provider, sender ID, cost, supported country routes, delivery receipts, retry limits and outage handling must be selected.         |
| KoboToolbox             | Centralize survey/market-insight submissions.                                | API credentials, form IDs, field mapping, sync frequency, pagination, duplicate handling, edit/deletion behaviour and error queue. |
| File attachment storage | Leave documents and signed approvals.                                        | Storage location, access policy, file type/size limits, malware scanning and retention period to be agreed.                        |

# 13. Acceptance Criteria and User Acceptance Testing

| **Test ID** | **Scenario**                                                            | **Expected result**                                                                                                          |
|-------------|-------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| UAT-01      | Temporary agent signs in with phone and generated password.             | Login succeeds; user is forced to change password on first login.                                                            |
| UAT-02      | Permanent agent signs in with email and password.                       | Login follows permanent-agent authentication rules.                                                                          |
| UAT-03      | Submit a sale with an already-registered normalized phone number.       | Submission is blocked; clear error and audit event are created; Super Admin notification is triggered.                       |
| UAT-04      | Submit a sale with a duplicate Index Number.                            | Submission is blocked; duplicate event references the matching record.                                                       |
| UAT-05      | Submit a Retention customer without approval.                           | Record remains pending and is excluded from approved metrics/payroll eligibility.                                            |
| UAT-06      | Supervisor approves a valid Retention record.                           | Approval identity/time are recorded and record becomes approved.                                                             |
| UAT-07      | Submit refund request.                                                  | Request cannot be finalized without Super Admin decision.                                                                    |
| UAT-08      | Issue stock for a sale with one router in stock.                        | Balance decreases by one in the same committed transaction as the stock movement.                                            |
| UAT-09      | Attempt to issue more stock than available.                             | System blocks the transaction or follows an explicitly approved exception process; no silent negative balance.               |
| UAT-10      | Enter payroll units whose product sum differs from New + Retention.     | System flags mismatch and blocks payroll finalization.                                                                       |
| UAT-11      | Calculate payroll at below, exactly at and above 15 units.              | System applies the signed-off incentive rule consistently and displays calculation detail.                                   |
| UAT-12      | Register a product switch with mismatched phone or Index.               | System rejects completion and explains the identity mismatch.                                                                |
| UAT-13      | Follow-up team completes a due customer as Active or Expire.            | Outcome and reviewer/time are recorded; report totals update.                                                                |
| UAT-14      | Super Admin deactivates an agent.                                       | Agent can no longer access the system; audit log records the change.                                                         |
| UAT-15      | KoboToolbox API returns an invalid submission or is unavailable.        | System records the error, preserves sync status and supports retry without creating duplicate imports.                       |
| UAT-16      | User without permission attempts to open restricted payroll/audit data. | Access is denied server-side and event is logged where appropriate.                                                          |
| UAT-17      | Refund is approved.                                                     | Original sale remains traceable; approved refund/reversal is reflected in reporting according to the agreed accounting rule. |
| UAT-18      | Generate a city/product/month report.                                   | Totals reconcile to the underlying authorized records and selected date range.                                               |

# 14. Risks, Assumptions and Dependencies

| **Type**   | **Item**                                                                         | **Response**                                                                                             |
|------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Risk       | Ambiguous incentive formula may produce payroll disputes.                        | Obtain written Finance/Management sign-off before implementation.                                        |
| Risk       | Phone numbers may be entered with inconsistent prefixes or formatting.           | Agree normalization and duplicate matching policy before data migration.                                 |
| Risk       | Duplicate customer records may already exist in legacy systems.                  | Perform a data-quality review and decide how to resolve existing duplicates before enforcing uniqueness. |
| Risk       | KoboToolbox form fields or API limits may change.                                | Version field mappings and build a visible retry/error queue.                                            |
| Risk       | Stock names vary in the source (BDCOM/PDCOM).                                    | Confirm the official inventory catalogue and use one canonical item code.                                |
| Assumption | The system is for Sogasho outdoor agents in Hargeisa, Burco, Berbera and Borama. | Confirm any other locations or branch structures.                                                        |
| Assumption | Next.js and Supabase remain the approved technology baseline.                    | Confirm hosting, authentication, file storage and deployment environment.                                |
| Dependency | OTP/notification provider selection.                                             | Business/IT to select provider and confirm delivery/cost requirements.                                   |
| Dependency | Definition of approved sale, reversal and payroll eligibility.                   | Sales, Finance and Management to agree policy.                                                           |
| Dependency | KoboToolbox access and form mapping.                                             | Provide API credentials and approved survey form definitions through secure channels.                    |
| Dependency | Role matrix and approval delegation.                                             | Super Admin/business owner to approve the permission matrix.                                             |

# 15. Delivery Priorities and Open Decisions

## 15.1 Recommended release priorities

| **Priority**                          | **Modules / capabilities**                                                                                                                                                                              | **Rationale**                                                                 |
|---------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| P0 — Go-live foundation               | Authentication, user/role management, products/prices, sales registration, unique phone/Index enforcement, retention approval, audit event creation, basic dashboard, stock movements and core reports. | Establish reliable transactions, control and visibility.                      |
| P1 — Operational control              | Follow-up list, refunds and approval, product switch, payroll calculation, leave management, agent performance rankings, notifications/OTP.                                                             | Complete the operational workflows specified in the source.                   |
| P2 — Integration and advanced insight | KoboToolbox integration, advanced audit case management, extended dashboard drill-downs, additional risk rules and management exports.                                                                  | Add integration depth and mature oversight after core data quality is proven. |

## 15.2 Open decisions requiring stakeholder sign-off

10. Does the \$5 incentive apply to every sale once the agent reaches 15
    units, only to units above 15, or as a flat threshold award?

11. Does a permanent agent receive any base salary in this payroll
    module, or should the system calculate incentive only?

12. Is the 15-unit threshold evaluated across all products combined, or
    separately per product?

13. Are sales counted at submission, approval, activation, payment
    confirmation or after customer follow-up?

14. Does “phone number must never be duplicated” mean global uniqueness
    across all time, including expired customers and corrected/recycled
    numbers?

15. What should happen when a legitimate customer changes phone number
    or a customer is reactivated?

16. Which roles can approve Retention registrations, and can the
    original submitting agent approve their own record?

17. Should refunds affect revenue, sales units, payroll incentive and
    rankings immediately upon approval or only after Finance
    reconciliation?

18. Which exact inventory name is correct: BDCOM or PDCOM? What are the
    stock units and quantities per sale/product?

19. How is city assigned if an agent temporarily works in another city,
    and who can override the default?

20. How is the follow-up month defined, and what happens when the
    follow-up team cannot reach a customer?

21. What is the required KoboToolbox sync direction and frequency, and
    which survey fields should be exposed in this system?

22. Which notification channels are required: SMS, email, in-app
    notification or a combination?

23. What are the approved retention period, backup policy, uptime
    target, performance target and data-export permissions?

24. Are Somali-language UI, offline operation, GPS evidence, photo
    evidence or field-device controls required for a later phase?

# Appendix A — Source-to-BRD Coverage

| **Source brief section**              | **Covered in this BRD** |
|---------------------------------------|-------------------------|
| Login and user creation               | 6.1–6.2                 |
| Products/prices, settings, targets    | 6.2–6.3                 |
| Dashboard and sales registration      | 6.4 and 9               |
| Refunds and audit/duplicate detection | 6.5–6.6 and 7           |
| Customer follow-up / Active-Expire    | 6.7 and 9               |
| Leave management                      | 6.8                     |
| Payroll                               | 6.9 and 8               |
| Product switch                        | 6.10                    |
| Free-month compensation               | 6.11                    |
| Stock                                 | 6.12                    |
| Agent performance / rankings          | 6.13                    |
| Sales reports                         | 6.14 and 9              |
| KoboToolbox integration               | 6.15 and 12             |
| Notifications and OTP                 | 6.16 and 12             |

# Appendix B — Recommended build principles

- Validate critical rules in the database or trusted server-side logic,
  not only in browser forms.

- Use one canonical sales record and link approvals, refunds, switches,
  stock movements, follow-up and audit cases to it.

- Do not silently overwrite approved records; use controlled correction
  or reversal workflows.

- Keep a clear distinction between a duplicate attempt, a risk flag, a
  confirmed policy violation and a resolved case.

- Make payroll and dashboard totals drillable to the records and rules
  that produced them.

- Ship with seeded test cases for duplicates, concurrent submissions,
  approval bypass attempts, stock race conditions and payroll boundary
  values.
