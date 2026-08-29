# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Scrapes order history from phoenixnext.com (a Thai e-commerce site) into JSON, then sums it, exports it to Excel, or browses it in a React UI. Everything runs locally against files on disk — there is no database.

See `README.md` for user-facing setup and how to obtain the `ORDERS_COOKIE`.

## Commands

```bash
npm start                 # Express API (:3001) + Vite dev server (:5173) together
npm run server            # API only
npm run orders            # scrape order list      -> orders.json
npm run order-details     # scrape items per order -> orders-details.json (needs orders.json)
npm run sum               # print total spend
npm run excel             # write orders.xlsx
npm run find [key] <value># search scraped data offline (default key: name)
npm test                  # vitest run
npm run test:watch
npm run test:coverage     # v8 coverage over src/**, client/src/**, server.js
```

Run a single test file or test:

```bash
npx vitest run src/sum-orders.test.js
npx vitest run -t 'rejects javascript: URLs to prevent XSS'
```

There is no linter or build step for the server; `vite build` (via `client/vite.config.js`) outputs to `dist/`.

## Environment

Config comes from `.env`, loaded by Node's native `--env-file` flag (Node 20.6+, no dotenv). **Every npm script that needs config passes `--env-file=.env`** — invoking `node src/index.js orders` directly will not load `.env` and will exit with a missing-cookie error.

`src/orders-config.js` validates `ORDERS_COOKIE` and calls `process.exit(1)` **at import time**. Any module that imports it inherits that behavior, which is why `tests/setup.js` seeds `ORDERS_COOKIE` and `ORDERS_URL` before tests load.

`ORDERS_COOKIE` is never parsed — `orders-config.js:8` reads it and both fetchers drop it verbatim into the `cookie:` header (`fetch-orders.js:22`, `fetch-order-details.js:11`). **`PHPSESSID` is the only cookie the site requires**, verified against the live site: with it alone both `/sales/order/history/` and `/sales/order/view/` return 200 and parse identically to the full browser cookie; without it (even with all 19 others) both return 302 to login. Everything else a browser sends — Google Analytics, TikTok, Hotjar, Klaviyo, Mixpanel, and Magento's `X-Magento-Vary` / `form_key` / `section_data_ids` — is ignored for these GETs. A silent 302 rendering as zero orders or empty `items[]` means `PHPSESSID` expired.

## Architecture

**Thai column names are the data contract.** The scraper reads the site's `<thead>` cells and uses them verbatim as object keys, so records are keyed by Thai strings that flow unchanged through JSON, Excel, and the UI:

| Key | Meaning |
|---|---|
| `หมายเลขคำสั่งซื้อ` | order number |
| `วันที่ซื้อ` | purchase date |
| `ราคาสุทธิ` | net price (e.g. `"฿1,234.56"`) |
| `สถานะ` | status (`ออร์เดอร์ยกเลิก` = cancelled) |
| `ดูรายละเอียด` | detail page URL |

These are hardcoded as string literals in `src/sum-orders.js`, `src/export-excel.js`, `client/src/App.jsx`, `client/src/components/OrdersTable.jsx`, and `OrderDetailsTable.jsx`. If the site renames a column, all of them must change together. Prices are always strings with `฿` and thousands separators — parse before doing arithmetic.

**Pipeline.** `src/index.js` is a dispatcher mapping a command name to a dynamic import; each module exports `run()`. To add a command, add an entry to `COMMANDS` and export `run()` from the new module. Commands read their own extra arguments off `process.argv` — the dispatcher forwards nothing (`find` uses `process.argv.slice(3)`, `order-details` checks for `--force`).

`find-orders.js` is read-only and offline: it searches `ORDERS_DETAILS_FILE` and never imports `orders-config.js`, so it works without a cookie. Fields are declared in one `FIELDS` table marked `level: 'order'` or `level: 'item'`, which is what decides whether a match reports the whole order's items or just the matching ones; `ALIASES` maps ASCII names onto the Thai keys so they can be typed at a shell. It imports `parsePrice` from `sum-orders.js` rather than adding a fourth copy.

