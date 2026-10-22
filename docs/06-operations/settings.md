# Settings, products and prices (Phase 5)

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole file → **Run**:

1. `supabase/sql-editor/20261022090000_master_data.sql` → "Applied 20261022090000_master_data successfully"
2. `supabase/sql-editor/20261022120000_plans.sql` → "Applied 20261022120000_plans successfully" (D-34: plans and their prices)

If the RLS warning appears, choose **Run and enable RLS**.

## 2. What you can do now (Super Admin)

| Screen (sidebar) | What |
|---|---|
| **Settings → General** | Business values, each saved on its own: base salary (temporary agents), incentive threshold and rate, payroll cutoff day, free-month amount, allowed customer mobile prefixes (063, 065 — D-33), performance target and baseline, week start (Saturday — D-33), weekend days (Friday — D-18), SMS code at sign-in |
| **Settings → Branches** | The 16 branches (BRD §6.2.1): add, rename, deactivate. A branch is where agents hand in money; it is chosen on each sale (D-31) |
| **Settings → Districts** | Enter the districts of each city (none are pre-loaded). They appear on the sales form; Area stays free text |
| **Settings → Lists** | Customer types New / Retention (rename only — codes are fixed) and stock items WiFi Router, PDCOM, CALIX (rename, deactivate) |
| **Settings → Public holidays** | Add, edit, delete holidays (not counted as leave working days) |
| **Products** | Products FTTA, FTTH, FTTB, LTE (add more; the code is fixed once created); their **plans** (18 loaded from your price sheets: name, speeds, data); **price history**: recharge and installation fee per plan with from/to dates, same in all cities. To change a price: end the old one, add the new one from the next day |

Inactive values stay on old records but cannot be chosen for new ones. Every change is recorded (Supabase → Table Editor → `activity_log`, `change_log`).

**Before go-live (Phase 11 checks it):** a current price for every active plan (loaded), and the districts of every city.

## 3. Things to test

| Test | Expected |
|---|---|
| Settings → General → change **Base salary** to 120 → Save | "Saved."; refresh shows 120. Change it back to 100 |
| Set **Baseline** to 25 (target is 20) | Refused: "Baseline must be lower than the target." |
| Set **Allowed customer mobile prefixes** to `063, 065, 066` → Save, then back to `063, 065` | Saved each time |
| Settings → Districts → **Add district** (Hargeisa, e.g. "26 June") | Appears in the list; adding the same name again in Hargeisa is refused |
| Settings → Branches → edit **New Hargeisa** → untick Active → Save, then tick it again | Status changes Inactive → Active |
| Settings → Public holidays → add 18/05/2027 "Independence Day", then delete it | Added, then gone |
| Products → plans list | 18 plans with the recharge, speeds and data of your price sheets |
| **Product** filter → FTTH | Only SO-Prime, SO-Basic, SO-Home, SO-Home Basic |
| **Add price** for FTTH · SO-Home, 30, from 01/01/2027, no end date | Refused: "Another price for this plan already covers some of these dates" |
| Edit the SO-Home price: **To** 31/12/2026 → Save; then **Add price** 30 from 01/01/2027 | Both saved; the new one shows "Upcoming"; the plans list still shows $25.00 today |
| **Add plan** to LTE, e.g. "SO!-Test", 5 / 5 Mbps → Save, then edit it and untick Active | Saved; it shows "No current price" while active, Inactive after |
| Sign in as the test agent | No Settings or Products in the sidebar; typing `/settings` shows "no access" |
