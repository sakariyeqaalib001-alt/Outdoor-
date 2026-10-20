# Users, roles and teams (Phase 4)

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole of `supabase/sql-editor/20261020150000_access.sql` → **Run** → expect **"Applied 20261020150000_access successfully"**. If the RLS warning appears, choose **Run and enable RLS**.

## 2. Make yourself the first Super Admin (one time)

In the SQL Editor, **New query**, paste and run (use your own staff email):

```sql
select app.bootstrap_super_admin('sd.qalib@sogasho.com');
```

Expected result: `Super Admin granted to sd.qalib@sogasho.com`. It works only once — after that, Super Admins are granted on the **Users** screen.

## 3. What you can do now (Users in the sidebar)

| Screen | What |
|---|---|
| **Users** | Add staff (email) or temporary agents (phone); edit name, city, branch, team, start date and roles; reset a password (a new temporary password is shown once); deactivate / reactivate |
| **Teams** | Create teams per city and choose the Team Leader (the person must have the "Team Leader / Supervisor" role) |
| **Roles & permissions** | The permission matrix: for each role and action, who may do it — own records, team, city or all. Super Admin is locked to everything |

Roles: Super Admin · Team Leader / Supervisor · Sales Agent · Follow-up Team · Stock Officer · Payroll / Finance · Auditor / Management (BRD §4).

## 4. Things to test

| Test | Expected |
|---|---|
| Sign in as yourself after step 2 | Sidebar shows **Users**; Users screen lists both accounts |
| Edit your test agent: role **Sales Agent**, city, branch | Saved; table updates |
| **Teams → Add team** (city Hargeisa) — then edit a staff user and give them **Team Leader**, then set them as the team's leader | Saved |
| Edit the test agent and put them in that team | Team column shows it |
| Sign in as the test agent | Sidebar shows only agent items (no Users, Settings, Audit, Approvals, Reports) |
| As Super Admin, **Deactivate** the test agent | Agent is signed out of everything at their next click; cannot sign in |
| **Reactivate** | Agent can sign in again |
| **Reset password** | A new temporary password is shown once; the agent must change it at next sign-in |
| Try to deactivate yourself | Refused: "You cannot deactivate your own account." |
| **Roles & permissions**: change one cell for Sales Agent, then change it back | Saved immediately; the Super Admin column cannot be changed |

Every change is recorded automatically (Supabase → Table Editor → `activity_log` and `change_log`).
