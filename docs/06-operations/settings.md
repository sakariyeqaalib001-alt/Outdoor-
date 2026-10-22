# Settings, products and prices (Phase 5)

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole file → **Run**:

- `supabase/sql-editor/20261022090000_master_data.sql` → "Applied 20261022090000_master_data successfully"

If the RLS warning appears, choose **Run and enable RLS**.

## 2. What you can do now (Super Admin)

| Screen (sidebar) | What |
|---|---|
| **Settings → General** | Business values, each saved on its own: base salary (temporary agents), incentive threshold and rate, payroll cutoff day, free-month amount, allowed customer mobile prefixes (063, 065 — D-33), performance target and baseline, week start (Saturday — D-33), weekend days (Friday — D-18), SMS code at sign-in |
| **Settings → Branches** | The 16 branches (BRD §6.2.1): add, rename, deactivate. A branch is where agents hand in money; it is chosen on each sale (D-31) |
| **Settings → Districts** | Enter the districts of each city (none are pre-loaded). They appear on the sales form; Area stays free text |
| **Settings → Lists** | Customer types New / Retention (rename only — codes are fixed) and stock items WiFi Router, PDCOM, CALIX (rename, deactivate) |
| **Settings → Public holidays** | Add, edit, delete holidays (not counted as leave working days) |
| **Products** | Products FTTA, FTTH, FTTB, LTE (add more; the code is fixed once created). **Prices**: monthly price in USD, from/to dates, for all cities or one city. A city's own price wins over the all-cities price |

Inactive values stay on old records but cannot be chosen for new ones. Every change is recorded (Supabase → Table Editor → `activity_log`, `change_log`).

**Before go-live (Phase 11 checks it):** a current price for every active product, and the districts of every city.

## 3. Things to test

| Test | Expected |
|---|---|
| Settings → General → change **Base salary** to 120 → Save | "Saved."; refresh shows 120. Change it back to 100 |
| Set **Baseline** to 25 (target is 20) | Refused: "Baseline must be lower than the target." |
| Set **Allowed customer mobile prefixes** to `063, 065, 066` → Save, then back to `063, 065` | Saved each time |
| Settings → Districts → **Add district** (Hargeisa, e.g. "26 June") | Appears in the list; adding the same name again in Hargeisa is refused |
| Settings → Branches → edit **New Hargeisa** → untick Active → Save, then tick it again | Status changes Inactive → Active |
| Settings → Public holidays → add 18/05/2027 "Independence Day", then delete it | Added, then gone |
| Products → **Add price**: FTTH, All cities, 25, from 01/01/2026, no end date | Shows "Current"; the FTTH row shows $25.00 |
| Add another FTTH price, All cities, from 01/06/2026 (overlaps) | Refused: "Another price … already covers some of these dates" |
| Edit the first price: set **To** 31/12/2026, then add 30 from 01/01/2027 | Both saved; the second shows "Upcoming" |
| Sign in as the test agent | No Settings or Products in the sidebar; typing `/settings` shows "no access" |
