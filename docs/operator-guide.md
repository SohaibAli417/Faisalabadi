# Faislabadi POS Operator Guide

## Mobile Responsive

Yes. The POS has responsive CSS for desktop, tablet, and mobile widths.

Recommended use:

- Counter/laptop: open `http://localhost:3000/`.
- Mobile on same Wi-Fi: run the server on the shop computer, find that computer IP, then open `http://<computer-ip>:3000/` from the phone.
- For live internet/mobile access, deploy behind HTTPS with a real database.

## Security Status

Implemented now:

- Passwords are hashed with PBKDF2.
- Login has rate limiting.
- Sessions expire after 8 hours by default.
- Role permissions are enforced by backend APIs.
- Audit logs record login, sale, product, purchase, backup, restore, and return actions.
- Customer CNIC is masked in frontend API responses.
- Security headers are sent by the server, including CSP, frame protection, MIME protection, no-referrer, and no-store API caching.
- Runtime database and backups are ignored by Git.

Still required before real public production:

- Change default passwords immediately.
- Use HTTPS only.
- Use a durable database such as PostgreSQL instead of local JSON for cloud hosting.
- Add server-side password reset/admin user management.
- Put the app behind a firewall or trusted hosting provider.
- Keep operating system, Node.js, and dependencies updated.

No system can honestly be called impossible to cyberattack. This project now has a stronger baseline, but public production needs the steps above.

## Online and Offline Mode

Available now:

- Online mode posts sales immediately to the backend.
- If the browser cannot reach the server while charging a sale, the sale is saved in browser local storage.
- The POS retries sync every 15 seconds while the POS page is open.
- Synced offline sales are posted through `/api/sync`.

Important:

- Offline mode keeps queued sales in that device/browser only.
- Do not clear browser data before queued sales are synced.
- For stronger offline production, use a local shop server or SQLite/PostgreSQL sync design.

## Barcode Scanner Setup

Most USB barcode scanners work like a keyboard.

1. Plug in the barcode scanner.
2. Open `Point of Sale`.
3. Click the search box.
4. Scan the product barcode.
5. The scanner should type the barcode and send Enter.
6. If the barcode exactly matches product SKU, the product is added to the cart automatically.

If your scanner does not add the product:

- Configure the scanner to send Enter after scan.
- Confirm the product SKU/barcode is saved in the Products page.
- Test by scanning into Notepad. It should type the code and move to a new line.

## Backup

Backup is available in `Settings and Backups`.

- Click `Create backup`.
- Backups are saved under `database/backups/`.
- The POS does not expose any delete backup button.
- Startup also creates a backup when the server starts.

## Restore

Admin/Manager can restore from `Settings and Backups`.

1. Open `Settings and Backups`.
2. Find the backup file.
3. Click `Restore`.
4. Confirm the restore.
5. The system creates a safety backup first, then restores the selected backup.
6. The app reloads after restore.

Manual restore if the UI is unavailable:

1. Stop the server.
2. Copy the backup file from `database/backups/`.
3. Open the backup JSON and copy its `data` object into `database/pos-data.json`.
4. Start the server again with `npm start`.

## Connect Domain and Go Live

Recommended live path:

1. Create a GitHub repository.
2. Push this project to GitHub.
3. Create a PostgreSQL database through Supabase, Neon, Railway, Render, or another provider.
4. Update the backend persistence layer from JSON to PostgreSQL.
5. Deploy to Vercel, Railway, Render, or a VPS.
6. Add environment variables in hosting settings.
7. Add your custom domain in hosting provider dashboard.
8. Add DNS records at your domain registrar.
9. Enable HTTPS.
10. Change all default passwords.

Vercel domain steps:

1. Open Vercel project dashboard.
2. Go to `Settings` > `Domains`.
3. Add your domain, for example `pos.yourstore.com`.
4. Vercel will show DNS records.
5. In your domain provider, add those DNS records.
6. Wait for DNS verification.
7. Vercel will issue HTTPS automatically.

For this current JSON version, local/VPS hosting is safer than Vercel for real data because Vercel does not provide durable local file storage.
