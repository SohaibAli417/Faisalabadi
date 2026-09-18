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

## Editing Customers and Udhar (v22)

Open `Customers and Udhar`.

- The table shows each customer's total credit, total paid, balance, and the date/time of their last payment.
- Use the search box above the table to filter customers by name or phone.
- The `Export CSV` button downloads a `customers.csv` file (name, phone, masked CNIC, address, credit limit, total udhaar, paid, remaining, payment date/time, status).
- Click `Edit` on any row to open the edit screen.

In the customer edit screen:

- Name, phone, CNIC, address, and credit limit are editable by anyone with customer access.
- CNIC shows masked; it is only changed if you type a full new number.
- `Total Udhaar`, `Total Paid`, and `Payment Date/Time` are only shown to Admin or Manager.
- The remaining balance is calculated live as Total Udhaar minus Total Paid.
- Udhaar amounts are only written when you actually change them. Routine sales, returns, and payments automatically keep the edited totals in line, so balances never drift.

To record a normal payment, use the `Khata` button and `Pay Udhar`. The payment form lets you set the payment date and time (useful for late bookkeeping).

## Editing Products and Inventory (v22)

Open `Products` or `Inventory`.

- Use the search box to filter by name, SKU, barcode, or category.
- Click `Edit` on a product row (Admin/Manager) to open the edit screen.
- Editable fields: product name, category, SKU, barcode, purchase cost, sale price, stock quantity (supports loose weight units), low-stock reorder level, unit (pcs, pack, kg, etc.), and Active/Inactive status.
- Marking a product Inactive hides it from the POS but keeps old bills correct.
- Products with billing history cannot be permanently deleted; the app offers to mark them Inactive instead.
