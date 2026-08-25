# Deployment, Delivery and Security Guide

## Overview — how the system works

There are two ways to run the POS, and both can share the SAME cloud database:

| Setup | Data stored | Works offline | Needs internet |
|---|---|---|---|
| **Shop laptop** (start.bat) | Local file + cloud sync | Yes, fully | Only for syncing |
| **Live website** (Vercel) | Cloud database only | No | Always |

- The laptop app saves every sale to `database\pos-data.json` instantly.
- Every 15 seconds it syncs with the cloud database (Supabase): new sales go up,
  changes from the website come down. Stock and udhar balances are reconciled
  automatically, including sales made while offline.
- If the internet is down, nothing is lost — the sync retries until it succeeds.

---

## Part 1 — Share the project to a client (shop laptop)

### What to copy

Copy the project folder **without** these items:

- `node_modules\` (huge — recreated automatically)
- `.git\`
- `.vercel\`
- `.server.*.log`
- `database\backups\` (optional)

To move an existing shop's data, include `database\pos-data.json`.

### What the client laptop needs

1. **Node.js LTS** — one-time install from https://nodejs.org (next-next-finish).
2. Copy the folder to e.g. `C:\faislabadi-pos`.
3. Double-click **`start.bat`**:
   - First run installs dependencies automatically (needs internet once).
   - Then the POS opens at http://localhost:3000.
   - Keep the black window open while using the POS; close it to stop.
4. In Chrome/Edge click the **install icon** in the address bar → the POS becomes
   a desktop app with its own icon and window.

### Offline / online behaviour on the laptop

- Internet OFF: everything works — billing, products, customers, reports.
  Sales are queued in the browser AND saved to the local database.
- Internet ON: the laptop pushes its offline sales to the cloud automatically
  and pulls anything done on the live website. The top bar shows
  "Cloud synced" when connected, "Cloud pending" while waiting.

---

## Part 2 — Connect the cloud database (REQUIRED for Vercel data safety)

Without this step the **live website loses data after ~20–30 minutes**
(Vercel temporary storage), and the laptop cannot sync with the website.

1. Create a free account at https://supabase.com and create a project.
2. Open **SQL Editor** and run:

   ```sql
   create table pos_data (
     id text primary key,
     data jsonb not null,
     updated_at timestamptz
   );
   ```

3. Go to Project Settings → API and copy:
   - `Project URL`  → this is `SUPABASE_URL`
   - `anon public key` → this is `SUPABASE_ANON_KEY`

### Configure the shop laptop

Create a file named `.env` in the project folder (copy `.env.example`):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SYNC_INTERVAL_MS=15000
```

Restart start.bat. The console prints
"Local-first mode: POS uses the local file and auto-syncs to the cloud database".

### Configure Vercel

From the project folder:

```powershell
vercel env add SUPABASE_URL production     # paste URL
vercel env add SUPABASE_ANON_KEY production # paste key
vercel --prod
```

Now the website and the laptop share one database, and website data survives.

---

## Part 3 — Security checklist

Built into the app: PBKDF2-hashed passwords, server-side logout revocation,
login rate limiting, security headers/CSP, role permissions, audit logs,
masked CNICs, append-only backups.

Do before go-live:

1. Change all passwords (Settings → Change password).
2. Enable BitLocker on the client laptop.
3. Back up weekly: copy `database\pos-data.json` to a USB drive
   (the cloud database is an automatic second copy).
4. Keep the POS on LAN only; do not port-forward without HTTPS.

## Local commands

```powershell
npm start        # run the server manually
npm test         # syntax checks + unit tests
```