```
fetch-orders  -> orders.json ------> sum-orders   (stdout)
                      |
                      +-----> fetch-order-details -> orders-details.json
                      |
                      +-----> export-excel -------> orders.xlsx / buffer
```

`fetch-order-details.js` re-reads `orders.json` and emits enriched copies of each row with `orderId` and an `items[]` array (`{name, sku, price, quantity, subtotal}`), so detail records are a superset of order records. It cannot run concurrently with `fetch-orders` — it consumes that command's output file.

Detail fetching runs through `mapPool(items, CONCURRENCY, worker)` at 4 in flight (measured: the site saturates there, 8 is no faster) and writes results back by index, so output order always matches `orders.json`. Before fetching, `isCacheable()` decides whether the previous `ORDERS_DETAILS_FILE` entry can be reused: only for a **terminal status** (`จัดส่งแล้ว`, `ออร์เดอร์ยกเลิก`) whose status is unchanged, with no recorded `error` and a non-empty `items[]` — so a failed or empty parse never gets frozen into the cache. Unrecognised statuses are always re-fetched. `--force` bypasses the cache entirely. Typical numbers on ~100 orders: 63s for a full re-fetch, ~8s when most orders are cached.

**Scraper conventions.** Both fetchers send a full hardcoded Chrome header set plus the session cookie; `fetch-orders.js` uses `maxRedirects: 0` and treats a 3xx, a missing `#my-orders-table`, or a page whose first order number repeats page 1 as "past the last page". `fetch-order-details.js` sleeps 500ms between requests. Both parse with cheerio against site-specific class names — selector breakage is the expected failure mode when the site changes.

**Server.** `server.js` exports the Express app and only calls `listen` when `NODE_ENV !== 'test'`, so tests drive it with supertest. It binds `127.0.0.1` only. Routes just read the JSON files and 404 with a message naming the npm script to run. `/api/excel/download` imports `generateBuffer` from `export-excel.js` lazily.

**Client.** Vite's root is `client/` and its config lives at `client/vite.config.js`, so it must be started with `--config client/vite.config.js` (the npm scripts do this). The dev server proxies `/api` to `:3001`. `useDataTable.js` is the shared search/sort/pagination hook — search recurses into nested arrays and objects so a query matches SKUs inside `items[]`, and sorting tries a `฿`/comma-stripped numeric compare before falling back to `localeCompare(…, 'th')`.

`safeHref` in `OrdersTable.jsx` gates scraped URLs to http/https before rendering them as links; keep it in front of any newly rendered scraped URL, since hrefs come from untrusted page content.

## Testing

Vitest runs in the `node` environment by default. React/hook tests opt into jsdom with a docblock pragma on line 1:

```js
// @vitest-environment jsdom
```

Tests are colocated (`src/foo.js` + `src/foo.test.js`); shared fixtures live in `tests/fixtures/`. Coverage of the scrapers and Excel builder is thin — the suite exercises pure helpers (`parsePrice`, `buildUrl`, `getDetailUrl`, `safeHref`, `useDataTable`) and mocks `fs/promises` for server routes, so it does **not** catch exceljs or cheerio breakage. Verify those by running the real command against a fixture.

## Known inconsistencies

- `parsePrice` is duplicated verbatim in `src/sum-orders.js` and `src/export-excel.js`, with two more ad-hoc copies of the same `.replace(/[฿,]/g, '')` logic in `client/src/App.jsx` and `useDataTable.js`.
- Totals disagree by design gap: `npm run sum` **excludes** cancelled orders (`ออร์เดอร์ยกเลิก`), while the Excel total row and the UI header total include them.

## Dependencies

`package.json` pins `uuid` to `^11.1.1` via an `overrides` block on exceljs, resolving advisory GHSA-w5hq-g745-h8pq. Do not run `npm audit fix --force` — it "resolves" this by downgrading exceljs from 4.x to 3.x, which is a major version backwards and still ships a vulnerable uuid. Keep exceljs on `^4.4.0` and the override in place.
