# Users, roles and teams (Phase 4)

## 1. Apply the database changes (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole file → **Run**, one file at a time, in this order:

1. `supabase/sql-editor/20261020150000_access.sql` → "Applied 20261020150000_access successfully"
2. `supabase/sql-editor/20261020190000_users_no_branch.sql` → "Applied 20261020190000_users_no_branch successfully" (D-31: users have no branch)
3. `supabase/sql-editor/20261021090000_otp_for_everyone.sql` → "Applied 20261021090000_otp_for_everyone successfully" (D-32: SMS code for everyone) — **then immediately** add your own mobile number (step 2b), or you cannot finish signing in

If the RLS warning appears, choose **Run and enable RLS**.

## 2. Make yourself the first Super Admin (one time)

In the SQL Editor, **New query**, paste and run (use your own staff email):

```sql
select app.bootstrap_super_admin('sd.qalib@sogasho.com');
```

Expected result: `Super Admin granted to sd.qalib@sogasho.com`. It works only once — after that, Super Admins are granted on the **Users** screen.

## 2b. Add your own mobile number (one time, D-32)

After file 3, every sign-in needs the SMS code, including yours. In the SQL Editor, **New query**, run (your staff email and your own mobile number):

```sql
select app.set_user_phone('sd.qalib@sogasho.com', '063 xxx xxxx');
```

Expected: `Mobile number saved for sd.qalib@sogasho.com (ends …)`. Then sign out of the app and sign in again: after the password you get an SMS code. Other users' numbers are set on the **Users** screen (**Mobile number** field). One person may use the same number for a staff account and an agent account.

## 3. What you can do now (Users in the sidebar)

| Screen | What |
|---|---|
| **Users** | Add staff (email) or temporary agents (phone); edit name, city, team, start date and roles (no branch — agents belong to the Outdoor Department; the branch is chosen on each sale, D-31); reset a password (a new temporary password is shown once); deactivate / reactivate |
| **Teams** | Create teams per city and choose the Team Leader (the person must have the "Team Leader / Supervisor" role) |
| **Roles & permissions** | The permission matrix: for each role and action, who may do it — own records, team, city or all. Super Admin is locked to everything |

Roles: Super Admin · Team Leader / Supervisor · Sales Agent · Follow-up Team · Stock Officer · Payroll / Finance · Auditor / Management (BRD §4).

## 4. Things to test

| Test | Expected |
|---|---|
| Sign in as yourself after step 2 | Sidebar shows **Users**; Users screen lists both accounts |
| Edit your test agent: role **Sales Agent**, city Hargeisa | Saved; table updates |
| **Teams → Add team** (city Hargeisa) — then edit a staff user and give them **Team Leader**, then set them as the team's leader | Saved |
| Edit the test agent and put them in that team | Team column shows it |
| Sign in as the test agent | Sidebar shows only agent items (no Users, Settings, Audit, Approvals, Reports) |
| As Super Admin, **Deactivate** the test agent | Agent is signed out of everything at their next click; cannot sign in |
| **Reactivate** | Agent can sign in again |
| **Reset password** | A new temporary password is shown once; the agent must change it at next sign-in |
| Sign in as yourself (staff) | After the password, an SMS code arrives on your mobile; the dashboard opens only after the code |
| Edit a user and change the **Mobile number** | Saved; for a temporary agent the new number is now their sign-in |
| Give a staff member a number another staff member already has | Refused: "Another account of the same type already has this mobile number." |
| Try to deactivate yourself | Refused: "You cannot deactivate your own account." |
| **Roles & permissions**: change one cell for Sales Agent, then change it back | Saved immediately; the Super Admin column cannot be changed |

Every change is recorded automatically (Supabase → Table Editor → `activity_log` and `change_log`).
