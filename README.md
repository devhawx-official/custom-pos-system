# DevHawx Retail POS — Demo

A lightweight, offline-first retail point of sale demo built with **HTML5, CSS3 and vanilla JavaScript**. No frameworks, no build step, no backend. All demo data is persisted in `localStorage`.

## Quick start

Open `index.html` directly in a browser, or serve the folder locally:

```bash
cd devhawx-pos
python -m http.server 4780
# http://127.0.0.1:4780
```

Classic scripts (not ES modules) are used deliberately so the app also works from `file://`.

## Project structure

```
devhawx-pos/
  index.html              App shell: sidebar, topbar, search, popovers, view mount
  css/
    style.css             Design tokens, layout, components, dashboard, views
    responsive.css        Breakpoints: search overlay, off-canvas drawer, stacking
  js/
    storage.js            Centralised localStorage API, demo seed, collections, settings
    app.js                Icons, formatters, UI helpers, router, search, popovers
    dashboard.js          KPIs, SVG sales analytics, low-stock alerts, transactions
    receipt.js            Thermal receipt renderer (58 mm / 80 mm) and print output
    products.js           Product management: table, search, filters, validated CRUD
    inventory.js          Stock overview, alerts, adjustments and movement history
    pos.js                POS terminal: product grid, cart, discounts and checkout
    customers.js          Customer directory: CRUD, search, purchase history
    sales.js              Sales history: filters, sale details, receipt reprints
    reports.js            Analytics: daily/weekly/monthly sales, breakdowns, CSV export
    settings.js           Store settings, checkout rules, storage inspector, reset
  assets/
    icons/                Brand mark and favicon (SVG)
  tests/                  Automated audit suites (Node + Chrome DevTools Protocol)
```

## Architecture

- **Namespace:** every module attaches to `window.DH` (`DH.storage`, `DH.router`, `DH.views`, `DH.ui`).
- **Routing:** hash-based (`#/dashboard`, `#/pos`, …). A module opts in by registering `DH.views.<routeId> = { render(view, route) }`.
- **Storage:** `DH.storage` is the single data layer and is also aliased as `DH.store` for the Step 01/02 API. `DH.storage.collection(key)` exposes `all / find / add / update / remove / replaceAll / count`.
- **Events:** writes emit a `dh:storage` document event so chrome (profile, storage indicator, notifications) stays in sync.
- **Shared UI:** `DH.ui.statCard` (optional `href` and `trendTone`), `DH.ui.table` (optional `className` and `bodyId`), `DH.ui.formField` / `DH.ui.setFieldError` / `DH.ui.clearFieldErrors` (validated form fields with inline messages), `DH.ui.emptyState`, `DH.toast`, `DH.modal` (optional `className`, e.g. `modal-lg`).
- **Formatting:** `DH.format.currency / number / percent / date / time` respect the store currency and locale.

## Data layer (Step 03)

All persistence goes through `js/storage.js`. Every key uses the `devhawx.pos.` prefix.

| Function | Purpose |
| --- | --- |
| `getData(key, fallback)` | Read and safely parse a key. Corrupted JSON is backed up, removed and replaced with `fallback`. |
| `saveData(key, data)` | Serialise and persist a value. Returns `true` only when `localStorage` accepted the write. |
| `updateData(key, data)` | Merge an object, or upsert one/many records in a collection by `id`. Returns the next value. |
| `deleteData(key, id)` | Delete a record from a collection, a field from an object, or the whole key when `id` is omitted. |
| `generateId(prefix)` | Readable, collision-resistant id (`prd_lx2…`). |
| `initializeDemoData()` | Seed only when the workspace is empty; otherwise repair missing schema and keep user data. |
| `resetDemoData()` | Clear every workspace key and corruption backup, then reseed the demo. Call behind a confirmation. |

Convenience helpers: `getStore / saveStore` (shop profile), `getSettings / saveSettings` (operational config merged into the flat shape views expect), `collection`, `inspect`, `getCorruptKeys`, `clearCorruptBackups`.

### Storage keys

