# Faislabadi POS — Client Handover & Future Updates

This document is the master guide for delivering the POS to the client and for making
future changes. Keep it with the project.

## 1. What the client gets

| Item | Where |
|---|---|
| Shop laptop app | This folder, run `start.bat` |
| Live website | https://faislabadi-pos.vercel.app |
| Cloud database (auto-backup) | Supabase project `faislabadi-pos` |
| Source code (yours) | GitHub: github.com/SohaibAli417/Faisalabadi |

## 2. Client login details (IMPORTANT — new safe passwords)

| Role | Login | Password |
|---|---|---|
| Admin (Sohaib Ali) | `sohaib@faislabadi.pk` | `FaislabadiG17` |
| Manager (Akmal) | `akmal@faislabadi.pk` | `AkmalStore786` |

- These replace the old passwords that were printed in the public source code.
- Ask the client to change them from **Settings → Security → Change password** after handover.
- If a fresh/empty database is ever created, the server prints random new passwords in the black window — look for "FRESH DATABASE - generated initial passwords".

## 3. Install on the client shop laptop

1. Install **Node.js LTS** once from https://nodejs.org (Settings defaults are fine).
2. Copy this whole folder (see section 6 for what to leave out) to e.g. `C:\faislabadi-pos`.
3. Double-click **`start.bat`**.
   - First run installs dependencies automatically (needs internet once).
   - A black window stays open — that is the POS server. Keep it open while using the POS.
4. Browser opens `http://localhost:3000`. Log in with the details above.
5. (Optional) In Chrome/Edge click the **install icon** in the address bar → the POS becomes
   a desktop app with its own icon.

## 4. Mobile & other computers

- **Same Wi-Fi as the shop laptop:** open `http://<shop-laptop-IP>:3000` from any phone/laptop.
  Find the IP by running `ipconfig` on the shop laptop (e.g. `http://192.168.1.19:3000`).
- **Anywhere (internet):** open https://faislabadi-pos.vercel.app on any phone/laptop.

The app is mobile responsive (designed for the phone screen too).

## 5. Online & offline behaviour

- **Offline:** the laptop keeps working fully (billing, customers, reports). Sales are saved
  to the local database and synced automatically once internet returns.
- **Online:** every 15 seconds the laptop syncs with the cloud database. The website and the
  laptop then share the same stock, sales and udhar. The top bar shows "Cloud synced".

## 6. Making the delivery folder / zip

Copy this folder but **leave out**:

- `node_modules\` (auto-recreated by start.bat)
- `.git\`
- `.vercel\`
- `.server.*.log`
- `database\backups\`
- `database\*backup*.json`

Keep `database\pos-data.json` — it holds the real shop data.
Keep `.env` — it holds the cloud connection so laptop and website share data.

## 7. Making future changes (your GitHub workflow)

Everything is version-controlled on GitHub. The live website deploys from the same code.

1. On your laptop, edit files (e.g. `server.js`, `frontend/app.js`, `frontend/styles.css`).
2. Test locally: click `start.bat`, open http://localhost:3000, make sure it works.
3. Push to GitHub:
   ```powershell
   git add -A
   git commit -m "v22: describe your change here"
   git push origin main
   ```
4. Deploy to the live site (from this project folder):
   ```powershell
   vercel --prod
   ```
5. Wait for "Ready" — the live site is updated automatically. Give the client the new
   `start.bat` + changed files, or re-zip the folder, when the change affects the laptop app.

To pull your own changes on a different computer:
   ```powershell
   git pull origin main
   npm install
   ```

## 8. Preventing the cloud database from pausing again

Supabase pauses free projects after ~1 week of no activity. The pause causes the website to
show "sign in again" / 503 errors. To avoid it:

- The laptop syncs every 15 seconds while running, which keeps the project active.
  Make sure `start.bat` is run at least a couple of times a week.
- Or turn on **Project Settings → General → Pause Project** / notifications — Supabase sends
  one warning email; watch the mailbox the project is registered to and click to keep it.
- If it pauses again: Supabase Dashboard → open the project → **Restore project**. It takes
  ~2 minutes and everything reconnects.

## 9. Backups

- Laptop: `database\backups\` (auto-created on startup).
- Cloud: Supabase is the backup. The website keeps an extra copy too (backup tab in settings).
- Recommended: once a week, copy `database\pos-data.json` to a USB stick.

## 10. Quick answers

| Task | How |
|---|---|
| Start POS on laptop | Double-click `start.bat` |
| Stop POS | Close the black window |
| Live website | https://faislabadi-pos.vercel.app |
| Change a password | Settings → Security → Change password |
| Back up data | Settings → Backups → Create backup |
| Restore data | Settings → Backups → Restore |