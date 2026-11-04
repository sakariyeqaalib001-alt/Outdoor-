# Incident runbook (pilot)

**Support owner:** the business owner (D-43) takes every first call from agents and Team Leaders. Never ask anyone to send a password, SMS code, secret key or customer phone number by chat, email or SMS.

## How serious is it?

| Level | Examples | Act |
|---|---|---|
| **Critical** | Nobody can sign in; the site is down; a key or password may be exposed; sales are being saved wrongly | Now. Tell Team Leaders to write sales on paper (name, phone, Index, product, plan, months, amount, time) and enter them when fixed |
| **High** | One team cannot approve sales; SMS codes not arriving for many people; dashboard figures look wrong | Same day |
| **Normal** | One person locked out; a typing mistake on a customer; a question | Within a working day |

## Common problems

| Problem | Check | Fix |
|---|---|---|
| One person cannot sign in | Users → their account: active? Locked after 5 wrong passwords (wait 15 minutes)? | Wait, or Users → **Reset password** (new temporary password, give it privately) |
| SMS codes do not arrive for anyone | Telesom account balance / service; host logs for "sms" errors | Contact Telesom. As a last resort Super Admin may switch Settings → SMS code **off** for a short time — switch it back on as soon as SMS works (readiness check fails while off) |
| Site does not open | `https://<address>/api/health` | Not "ok" → host status page (Vercel) and Supabase status; if a new version was just released, roll back (below) |
| "Not enough stock" when approving | Stock → Overview for that team | Stock Officer issues more; the Team Leader accepts; approve again |
| Duplicate phone / Index blocked a genuine customer | Audit → the case; Customers → search | If it is the same person, use Retention; if a typing error on the old record, Super Admin corrects the customer (recorded as an event) |
| A sale has wrong details | The sale page | Approved sales are never edited: reject/refund route (Phase 12) or record the correction in the audit case. Pending sales: the Team Leader rejects it and the agent submits again |
| Dashboard numbers look wrong | The figure's **View sales** list; "How these figures are counted" | Pending sales are not counted; approvals after the 3rd count in the approval month |
| Alert emails not arriving | Audit → "waiting: N"; Spam folder | Check the email settings (Brevo); the bell still works |

## Suspected security problem

1. If a secret key, Telesom password or email key may have been seen by someone else: **rotate it at once** (Supabase → API Keys → create new secret key and delete the old; Telesom / Brevo → new key) and put the new value in the host settings, then redeploy.
2. If an account may be misused: Users → **deactivate** it (sessions end at once).
3. Do not delete anything: the activity log and change history show who did what.
4. Write down what happened, when, and what you changed.

## Rolling back a release

- **App:** Vercel → Deployments → the previous working deployment → **Promote to Production**. No data is lost.
- **Database:** changes are only ever added (never edited). If a new SQL file causes a problem, stop and contact the developer before running anything else; restore from backup only as a last resort (`pilot-readiness.md` §6), as it loses everything after the backup time.

## After any Critical or High incident

Record in `docs/03-implementation/PHASE_LOG.md` (pilot defects): date, what happened, who was affected, cause, fix, and whether paper sales were entered.
