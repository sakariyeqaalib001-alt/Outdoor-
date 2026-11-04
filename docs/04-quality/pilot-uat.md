# Pilot UAT (Phase 11) — Phases 3–10 workflows

Run on **production** (Hargeisa) with real accounts before go-live, using one or two clearly named practice customers that are then rejected (never fake customers left approved). Tick each line; write defects in `docs/03-implementation/PHASE_LOG.md`.

| # | Scenario (BRD UAT) | Expected | Pass |
|---|---|---|---|
| 1 | Agent signs in with phone, temporary password and SMS code (UAT-01) | Forced password change, then the dashboard | ☐ |
| 2 | Staff signs in with email, password and SMS code (UAT-02) | Only after the code | ☐ |
| 3 | 5 wrong passwords (UAT-33) | Locked 15 minutes | ☐ |
| 4 | Super Admin deactivates a practice agent (UAT-14) | Signed out at once; cannot sign in | ☐ |
| 5 | Agent sees no Users, Settings, Audit or Approvals (UAT-16) | Not in the menu; direct address says "no access" | ☐ |
| 6 | New sale, then the same phone again (UAT-03, 21) | Blocked; Super Admin bell shows the audit alert | ☐ |
| 7 | New sale with the same Index Number (UAT-04) | Blocked; the case shows the matching customer | ☐ |
| 8 | Index with 7 or 9 digits or letters (UAT-37) | Rejected with a clear message | ☐ |
| 9 | Second sale for the same customer this month (UAT-32) | Blocked | ☐ |
| 10 | Submit twice quickly (UAT-30) | One sale only | ☐ |
| 11 | No date field; phone clock set to another month (UAT-42, 43) | Sale recorded with server time | ☐ |
| 12 | Free-month offer at $50 (UAT-19) | 1 unit, revenue $50, marked free-month | ☐ |
| 13 | Retention for an existing customer (UAT-20) | Linked to the same customer | ☐ |
| 14 | Submitted sale is Waiting; not on the dashboard as eligible (UAT-05) | Shown under "Waiting for approval" only | ☐ |
| 15 | Team Leader approves with one WiFi Router (UAT-06, 08) | Approved; team stock −1; dashboard This Month Sales +1 | ☐ |
| 16 | Approval when the team has no stock of that device (UAT-22) | Refused; nothing deducted | ☐ |
| 17 | Agent tries to approve own sale (UAT-36) | Denied | ☐ |
| 18 | Team Leader rejects a New sale (UAT-35) | No stock moved; phone and Index released | ☐ |
| 19 | Product switch FTTA → FTTH approved with a PDCOM (UAT-34) | Recorded; not a sale; stock −1 | ☐ |
| 20 | Switch with a wrong phone or Index (UAT-12) | Rejected with explanation | ☐ |
| 21 | Stock Officer receives, issues to a Supervisor, Supervisor accepts | Balances match; readiness opening stock difference 0 | ☐ |
| 22 | Audit case: start review → false positive → resolve | Sale unaffected; full history kept | ☐ |
| 23 | Dashboard per role: agent own, Team Leader team, Super Admin all, Stock Officer stock only | As described in `docs/06-operations/dashboard.md` | ☐ |
| 24 | Dashboard card → View sales | List count equals the card | ☐ |
| 25 | Alert email (if Brevo is set up) | Arrives within 5 minutes without anyone opening a page | ☐ |
| 26 | Practice sales rejected at the end | Nothing practice-made remains approved | ☐ |

Signed off by the business owner: name ______ date ______