| Key | Shape | Contents |
| --- | --- | --- |
| `meta` | object | Schema and seed versions, seeding timestamps |
| `store` | object | Store name, legal name, contact details, receipt footer |
| `settings` | object | Currency, locale, tax rate, low-stock threshold, cashier, receipt prefix |
| `preferences` | object | Sidebar state, notifications seen timestamp |
| `categories` | array | Seeded product categories (`categoryId` links from products) |
| `products` | array | Catalog with SKU, price, cost and stock |
| `inventory` | array | Restock and adjustment movements |
| `customers` | array | Directory with visit and spend totals |
| `sales` | array | Completed transactions with receipt, transaction id, payment, tax, discount and change |
| `cart` | array | Active POS cart |
| `cartDiscount` | number | Discount percentage applied to the current sale |
| `activity` | array | Notification/activity feed |

### Seeding, migration and recovery

- Demo data is written **only when every data key is absent**. A refresh with existing records never overwrites them; `meta` and `preferences` alone do not count as data.
- Workspaces created before Step 03 migrate automatically: legacy `settings.storeName` and related fields move into `store`, and missing `categories` are derived from existing products without rewriting records.
- Invalid JSON never throws. The raw value is copied to `devhawx.pos.corrupt.<key>`, the bad key is removed, the caller receives the fallback and Settings shows a recovery banner with a **Clear backups** action.
- `resetDemoData()` requires confirmation in the UI (Settings → Reset demo) and restores the deterministic sample dataset plus default preferences.
- If `localStorage` is unavailable, the same API falls back to an in-memory store for the session.

## Product management (Step 04)

`js/products.js` turns the Products route into a working catalog module.

**Table** — one row per product with product name and barcode, SKU, category chip, purchase price, selling price, stock quantity (with low/out-of-stock flags), status pill and inline edit/delete actions. A KPI strip reports total products, active products, low-stock items (using the store low-stock threshold) and categories in use.

**Search and filters** — a live search box matches product name, SKU or barcode; a category dropdown narrows the table. Both combine, show a live “x of y products” counter and fall back to a dedicated empty state with a **Clear filters** action.

**Create and edit** — one validated modal form handles both. Fields: product name, SKU, barcode, category, purchase price, selling price, stock quantity and product status (`active`, `draft`, `archived`). The form is prefilled when editing and saves through `DH.store.collection('products')`, so every change lands in `localStorage` (`devhawx.pos.products`) immediately.

**Validation**

| Rule | Message |
| --- | --- |
| Name, SKU, purchase price, selling price and stock are required | “… is required.” |
| Prices must be zero or greater | “Enter a … price of 0 or more.” |
| Stock must be a whole number of zero or more | “Stock must be a whole number.” |
| SKU must be unique | “This SKU is already used by another product.” |
| Barcode must be unique when supplied | “This barcode is already assigned to another product.” |
| A category and a valid status must be chosen | “Choose a product category.” / “Choose a valid product status.” |

Invalid fields are highlighted with inline messages and the first invalid field receives focus.

**Delete** — removing a product asks for confirmation in a modal; cancelling keeps the product, confirming removes it from `localStorage`, the table, the KPI strip and the search index. Every create, edit and delete also writes an `activity` entry so the notification feed stays current.

## Inventory management (Step 05)

`js/inventory.js` turns the Inventory route into a working stock module.

**Overview** — the KPI strip reports units on hand, stock value (at cost price), low-stock items and out-of-stock products. The stock table lists every product with its quantity, reorder point, status pill and inline **stock in / stock out / adjust** actions. Search matches product name, SKU or category, and the filter isolates all stock, low stock or out of stock.

**Alerts** — a low-stock card lists everything at or below its reorder point and an out-of-stock card lists the products that cannot be sold. Both carry a one-click **Restock** action that opens the stock-in form on the right product.

**Stock actions** — one modal handles the three movements:

| Action | Field | Result |
| --- | --- | --- |
| Stock in | Quantity received | `stock += quantity` |
| Stock out | Quantity issued | `stock -= quantity` |
| Adjust stock | New quantity on hand | `stock = quantity` |

Each form shows a live preview of the resulting stock level, accepts an optional reason (PO number, damage, count correction) and records a movement with the quantity before and after the change.

