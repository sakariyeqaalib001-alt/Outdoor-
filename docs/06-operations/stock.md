# Stock (Phase 6)

Stock is counted by **quantity** per item — WiFi Router, PDCOM, CALIX. There are **no serial numbers** (D-35).

```text
Central Store ──send──▶ Team stock (counts after the Team Leader / Supervisor accepts) ──sale──▶ customer
      ▲                         │
      └──── return (Stock Officer only; faulty units go to "Central Store — faulty")
```

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole file → **Run**:

- `supabase/sql-editor/20261022150000_stock.sql` → "Applied 20261022150000_stock successfully"

## 2. Who does what (sidebar → **Stock**)

| Tab | Who | What |
|---|---|---|
| **Overview** | Everyone with stock access | Stock on hand per location and item, plus "in transit" (sent, not yet accepted). Team Leaders and agents see only their own team. Deliveries waiting for you appear at the top with **Accept** |
| **Deliveries** | Stock Officer | **Receive stock** into the Central Store; **Send to team**; **Cancel delivery** (with a reason) before it is accepted |
| | Team Leader / Supervisor of the receiving team, or Super Admin | **Accept** a delivery once the items arrived — only then does the team's stock go up |
| **Returns & adjustments** | Stock Officer | **Record a return** from a team or a customer, with a reason (faulty, refund, product switch, Retention rejected, other) |
| | Stock Officer → Super Admin | **Request adjustment** (lost, damaged, miscount, with reason) → Super Admin **Approves** or **Rejects**. Nobody approves their own request |
| **Report & history** | Everyone with stock access | Report for chosen dates: opening, received, in, out, issued, returned, adjusted, closing. Movement history: every movement, who and when — never changed or deleted |

Sales (Phase 7) take the items the agent picks from the **team's** accepted stock. A sale is refused if the team does not have enough.

## 3. Things to test

You need: a **Stock Officer** user (Users → edit a user → tick **Stock Officer**) and a team with a **Team Leader** (Phase 4). You can give yourself the Stock Officer role for testing.

| Test | Expected |
|---|---|
| Deliveries → **Receive stock**: 20 WiFi Router, 10 PDCOM, 5 CALIX | Overview: Central Store shows 20 / 10 / 5 |
| **Send to team** (your test team): 5 WiFi Router, 2 PDCOM | Central shows 15 / 8; the team shows 0 with "+5 in transit", "+2 in transit" |
| Sign in as that team's Team Leader → Stock → **Accept** | The team shows 5 / 2; the delivery says "Accepted" |
| Send 100 CALIX | Refused: "Not enough stock at that location for this quantity." |
| Send 1 CALIX, then **Cancel delivery** with a reason | "Cancelled"; Central CALIX back to 5 |
| Returns → **Record a return**: from the team, 1 WiFi Router, reason Faulty | Team 4 routers; "Central Store — faulty" 1 |
| **Request adjustment**: Central Store, WiFi Router, −2, "Two units damaged in store" | "Waiting for approval"; the balance is unchanged |
| As the same person, try to approve it | No Approve button (you cannot approve your own request) |
| As another Super Admin (or ask the Stock Officer to request it) → **Approve** | Central routers go down by 2 |
| Report & history | The report adds up (closing = opening + in − out); history lists every step with who did it |
| Sign in as the test agent | Stock shows only their team, no Receive/Send/Return buttons |
