# Audit cases and alerts (Phase 9)

## 1. Apply the database change — on BOTH sites

| Project | File | Expected |
|---|---|---|
| **Outdoor** | `supabase/sql-editor/20261026090000_audit_cases.sql` | "Applied 20261026090000_audit_cases successfully" |
| **Outdoor Training** | the same file | the same message |

Then restart the training site (stop it, `npm.cmd run training:build`, `npm.cmd run training:start`) and restart `npm.cmd run dev`.

## 2. Email alerts (one-time setup — you do this; never paste the key in chat)

Without these steps everything works **in the app**; the alert emails simply wait in the queue (Audit → "waiting: N").

Your work address can be the sender without changing sogasho.com's DNS, using **Brevo** (free, 300 emails a day):

1. Go to brevo.com → **Sign up free** with `sd.qalib@sogasho.com`.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: name `Sogasho Outdoor`, email `sd.qalib@sogasho.com`. Brevo emails you a code — enter it to verify the sender.
3. **SMTP & API → API Keys → Generate a new API key**, name it `Outdoor`. Copy it.
4. Open `.env.local` in the project folder (Notepad) and set these lines (keep the key private):

   ```
   EMAIL_PROVIDER=brevo
   EMAIL_PROVIDER_API_KEY=<the key you copied>
   EMAIL_FROM=sd.qalib@sogasho.com
   ```

5. Stop and start `npm.cmd run dev`. The training site uses the same lines automatically (unless `.env.training.local` sets its own); rebuild it to pick them up.

Because IT controls sogasho.com, some mail servers may put these emails in **Spam** at first. When IT has time, ask them to add Brevo's DNS records for sogasho.com (Brevo shows them under **Domains**); nothing changes in the system.

No email ever contains a customer phone number or Index Number — only the rule, the case number and a link.

The **bell is the main alert** and works at once. Emails go out while the app is running — after any action or page view, or with **Audit → Send emails now**; nothing is lost while it is closed. A scheduled sender comes with hosting (Phase 11).

## 3. How it works

| What happens | Result |
|---|---|
| Duplicate phone / Index, identity conflict, second sale in a month, switch mismatch | The sale/switch is blocked (as before) **and** an event is recorded; the event is grouped into a **case** (same customer within 30 days → same case). Every Super Admin gets a bell notification and an email |
| Several agents, same customer (on) | A customer registered as New by one agent is **tried again by a different agent** (blocked) within 30 days → event + case. Normal Retention sales by another agent are **not** counted. Only the agent who made the blocked attempt is put on hold, never the original seller |
| Customer details corrected (on, event only) | Super Admin corrects the phone / Index / name of a customer whose sale is approved → recorded under **Audit → Events**; no case, no hold |
| Edit after approval (on) | An approved sale itself is changed (the system never does this) → event + case linked to the sale and its agent |
| Too many sales too fast (off) | Switch on in **Audit → Rules** if needed (e.g. 5 sales in 30 minutes) |
| Self-approved sale (on, event only) | A Team Leader approving their own sale (D-40) is recorded under **Audit → Events**; no case, no hold |

**Case steps** (Audit → open a case): Open → **Start review** → **Confirm issue** or **False positive** → **Resolve**. A note is required at each step. Only Super Admin, or the Auditor the case is **assigned** to, can change it. Nothing can be edited or deleted; every step is in the case history.

**Effects:** Open / Under review → the linked agent's pay is **on hold** (used by payroll, Phase 16). Confirmed issue → the linked sales are **ineligible**. False positive → no effect.

Super Admin can also **open a case by hand** (Audit → New case, or **Open audit case** on a sale's page).

## 4. Things to test (on staging)

| Test | Expected |
|---|---|
| As an agent: New sale with a phone that already exists | Blocked as before. As Super Admin: bell shows "Audit alert: Duplicate phone number (case #N)"; **Audit** lists case #N, Open |
| Open the case | Shows the rule and why it fired, what was entered, the matching customer, the agent, the time; history "Case opened" |
| Same customer again from another agent | Same case gets the new event, plus a "Several agents, same customer" event |
| As the agent or a Team Leader: open `/audit` | "You don't have access" |
| As Super Admin: **Start review** with an empty note | "Write a note of at least 3 characters" |
| Assign the case to an Auditor | The Auditor's bell (and email) shows "Audit case #N was assigned to you"; another Auditor cannot change it |
| Under review → **False positive** → **Resolve** | Sale unaffected |
| On an approved sale: **Open audit case** → review → **Confirm issue** | Sale page shows the case with "Confirmed issue" (ineligible) |
| As Super Admin: Customers → change an approved customer's phone | **Audit → Events** shows "Customer details corrected" with your reason; no case; the agent is not on hold |
| Agent A sells a New customer; agent B tries the same phone | Blocked; one case with "Duplicate phone number" + "Several agents, same customer"; only agent B is listed (on hold), not agent A |
| As a Team Leader: sell and approve your own sale | **Audit → Events** shows "Self-approved sale"; no case |
| Audit → Rules: try to switch off "Duplicate phone number" | Not possible (always on). Switch "Too many sales too fast" on with 2 sales / 30 minutes; make 2 sales → case |
| With email set up: Audit → **Send emails now** | "Sent N, failed 0"; the email arrives in the Super Admin's inbox (check Spam) |
