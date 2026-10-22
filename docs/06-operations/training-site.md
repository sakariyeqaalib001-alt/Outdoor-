# Training site (T-24)

A practice copy of the app: the **same screens** (including the real SMS code) with its **own database**, and an orange **"Training site — Practice only"** banner on every page. Nothing done there touches the real ("Outdoor") data.

For now both copies run **on your computer** (until Vercel Pro is paid for, T-02):

| Copy | Address | Database | Started with |
|---|---|---|---|
| Normal (staging) | http://localhost:3000 | Supabase "Outdoor" | `npm.cmd run dev` |
| Training | http://localhost:3001 | Supabase "Outdoor Training" | `npm.cmd run training:start` |

Trainees on the **same Wi-Fi** can open the training site from their phones at `http://<your computer's address>:3001` (the address is printed when it starts, e.g. `192.168.1.129`). Your computer must stay on and connected while they practise. Windows may ask once to allow Node.js through the firewall — choose **Private networks**.

## Saturday — step by step

### 1. Create the training database (Supabase)
1. supabase.com → **New project** → name **Outdoor Training** → same organisation and region as "Outdoor" → choose a strong database password (keep it in your password manager; not in chat).
2. Wait until the project is ready.
3. **SQL Editor** → **New query** → paste the whole file `supabase/fresh-project/all_changes_in_order.sql` → **Run**. Expected: `Applied all … changes successfully`. (One file sets up everything: users, roles, settings, branches, 18 plans, stock.)
4. **Authentication → Sign In / Providers → Email**: **On**; turn **off** "Allow new users to sign up" — the same choices as "Outdoor" (`docs/06-operations/auth.md`, step 1).

### 2. Fill in `.env.training.local` (on your computer)
In the project folder create a file named exactly `.env.training.local` with these lines, using the **Outdoor Training** project's values (Supabase → Project Settings → API Keys / Data API). Type them yourself — never paste keys into chat:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

The Telesom SMS lines are taken from your existing `.env.local` automatically (same SMS account, real codes). The file is ignored by Git.

### 3. Build and start the training site
In a **second** PowerShell window (keep `npm.cmd run dev` running in the first):

```
npm.cmd run training:build
npm.cmd run training:start
```

Open http://localhost:3001 — the orange banner must be there. After any later code update, stop it (Ctrl + C) and run both commands again.

### 4. First accounts on the training site
1. Your Super Admin account (prints a temporary password in your window):
   ```
   npm.cmd run training:user-create -- --type permanent --email you@sogasho.com --phone 063xxxxxxx --name "Your Name"
   ```
2. Training project → **SQL Editor**:
   ```sql
   select app.bootstrap_super_admin('you@sogasho.com');
   ```
3. Sign in at http://localhost:3001 (SMS code to your phone), then on **Users** add trainees (temporary agents with their own phones), a team with a Supervisor, and on **Stock** receive and issue practice stock.

## Rules for the training site
- Use practice names and numbers where possible; it is not for real customers.
- Training accounts are separate from real accounts — trainees get a different temporary password.
- Each sign-in sends one real SMS (Telesom cost).
- When code changes later (Phase 7 onwards), the training database needs the new changes too: paste the new single files from `supabase/sql-editor/` into the **training** project as well, then `training:build` again.