**Negative stock is prevented** — stock out is rejected when it would exceed the units on hand (“Only 39 units are on hand.”), adjustments reject negative quantities (“Stock cannot be negative.”) and the preview flags an impossible result before saving. The guard also runs in the write path, so stock can never be stored below zero.

**Movement history** — every change is logged in `devhawx.pos.inventory` with the date, product, type (stock in, stock out, adjustment, synced), signed quantity, resulting stock level and note. The newest movement is listed first and older entries stay in the log.

**Catalog synchronisation** — the catalog record stays the single source of truth for stock. When stock is edited elsewhere (for example in Product management), the difference is detected on the next inventory view and written to the log as a **Synced** adjustment, so the history stays complete without duplicating entries. Products that have never had a movement simply mirror the catalog. Every change also updates the dashboard low-stock counters and the notification feed.

## POS terminal (Step 06)

`js/pos.js` turns the Point of sale route into a working register.

**Left — catalog.** A search box matches product name, SKU or barcode, a row of category chips filters the grid, and every product is a tappable tile showing the name, SKU, selling price and the stock on hand (out-of-stock tiles are dimmed and disabled). Pressing <kbd>Enter</kbd> in the search box adds the first match to the cart.

**Right — cart and checkout summary.** Each line shows the product, unit price, available stock, a quantity stepper and a remove button. The summary shows subtotal, discount, tax (using the store tax rate) and the grand total, with a quick discount row (None, 5%, 10%, 15%, 20% or a custom percentage) that recalculates the totals instantly. **Charge** opens the checkout dialog; **Clear cart** asks for confirmation first.

**Stock is respected.** A line can never hold more units than the product has on hand — the stepper disables and the terminal warns "Only 3 units of Daily Face Mist left." instead of overselling.

**Checkout** — the charge dialog collects a payment method (Card, Cash or Digital wallet) and an optional customer, then completes the sale: the receipt is written to `devhawx.pos.sales`, stock is reduced, an `issue` movement is logged for each product, the customer's order count and spend are updated, the activity feed is refreshed, the cart and discount are cleared and a receipt summary is shown.

**Performance.** The grid and the cart update independently, so adding an item never rebuilds the catalog, the search field keeps focus while typing and the tile that was tapped flashes as confirmation. The cart is persisted on every change, so a sale survives a refresh or a crash.

## Checkout and payment (Step 07)

The **Charge** dialog in `js/pos.js` is the full checkout workflow.

**Customer** — the dialog lists every customer in the directory plus a generic *Walk-in customer*, and ends with **＋ Add walk-in customer…**. Choosing it reveals an inline form (name required, optional phone and email) that creates the customer in the directory and links the sale to it.

**Payment** — Cash, Card or Other. Selecting Cash reveals the *amount received* field, prefilled with the exact total. The change due updates live ("Change due $29.93"), and underpayment is called out before the sale can be taken.

**Validation**

| Rule | Message |
| --- | --- |
| Cash payment needs an amount | "Enter the amount received." |
| The amount must cover the total | "Amount received is less than the total due ($20.07)." |
| A new customer needs a name | "Enter the customer name." |
| A new customer email must be valid | "Enter a valid email address." |
| Every line must have stock on hand | "Not enough stock to complete this sale: Honey Oat Granola (0 left, 1 needed)." |

**Completing the sale** — the transaction gets a unique transaction id (`TXN-00163`) and receipt number (`INV-4363`), is written to `devhawx.pos.sales` with the items, subtotal, discount, tax, total, payment method, amount received and change, then stock is deducted, an `issue` movement is logged per product, the customer's order count and spend are updated and the activity feed is refreshed. The cart and the discount are cleared and the receipt is shown.

**Duplicate protection** — the confirm handler is guarded, the transaction id and receipt number are always unique, and a second submit after the dialog closed is ignored, so a double click can never record the same sale twice.

**Printable receipt** — the receipt shows the store details, receipt and transaction numbers, date, cashier, customer, line items, totals, payment, amount received and change. A **Print receipt** button opens the browser print dialog, and the print stylesheet strips the app chrome so only the receipt is printed.

