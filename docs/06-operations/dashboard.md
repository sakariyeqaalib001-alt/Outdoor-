# Dashboard (Phase 10)

## 1. Apply the database change — on BOTH sites

| Project | File | Expected |
|---|---|---|
| **Outdoor** | `supabase/sql-editor/20261103090000_dashboard.sql` | "Applied 20261103090000_dashboard successfully" |
| **Outdoor Training** | the same file | the same message |

Then restart the training site (stop it, `npm.cmd run training:build`, `npm.cmd run training:start`) and restart `npm.cmd run dev`.

This change also:
- stops Team Leaders choosing another city on a sale (nobody sells outside their own city);
- takes the sales dashboard away from Stock Officers (they now open straight on **Operations → stock**).

## 2. What is where

| View (sidebar → Dashboard) | Shows |
|---|---|
| **Sales Overview** (home page) | Overall Sales, Overall Revenue, This Month Sales, This Month Revenue; Overall / This Month New and Retention; 12-month trend; New vs Retention; quick insights (top branch, top product, target progress); Submitted this month, Waiting for approval, On hold |
| **Branch Performance** | Each city's 8 indicators with its target and % (bar + the line showing how far through the month we are); city comparison and target ranking; all branches; every agent's month with band (Target met / Baseline / Underperforming) |
| **Technology Sales** | FTTA, FTTH, FTTB and LTE — overall units and revenue, this month units and revenue; charts by product; product mix; insights |
| **Sales Trends** | 12 months: sales, revenue, New vs Retention, by product, by city, and the table behind the charts |
| **Performance Reports** | Tables for the selected period by city, product, branch and agent (Excel / PDF in Phase 15) |
| **Operations** | Stock received and issued per WiFi Router / PDCOM / CALIX; audit (duplicate attempts, open cases, cases older than 7 days); waiting for approval |

Clicking a card or **View sales** lists the sales behind the figure.

**How figures are counted** (also on every view, under "How these figures are counted"):
- **Eligible** = approved, not reversed, not a Confirmed-issue audit case, a sale (not a switch). It counts in the month it was submitted if approved by the end of the 3rd of the next month (Settings → payroll cutoff), otherwise in the month it was approved.
- **Submitted** = approved + waiting for approval (not rejected).
- **Revenue** = amount collected (recharge × months + installation fee).
- **City target** = active Sales Agents and Team Leaders in the city × 20 (Settings → performance target). There are no city or branch targets to enter; individual agent targets come in Phase 14.
- **Today / This week / Custom range** count approved sales by the day they were submitted; the week starts on Saturday.

## 3. Who sees what

| Role | Sees |
|---|---|
| Super Admin (= Sales Manager), Finance, Auditor | Everything, nationwide (audit figures: Super Admin and Auditor only) |
| Team Leader / Supervisor | Their team and own sales; their team's issued stock |
| Sales Agent | Own sales only; no stock or audit figures |
| Stock Officer | Operations → stock only |

## 4. Things to test (on staging, after step 1)

| Test | Expected |
|---|---|
| As Super Admin: open the home page | Sales Overview with 8 cards, trend, composition, insights; every card says **Eligible** or **Submitted** |
| Approve a pending sale, reload | This Month Sales +1, Waiting for approval −1 |
| A sale submitted last month and approved by the 3rd | Counts in last month (Branch Performance with Period = Previous month) |
| Click **This Month Sales** | List of exactly those sales; the count matches the card |
| Branch Performance → Hargeisa card | Target = (active agents + Team Leaders in Hargeisa) × 20; % = actual ÷ target |
| Filter City = Berbera | Every card, chart and table shows Berbera only |
| Period = Custom range with From after To | Not accepted |
| As an agent | Only own figures; no agent filter; no stock or audit |
| As a Team Leader | Only the team; another city's card is not shown |
| As a Team Leader: New sale with another city | Refused ("cannot change the city") |
| As Stock Officer: open the home page | Goes to Operations; only the stock cards; other views say "You don't have access" |
| As Finance | Everything except the audit figures |
| On a phone | Cards stack in one column; tables scroll sideways |
