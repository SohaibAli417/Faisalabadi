# Faislabadi General Store POS - Implementation Plan

Source: `Faislabadi_General_Store_POS_Requirements.pdf`

## Current State

The project currently contains a static React UMD frontend served by a small Node HTTP server. The existing UI demonstrates the intended POS screens but uses hardcoded data and demo login. The backend, database, docs, and shared folders are otherwise empty.

## Requirement Traceability

| # | Requirement | Current coverage | Implementation plan |
|---|---|---|---|
| 1 | Online and offline POS with automatic sync | Partial UI only | Add persisted backend APIs, client offline queue, and `/api/sync` endpoint for replaying offline sales. |
| 2 | Barcode scanner support and manual product entry | Partial UI | Keep barcode/name search, support scanner input, add manual cart lines and persisted product lookup. |
| 3 | Billing, invoice printing, bill reprint/revert | Partial UI | Persist invoices, add receipt view/print, sale lookup, and controlled void/revert action with audit log. |
| 4 | Product management with stock, remaining quantity, purchase/sale price | Partial UI | Add product CRUD API and persisted fields for SKU, category, stock, reorder level, cost, price, and unit. |
| 5 | Profit and Loss reports | Missing | Add reports API calculating revenue, cost, gross profit, discounts, tax, returns, and net sales. |
| 6 | Daily, Monthly, Yearly sales reports | Missing | Add period filters to reports API and frontend report cards/tables. |
| 7 | Customer Udhar/Credit management with Name, Phone, CNIC optional/masked | Partial UI | Add customer API, credit ledger, masked CNIC rendering, and credit sale support. |
| 8 | Backup system with automatic backups; backups cannot be deleted from POS | Missing | Add append-only backup creation endpoint and startup backup rotation. Do not expose delete endpoints. |
| 9 | User roles and permissions | Demo only | Add login API, session tokens, roles, permission map, and route enforcement for admin/manager/cashier. |
| 10 | Purchase, supplier and inventory management | UI placeholder | Add supplier and purchase APIs that increase stock and record cost. |
| 11 | Low stock alerts | Demo only | Add reorder-level checks in dashboard/report APIs. |
| 12 | Discounts, taxes, returns and refunds | Partial UI | Persist discount/tax per sale and add return/refund endpoint that restores stock and links to original sale. |
| 13 | Dashboard with sales, stock and analytics | Demo only | Add dashboard API backed by persisted sales, products, returns, and customers. |
| 14 | Search products by barcode/name | Partial UI | Add backend search and frontend scanner-friendly search field. |
| 15 | Receipt printing and export reports PDF/Excel | Partial UI | Add printable HTML receipts and CSV exports now; PDF/Excel can be added through open-source libraries later. |
| 16 | Secure login and audit logs | Demo only | Add password hashing, token sessions, role checks, and append-only audit log entries. |

## Delivery Phases

1. Foundation: replace demo-only server with REST APIs, JSON persistence, startup backup, auth, audit log, and tests.
2. POS workflow: connect frontend to APIs, support offline sale queue, receipt printing, reprint, void/revert, tax, discount, and stock updates.
3. Management workflow: product, inventory, customer/credit, supplier, purchase, user, and settings screens backed by APIs.
4. Reporting: dashboard, profit/loss, daily/monthly/yearly reports, CSV export, and low-stock analytics.
5. Deployment: configure GitHub remote and Vercel project once access is provided; keep `.env` and secrets out of Git.

## Production Notes

- This first pass uses an open-source, dependency-light Node backend and JSON persistence to make the system runnable immediately.
- A larger production deployment should move persistence to PostgreSQL or another managed database before multiple stores/counters use it concurrently.
- Backups are created in `database/backups/` and the POS UI does not expose deletion.
- Default seeded users are for initial setup only and should be changed before live use.