## Receipt generation (Step 08)

`js/receipt.js` renders a professional thermal receipt and prints it.

**Layout** — monospaced, 58 mm or 80 mm wide, with everything a paper receipt needs:

```
DEVHAWX DEMO STORE          ← store name (uppercase, letter spaced)
DevHawx Retail Ltd.        ← legal name
18 Harbour Street, …       ← address
+1 (555) 010-2030 · …      ← phone and email
────────────────────────   ← dashed rule
Receipt      INV-4363
Transaction  TXN-00163
Date         Nov 12, 2026
Time         2:52 PM
Cashier      Admin
Customer     Amelia Hart
Items        2
────────────────────────
Aurora Espresso Blend
  1 x $18.50        $18.50  ← quantity × unit price and line total
  BEV-1042
────────────────────────
Subtotal              $35.25
Discount (10.0%)     -$3.53
Tax (8.5%)             $2.70
════════════════════════  ← solid rule
TOTAL                $34.42
────────────────────────
Payment              Cash
Amount received      $60.00
Change               $25.58
────────────────────────
▌▌▌▌ ▌▌▌ ▌▌▌▌ ▌▌      ← scannable strip + receipt number
THANK YOU FOR SHOPPING WITH US!
Thank you for shopping with DevHawx.
```

**Paper widths** — the receipt is exactly 58 mm (219 px) or 80 mm (302 px) wide, with the type size and padding tuned per width. A **58 mm / 80 mm** switch in the receipt dialog swaps the layout instantly.

**Actions on top** — the receipt dialog opens with a fixed action bar: receipt and transaction details on the left, **Print**, **Close** and **Done** buttons on the right, so everything is reachable without scrolling. The paper switch sits directly underneath.

**Scrolling** — the dialog never grows past the viewport: the receipt itself scrolls inside its own area (`overflow-y: auto`), so a receipt with dozens of items stays readable, the action bar and paper switch always stay visible, and a “Scroll for the full receipt” hint appears at the top. Short receipts show no scrollbar at all.

**Printing** — the **Print receipt** button opens the browser print dialog. The print stylesheet hides the entire application chrome, drops the modal frame, removes the shadow and prints only the receipt. Named page sizes (`@page paper58 { size: 58mm auto; }` and `@page paper80 { size: 80mm auto; }`) make the browser output a narrow thermal page instead of A4, and `preferCSSPageSize` keeps that size when printing to PDF.

Verified output: printing the 58 mm receipt produces a 165 pt wide page and the 80 mm receipt a 227 pt wide page — real thermal-printer geometry.

**Reusable** — `DH.receipt.render(sale, { paper })` returns the receipt markup and `DH.receipt.open(sale, options)` shows it in a modal, so any module (POS checkout, sales history) can print the same receipt.

## Customer management (Step 09)

`js/customers.js` turns the Customers route into a working directory.

**Directory** — every customer in a table with their name and loyalty tier, phone number, email, **total purchases**, **total spending** and last visit. Purchase count and spending are computed from the sales collection, so they always match the completed sales rather than a stale counter. A KPI strip reports customers, active buyers, customer spend and average lifetime value.

**Search and sort** — one search box matches name, phone number, email or tier, with a live “x of y customers” counter and a dedicated empty state. Customers can be sorted by recent activity, top spenders, most purchases or name A–Z.

**Add and edit** — one validated modal handles both. Fields: customer name, phone number, email and loyalty tier (Member, Silver, Gold, Platinum).

| Rule | Message |
| --- | --- |
| Name and phone are required | “Customer name is required.” / “Phone number is required.” |
| The phone needs real digits | “Enter a valid phone number.” |
| The email must be valid when given | “Enter a valid email address.” |
| The email must be unique | “This email is already used by another customer.” |

**Purchase history** — opening a customer shows their profile: total purchases, total spending, average basket, items bought, contact details and every sale they made (date, receipt, items, payment, total). Clicking a receipt reprints the thermal receipt from Step 08, so customer history and receipts stay linked.

**Delete** — removing a customer asks for confirmation and explains what happens to their receipts: the sales are kept in the history and simply lose the customer link, so no revenue history is lost.

