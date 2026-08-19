# Deployment and Sync Notes

## GitHub

This repository currently has no configured Git remote. To sync it to GitHub:

```powershell
git remote add origin <your-github-repo-url>
git add .
git commit -m "Build production POS foundation"
git push -u origin master
```

If the repository already exists under another branch name, replace `master` with that branch.

## Vercel

The project includes `vercel.json` so Vercel can route all requests to `server.js`.

Install and sign in:

```powershell
npm install -g vercel
vercel login
vercel
vercel --prod
```

## Production Data Warning

The current implementation uses `database/pos-data.json` for local persistence. That is suitable for local testing, a single shop computer, or a staging demo, but it is not safe as durable cloud persistence on Vercel because serverless filesystems are ephemeral.

Before live cloud usage, replace JSON persistence with an open-source database path such as PostgreSQL. Recommended options:

- Local/server deployment: PostgreSQL on the same VPS or LAN server.
- Managed cloud: Neon, Supabase, Railway, Render PostgreSQL, or another provider with backups.
- Offline-first shop counter: keep local JSON/SQLite and sync to a central server when online.

## Environment and Secrets

Do not commit `.env` files. Initial seeded passwords are for setup only:

- `admin@faislabadi.pk` / `admin123`
- `manager@faislabadi.pk` / `manager123`
- `cashier@faislabadi.pk` / `cashier123`

Change these before live use.
