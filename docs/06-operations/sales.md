# Sales registration (Phase 7)

## 1. Apply the database change — on BOTH sites

Paste into the Supabase **SQL Editor** → **New query** → **Run**, in each project:

| Project | File | Expected |
|---|---|---|
| **Outdoor** (staging) | 1. `supabase/sql-editor/20261024090000_sales.sql` (done) | "Applied 20261024090000_sales successfully" |
| | 2. `supabase/sql-editor/20261024120000_sales_all_need_approval.sql` | "Applied 20261024120000_sales_all_need_approval successfully" |
| **Outdoor Training** | the same two files, same order | the same messages |

Then restart the training site: in its window press **Ctrl + C**, then `npm.cmd run training:build` and `npm.cmd run training:start`.

## 2. Before testing — on each site

- **Settings → Districts:** add at least one district for each city you will sell in (the form needs one).
- The agent account must have a **City** (Users → edit) and be in a **team** with an Outdoor Supervisor (Teams).

## 3. How a sale works

| Step | What happens |
|---|---|
| Agent opens **Sales → New sale** | No date field: the server records the date and time (EAT). The form is saved on the phone as a draft until it is submitted |
| Chooses **New** or **Retention**, types name, phone (063 / 065), Index (8 digits) | Phone is stored as +252…; Index must be exactly 8 digits |
| City (fixed to the agent's city — Team Leader / Super Admin can change), District, Area, **Branch** (where the money is handed in) | |
| **Product → Plan**, **Months paid** (1–12) or **Pay 2 months, get 1 free** | Amount = recharge × months + installation fee (D-36). Free month: 2 months, only if 2 × recharge ≥ $50 |
| **Submit** | Every sale — New and Retention — is "Waiting for approval" (D-37). The Supervisor approves it and records the equipment given (approval screen: Phase 8) |

Blocked (with a message, and recorded for Super Admin review in the audit events): a New customer whose phone or Index is already registered (even an old, replaced number); a Retention whose phone and Index belong to different customers, or whose name clearly differs; a second sale for the same customer in the same month.

**My Sales** opens on the current month; choosing an earlier month shows it read-only. Team Leaders and Super Admin can also pick an agent. **Free-month compensation** lists the free-month sales. **Customers** lists the customers you may see; Super Admin can change a customer's phone or Index with a reason (the old one stays reserved for ever).

## 4. Things to test (on staging)

| Test | Expected |
|---|---|
| As the test agent: New sale, FTTH · SO-Home, 1 month | "Sale saved. It now waits for Team Leader approval."; amount $25.00; no equipment card on the form |
| Press Submit twice quickly (or go back and submit again) | Only one sale |
| Another New sale with the **same phone** (type it as 063…, then as +252 63…) | "Blocked: this phone number is already registered…" |
| New sale with the same **Index** | "Blocked: this Index Number is already registered…" |
| Index with 7 digits or a letter | Refused: "The Index Number must be exactly 8 digits." |
| Phone starting 066 | Refused (prefix not allowed) |
| Retention with the first customer's phone + Index, name typed slightly differently (e.g. "Mohammed" for "Mohamed") | Blocked: "already has a sale this month" (same month) — shows the name was accepted |
| Retention for a brand-new phone + Index | Saved; "Waiting for approval" |
| FTTA · SO-Basic ($20) with free month | Free month not available (2 × $20 < $50) |
| FTTH · SO-Home with free month | Amount $50.00, months 2, "Free month" badge |
| My Sales → choose last month | Read-only note; no New sale button |
| As Super Admin: Customers → Change phone / Index → new number + reason | Saved; a New sale with the old number is now blocked |
| Supabase → Table Editor → `audit_events` | One row per blocked attempt (DUP_PHONE, DUP_INDEX, IDENTITY_CONFLICT, SAME_MONTH) |