**Linking** — customers are linked to sales automatically at checkout (existing customer or a walk-in added on the spot, see Step 07), and every add, edit or delete is written to `devhawx.pos.customers` and the activity feed.

## Sales management (Step 10)

`js/sales.js` turns the Sales route into the transaction ledger.

**Every transaction, from storage** — the view reads the `sales` collection in localStorage and lists every receipt it contains. Nothing is generated: opening, filtering or sorting the page never writes to the collection, so the ledger always matches what was actually checked out.

**Table** — receipt number (with the transaction id beneath), date and time, customer, item count, payment method and total, plus two row actions: **view details** and **print receipt**.

**Search** — one box matches receipt number, transaction id, customer name, cashier, payment method and any product name or SKU in the sale.

**Filters** — a date filter (all time, today, last 7 days, last 30 days, this month), a payment filter built from the payment methods actually present in the data, and a sort (newest, oldest, highest total, lowest total). The KPI strip and the “x of y transactions” counter always reflect the current filter.

**Sale details** — opening a sale shows its totals (subtotal, discount, tax, grand total), the customer (name, phone, email plus their lifetime purchases and spending), every purchased product with quantity, unit price and line total, and the payment (method, amount received, change, cashier, status).

**Reprinting** — the print action on any row, and the print button inside the sale detail, reopen the thermal receipt from Step 08 with the stored transaction, so any earlier receipt can be reprinted at 58 mm or 80 mm.

## Reports and analytics (Step 11)

`js/reports.js` turns the Reports route into a live analytics page. Every figure is calculated from the completed sales in localStorage — there are no hardcoded numbers, so editing a sale or adding a new one immediately changes the report.

**Headline figures** — total revenue, total transactions, average order value and items sold for the selected range.

**Date range filters** — a preset picker (all time, today, yesterday, last 7 days, last 30 days, this month, last month, this year) plus editable start and end date fields. Choosing a preset fills the dates; editing a date switches to a custom range. Every card, chart and list below follows the range.

**Sales chart** — an SVG bar chart of revenue over the range with a **days / weeks / months** granularity switch, axis labels, grid lines and a peak summary.

**Period breakdowns** — daily, weekly and monthly sales, each with a data-driven sparkline, the period total, the average per period and the peak period. Days without sales appear as empty columns rather than being skipped.

**Best-selling products** — ranked by units sold, with units, SKU and revenue per product.

**Payment method breakdown** — every tender used in the range with its transaction count, revenue and share of the total.

**Sales by category** — revenue and units per product category, resolved from the catalog.

**CSV export** — the **Export CSV** button downloads the filtered transactions as a spreadsheet-ready file (`Receipt, Transaction, Date, Time, Customer, Payment, Items, Subtotal, Discount, Tax, Total`), correctly quoted and UTF-8 encoded. The export button is disabled when the range contains no sales.

## Store settings (Step 12)

`js/settings.js` is the control centre for the workspace. Every value is stored in localStorage and applied to the whole application the moment it is saved.

**Store profile** — store name, legal/trading name, contact email, phone number, store address and the receipt footer message.

**Checkout & inventory** — currency (ten currencies from USD to NGN), tax rate (%), low stock threshold, default cashier, **default discount** (a percentage plus an "apply to new sales" switch).

**Validation**

| Rule | Message |
| --- | --- |
| Store name is required | “Store name is required.” |
| The email must be valid | “Enter a valid email address.” |
| The phone must look real | “Enter a valid phone number.” |
| Tax rate between 0 and 100 | “Tax rate must be between 0 and 100.” |
| Threshold and discount in range | “Low stock threshold must be 0 or more.” / “Default discount must be between 0 and 100.” |

**Applied immediately** — saving triggers a store-wide refresh, so the new currency re-formats every amount (dashboard, register, reports, receipts), the new tax rate re-prices the cart and the receipt, the new store name and footer appear on printed receipts and in the dashboard greeting, and the new low-stock threshold re-counts the inventory alerts. The **default discount** switch makes every new sale start with that discount, and clearing the cart resets it.

