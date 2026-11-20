# DevHawx POS — automated test suites

Every suite drives a real Chrome instance over the DevTools Protocol against a
running demo server. They need Node 18+ and Chrome; no test framework, no
dependencies.

## Run the app first

```bash
cd devhawx-pos
python -m http.server 4780
# http://127.0.0.1:4780
```

## Run the checks

```bash
node tests/11-full-audit.mjs     # end-to-end audit of every module (24 checks)
node tests/01-foundation.mjs     # shell, routing, dashboard, storage, reset (62)
node tests/02-products.mjs       # product CRUD, search, filters (28)
node tests/03-inventory.mjs      # stock movements, alerts, sync (25)
node tests/04-pos.mjs            # cart, discounts, tax (25)
node tests/05-checkout.mjs       # payment validation, checkout, receipts (20)
node tests/06-receipt.mjs        # thermal receipt, 58/80 mm printing (21)
node tests/07-customers.mjs      # customer CRUD, purchase history (24)
node tests/08-sales.mjs          # sales history, filters, reprints (23)
node tests/09-reports.mjs        # aggregations, ranges, CSV export (18)
node tests/10-settings.mjs       # store settings and live application (18)
node tests/12-accessibility.mjs  # heading structure and console health
```

Each script prints `PASS` / `FAIL` lines, finishes with a summary and exits with
a non-zero code when a check fails, so it can be used in CI.

## Options

| Variable | Default | Purpose |
| --- | --- | --- |
| `DH_BASE` | `http://127.0.0.1:4780/` | Where the demo is served |
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Chrome executable |

Screenshots are written to `tests/screenshots/`.

> The suites drive a shared browser profile of their own and always restore the
> demo data at the end, so running them never leaves your workspace changed.
