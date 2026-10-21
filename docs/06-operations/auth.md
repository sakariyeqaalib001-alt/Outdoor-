# Sign-in setup and testing (Phase 3)

How to connect the app to Supabase "Outdoor", create the first accounts, and test sign-in. Keys and passwords never go into chat, docs or code.

## 1. Apply the database change (SQL Editor)

Supabase → "Outdoor" → **SQL Editor** → **New query** → paste the whole of `supabase/sql-editor/20261020090000_auth.sql` → **Run** → expect **"Applied 20261020090000_auth successfully"**. If the RLS warning appears, choose **Run and enable RLS**.

Table Editor should now also show `user_profiles`, `otp_challenges`, `otp_verified_sessions`, `auth_lockouts`.

## 2. Supabase Auth settings (dashboard, one time)

Supabase → "Outdoor" → **Authentication**:

| Where | Setting | Value | Why |
|---|---|---|---|
| Sign In / Providers → **User Signups** | Allow new users to sign up | **Off** | Accounts are created only by Super Admin (FR-AUTH-04) |
| Sign In / Providers → **Email** | Enabled | **On** | Staff sign in by email; agents use an internal address behind the scenes (T-16) |
| Sign In / Providers → **Email** | Confirm email | either (accounts are created already confirmed) | — |
| Sign In / Providers → **Phone** | Enabled | **Off** — not needed | OTP is handled by the app + Telesom (T-15) |
| **Password security** (Attack Protection / Policies) | Minimum length | **8** | T-19 |
| **Password security** | Required characters | **Letters and digits** | T-19 |

## 3. Local settings file `.env.local` (your computer only)

Create `.env.local` in the `Outdoor System` folder (copy `.env.example`). Fill in yourself — never paste into chat:

| Name | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rovaveormshdgvpbehqf.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → **API Keys** → Publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Project Settings → **API Keys** → Secret keys → reveal/create (`sb_secret_…`) — server only |
| `SMS_PROVIDER` | `test` for now (the code appears in the `npm run dev` terminal instead of an SMS) |

Restart `npm run dev` after creating or changing `.env.local`.

## 4. Create accounts (your terminal)

```bash
npm run user:create -- --type permanent --email you@sogasho.com --phone 0634123456 --name "Your Name"
```

```bash
npm run user:create -- --type temporary --phone 0634123456 --name "Test Agent"
```

Each prints a **temporary password** in your terminal. Give it to the person privately; they must change it at first sign-in. The first permanent account becomes the Super Admin in Phase 4 (roles).

## 5. What to test

| Test | Expected |
|---|---|
| Open http://localhost:3000 while signed out | Sent to the sign-in page |
| Staff: email + temporary password | Asked to choose a new password, then **enter your code** sent by SMS to the staff member's mobile number (D-32), then the dashboard |
| Agent: phone (any format: `0634123456`, `063 412 3456`, `+252634123456`) + temporary password | New password, then **enter your code** — the 6-digit code is printed in the `npm run dev` terminal as `[DEV SMS — not sent]` |
| Wrong code | "That code is not correct" — after 5 wrong codes, a new code is needed |
| "Send a new code" more than 3 times in 15 minutes | "Too many codes requested" |
| Wrong password 5 times | "Too many failed attempts. Try again in 15 minutes." |
| Sign out (bottom of the sidebar) | Back to the sign-in page; protected pages are blocked again |
| Supabase → Table Editor → `activity_log` (as owner) | `auth.sign_in`, `auth.sign_in_failed`, `auth.locked`, `auth.password_changed`, `auth.otp_*` rows — no passwords, codes or phone numbers |

## 6. Real SMS through Telesom

The Telesom sender uses the gateway format confirmed with a live test on 20 Oct 2026 (T-20: POST to `https://sms.mytelesom.com/index.php/Gway/sendsms/`, MD5 `key` over the plain message text). To switch from the test sender to real SMS, add to `.env.local` yourself (never in chat or code):

```
SMS_PROVIDER=telesom
TELESOM_USERNAME=…
TELESOM_PASSWORD=…
TELESOM_API_KEY=…
TELESOM_SENDER=SOGASHO
```

`TELESOM_API_URL` is optional (defaults to the address above). Restart `npm run dev`, sign in as the test agent with **your own phone number** and check the SMS arrives within a minute. If it does not, the code screen says "We could not send the SMS" (press **Send a new code** to retry), and the `npm run dev` window shows `[sms:telesom] OTP delivery failed: …` with Telesom's reason (never the code or credentials) — send me that line. On Windows PowerShell use `npm.cmd` instead of `npm` if "running scripts is disabled" appears.