**Receipt preview** — a card shows the store header exactly as it will print, and a button opens the real thermal receipt (58 mm / 80 mm) built from the current settings.

**Data management** — the storage inspector lists every key with its type, record count and size, warns about corrupted values with a **Clear backups** action, and the demo workspace can be restored from scratch behind a confirmation.

## Audit and optimisation (Step 13)

A full pass over the finished application: every area was exercised end to end, dead code removed, and the runtime trimmed.

**Audit coverage** — 306 automated checks across twelve suites cover navigation links, product CRUD, inventory synchronisation, cart maths, discounts and tax, checkout, payment validation, receipt printing, customer management, sales history, reports, localStorage persistence, refresh behaviour, demo reset, mobile responsiveness and console health. Every route is also checked for horizontal overflow at 360, 414 and 768 px.

**Bugs found and fixed**

| Bug | Fix |
| --- | --- |
| The corrupted-value banner was dropped from the Settings storage inspector | Banner restored and covered by the regression suite |
| The “apply default discount” toggle inherited `width: 100%` and stretched the page by ~310 px | Toggle styles scoped to the switch, page overflow eliminated |
| The profile-menu reset called a removed storage alias and threw | Reset now calls `DH.store.resetDemoData()` |
| Deferred scripts booted before the view modules were registered | Boot now waits for `DOMContentLoaded`, which fires after every deferred module runs |
| Per-product reorder points silently overrode the store threshold | The store-wide low-stock threshold is the single source of truth |

**Dead code removed** — `DH.util.uid`, `DH.ui.comingSoon` and the `data-soon` click handler, the `COLLECTIONS`/`clearCollection`/`remove`/`seedDemo`/`uid` storage aliases, the unused `reorderPoint` field and seven orphaned CSS blocks.

**Optimisations**
- Scripts are `defer`red, so the eleven modules download in parallel while the HTML parses
- The web font loads without blocking the first paint (system stack until it arrives)
- The settings save coalesces its two storage writes into a single refresh
- The customer directory indexes the sales once per render instead of scanning them per row
- List views patch only their table body on search, filter and sort — the toolbar, focus and scroll position are preserved
- Warm start: **DOMContentLoaded ≈ 40 ms**, first paint ≈ 90 ms, 489 DOM nodes

**Weight** — 358 KB of hand-written HTML, CSS and JavaScript with no framework, no build step and no dependencies; roughly 65 KB over the wire compressed. Still fully usable from `file://`.

## Design system

| Token | Value |
| --- | --- |
| Navy | `#0B192C` |
| Electric blue | `#2F6BFF` |
| Cyan | `#22D3EE` |
| Surface | `#FFFFFF` |
| App background | `#F3F6FB` |

The desktop sidebar collapses to an 88px icon rail via the topbar menu button; the choice is saved in `.preferences`. Breakpoints: `1100px` turns search into a full-width overlay, `900px` switches to an off-canvas drawer, `720px` and `520px` stack dashboard and report content.

## Build status

| Step | Module | State |
| --- | --- | --- |
| 01 | App shell, design system, routing, storage wrapper | Done |
| 02 | Dashboard, topbar search, notifications, profile, responsive layer | Done |
| 03 | Centralised localStorage data architecture, demo seed, reset | Done |
| 04 | Product management (table, search, category filter, validated CRUD) | Done |
| 05 | Inventory management (overview, stock in/out, adjustments, alerts, movement log) | Done |
| 06 | POS terminal (catalog grid, cart, discounts, tax, checkout) | Done |
| 07 | Checkout and payment (customers, cash/change, validation, receipts) | Done |
| 08 | Receipt generation (thermal layout, 58/80 mm, print output) | Done |
| 09 | Customer management (directory, CRUD, purchase history) | Done |
| 10 | Sales management (history, filters, sale details, reprints) | Done |
| 11 | Reports and analytics (aggregations, ranges, CSV export) | Done |
| 12 | Store settings (profile, checkout rules, discount defaults) | Done |
| 13 | Audit, bug fixes and optimisation | Done |

## Next build steps

1. Loyalty tiers and customer segments
2. Stock valuation and margin reporting
3. Multi-register shifts and cash drawer reconciliation
