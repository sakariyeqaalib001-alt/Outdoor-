# Approvals, product switch and notifications (Phase 8)

## 1. Apply the database change — on BOTH sites

| Project | File | Expected |
|---|---|---|
| **Outdoor** | `supabase/sql-editor/20261025090000_approvals_switches.sql` | "Applied 20261025090000_approvals_switches successfully" |
| **Outdoor Training** | the same file | the same message |

Then restart the training site (stop it, `npm.cmd run training:build`, `npm.cmd run training:start`).

## 2. How it works (D-37, D-38)

| Who | Where | What |
|---|---|---|
| Agent | **Sales → New sale** | Registers the sale → "Waiting for approval". The Team Leader gets a notification (bell at the top right) |
| Team Leader / Outdoor Supervisor | **Approvals** | Sees the sales and switches of the teams they lead. Types the equipment given (WiFi Router, PDCOM, CALIX — the team's stock is shown), then **Approve** — the stock is taken from the team then. Or **Reject** with a reason |
| Super Admin | **Approvals** | Fallback for every team; decides Team Leaders' own sales; does **not** register sales or switches |
| Agent | **Product switch** | FTTA ↔ FTTH for an existing customer: name, phone and Index must match, "From" must be the current product, choose the new plan. Waits for the Team Leader, who records the new equipment. Never a sale |
| Everyone | **Bell / Notifications** | New items waiting for you, your sale/switch approved or rejected (with the reason), stock issued to your team |

A rejected **New** sale frees the customer's phone and Index (if the customer has no other sale), so the agent can register it again correctly. Nobody approves their own sale or switch.

## 3. Things to test (on staging)

You need: the test agent in a team whose **Team Leader** is another account; some accepted stock in that team (Stock).

| Test | Expected |
|---|---|
| As the agent: New sale | "Waiting for approval"; the Team Leader's bell shows 1 |
| As the Team Leader: **Approvals** → type 1 WiFi Router → **Approve** | "Approved…"; the sale shows Approved with "Approved by …"; the team's routers go down by 1; the agent gets a notification |
| Approve with more routers than the team has | "Your team does not have enough…"; the sale stays waiting |
| Another agent's Team Leader (other team) | Does not see the sale in Approvals |
| As the agent: New sale with wrong name → Team Leader **Reject** "Wrong name" | Agent notified with the reason; registering the same phone/Index again now works |
| As Super Admin: Sales → New sale | Message: Super Admins do not register sales |
| As Super Admin: Approvals → **Reject** your old test sale | Rejected (you may cancel your own; you can never approve your own) |
| As the agent: **Product switch** for an approved FTTA customer → To FTTH, plan SO-Home | "Waiting for approval"; Team Leader approves with 1 router → Approved; Sales count unchanged |
| Product switch with a wrong phone or Index | "Rejected: the phone and Index do not belong to the same existing customer" |
| Product switch "From FTTH" for an FTTA customer | "Rejected: From product is not the customer's current product" |
| Stock Officer issues stock to the team | The Team Leader's bell shows "Stock was issued to your team" |
