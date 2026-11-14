# Stock (Phase 6)

Stock is counted by **quantity** per item — WiFi Router, PDCOM, CALIX. There are **no serial numbers** (D-35).

```text
Central Store ──issue──▶ Outdoor Supervisor (counts for the team after the Supervisor accepts) ──sale──▶ customer
      ▲                         │
      └──── return (Stock Officer only; faulty units go to "Central Store — faulty")
```

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole file → **Run**:

1. `supabase/sql-editor/20261022150000_stock.sql` → "Applied 20261022150000_stock successfully"
2. `supabase/sql-editor/20261022170000_stock_supervisors.sql` → "Applied 20261022170000_stock_supervisors successfully" (Supervisor names for stock screens)

## 2. Who does what (sidebar → **Stock**)

| Tab | Who | What |
|---|---|---|
| **Overview** | Everyone with stock access | Stock on hand per location and item, plus "in transit" (sent, not yet accepted). Team Leaders and agents see only their own team. Deliveries waiting for you appear at the top with **Accept** |
| **Issue & receive** | Stock Officer | **Receive stock** into the Central Store; **Issue stock** to an Outdoor Supervisor; **Cancel issue** (with a reason) before it is accepted |
| | The receiving Outdoor Supervisor, or Super Admin | **Accept** once the items arrived — only then does the team's stock go up |
| **Returns & adjustments** | Stock Officer | **Record a return** from a team or a customer, with a reason (faulty, refund, product switch, Retention rejected, other) |
| | Stock Officer → Super Admin | **Request adjustment** (lost, damaged, miscount, with reason) → Super Admin **Approves** or **Rejects**. Nobody approves their own request |
| **Report & history** | Everyone with stock access | Report for chosen dates: summary by item (start, received from supplier, returned by customers, given to customers, adjustments, end; issued to Supervisors shown separately), a **received** list, an **issued** list and stock by location. Movement history (click to open): every movement, who and when — never changed or deleted |

When the Supervisor approves a sale (Phase 8), the equipment they record is taken from the **team's** accepted stock. Approval is refused if the team does not have enough (D-37).

## 3. Things to test

You need: a **Stock Officer** user (Users → edit a user → tick **Stock Officer**) and a team with an Outdoor Supervisor (the team's **Team Leader**, set on Users → Teams). You can give yourself the Stock Officer role for testing.

| Test | Expected |
|---|---|
| Issue & receive → **Receive stock**: 20 WiFi Router, 10 PDCOM, 5 CALIX | Overview: Central Store shows 20 / 10 / 5 |
| **Issue stock** to your test Outdoor Supervisor: 5 WiFi Router, 2 PDCOM | Central shows 15 / 8; the Supervisor shows 0 with "+5 in transit", "+2 in transit" |
| Sign in as that Outdoor Supervisor → Stock → **Accept** | The Supervisor's line shows 5 / 2; the issue says "Accepted" |
| Issue 100 CALIX | Refused: "Not enough stock at that location for this quantity." |
| Issue 1 CALIX, then **Cancel issue** with a reason | "Cancelled"; Central CALIX back to 5 |
| Returns → **Record a return**: from the team, 1 WiFi Router, reason Faulty | Team 4 routers; "Central Store — faulty" 1 |
| **Request adjustment**: Central Store, WiFi Router, −2, "Two units damaged in store" | "Waiting for approval"; the balance is unchanged |
| As the same person, try to approve it | No Approve button (you cannot approve your own request) |
| As another Super Admin (or ask the Stock Officer to request it) → **Approve** | Central routers go down by 2 |
| Report & history | The report adds up (end = start + received + returned by customers − given to customers ± adjustments); history lists every step with who did it |
| Sign in as the test agent | Stock shows only their team, no Receive/Issue/Return buttons |

## 4. Clearing test stock before go-live (one time)

`supabase/maintenance/reset_stock_test_data.sql` deletes every stock movement, issue and adjustment, so all balances are 0 again. Items, locations, teams and settings stay. Run it in the SQL Editor only while all stock so far is test data. It refuses once any sale exists, and the reset itself is recorded in `activity_log` and `change_log`. Then the Stock Officer enters the real opening stock with **Receive stock**.
