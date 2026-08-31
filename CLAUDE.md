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
npm run stats             # spend by year/month, top series, discounts (offline)
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

`prestart`, `preorders` and `preorder-details` npm lifecycle hooks run `src/ensure-cookie.js` before the three commands that need a cookie. It is deliberately standalone: it must **not** import `orders-config.js`, because that exits the process when `ORDERS_COOKIE` is missing — exactly the case it exists to repair. It also runs without `--env-file`, since `.env` may not exist yet and Node errors on a missing env file. It prompts only when the cookie is *absent* (`hasUsableCookie` also rejects the `.env.example` placeholder, a blanked value whose comment merely mentions `PHPSESSID`, and any value with no `PHPSESSID=`); an **expired** cookie still passes that check.

The hook is deliberately **never fatal on a missing cookie** — it warns and returns 0. `npm start` needs no cookie at all (neither `server.js` nor `export-excel.js` imports `orders-config.js`), so failing there would break browsing existing data in Docker or CI; and the scraping commands already report a missing cookie themselves from `orders-config.js:3`. It only exits 1 when `.env` exists but cannot be read, which is a real fault rather than a missing setup. An exported `ORDERS_COOKIE` short-circuits the whole check, because Node's `--env-file` does not override an already-set variable and `ORDERS_COOKIE=… npm run orders` is a working setup.

An **expired** cookie is caught at the other end instead: `src/index.js` wraps the
command, and on `SessionExpiredError` calls `promptForCookie()` from
`ensure-cookie.js` — the same prompt-validate-save flow the hook uses — then runs
the command again, once. This is why `orders-config.js` exposes `cookie` as a
**getter** and why `fetch-order-details.js` passes `cookie` per request rather
than baking it into its module-level `HEADERS`: a captured string would make the
retry reuse the dead cookie. The retry is skipped when `process.stdin` is not a
TTY, since there is nobody to ask and the error already says what to do.

The retry loop is `resolveSessionId({ ask, check })` with both injected, so it is unit-tested without a pty; `askOnce` wraps `rl.question` with a `close` listener because `readline/promises` leaves the promise pending forever on Ctrl-D.

`ORDERS_COOKIE` is never parsed — `orders-config.js:8` reads it and both fetchers drop it verbatim into the `cookie:` header (`fetch-orders.js:22`, `fetch-order-details.js:11`). **`PHPSESSID` is the only cookie the site requires**, verified against the live site: with it alone both `/sales/order/history/` and `/sales/order/view/` return 200 and parse identically to the full browser cookie; without it (even with all 19 others) both return 302 to login. Everything else a browser sends — Google Analytics, TikTok, Hotjar, Klaviyo, Mixpanel, and Magento's `X-Magento-Vary` / `form_key` / `section_data_ids` — is ignored for these GETs. A 302 rendering as zero orders or empty `items[]` means `PHPSESSID` expired. Both
fetchers now detect this rather than letting it through: `src/session.js` holds
`SessionExpiredError`, `isRedirect`, and the `NO_REDIRECT` axios options
(`maxRedirects: 0` plus a `validateStatus` that admits 3xx so it can be
inspected instead of thrown by axios). **Redirect-following must stay off in both
fetchers** — with it on, the login page arrives as an ordinary 200 and cheerio
just finds nothing.

**Only a redirect to `/customer/account/login` counts as expiry** (`isLoginRedirect`),
and it counts on any page. Measured against the live site:

| Request | Result |
|---|---|
| valid `PHPSESSID` | 200 with the table |
| invalid / absent `PHPSESSID` | 302 → `/customer/account/login/referer/<base64>` |
| page past the last (`p=4`, `p=99` of 3) | **200 that silently re-serves page 1** — never a 3xx |
| `order_id` that is not viewable | 302 → `/sales/order/history/` |

Those last two rows are why the check is on the *target* and not on the status.
Pagination never redirects, so a login redirect on page 5 is a session that died
mid-scrape, not the end of the list — treating it as the end silently truncated
`orders.json`. And a detail page bouncing to the history page is one unviewable
order, not a dead cookie, so it fails that order alone instead of aborting the run.

`fetch-order-details.js` sets an `expired` flag on the first login redirect, which
makes `mapPool` skip the remaining orders, and then **throws before `writeFile`**.
Both fetchers also carry an empty-overwrite backstop for the failure modes no
redirect check can see (a 200 login page, stale cheerio selectors): `orders.json`
is never replaced by a 0-order scrape, and `orders-details.json` is never replaced
by a run where no order produced items. The details guard reads the previous file
**even under `--force`**, since `--force` empties the cache but not the risk.

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

Both the CLI and the UI highlight the matched substring — only in the field that
was actually searched (`HIGHLIGHTS` in `find-orders.js` maps each field to the
printed cells it may mark), so a mark always explains why a row matched. The two share a
deliberate shape: `highlight(text, query, wrap)` in `find-orders.js` and
`splitMatches(text, query)` in `client/src/components/Highlight.jsx` both escape
the query before building a `RegExp` and both use the **function form** of
`replace`/`exec`, so a query containing `$&` or `(` cannot corrupt the output.
The CLI emits ANSI only when `colorEnabled()` says so (off when piped or under
`NO_COLOR`, forced by `FORCE_COLOR`); the UI wraps matches in `<mark class="hl">`.
`Highlight.jsx` never uses `dangerouslySetInnerHTML` — segments are rendered as
React nodes, so scraped text stays inert. It also matches on the **raw** query,
not a trimmed one, because `useDataTable` filters on the raw query; trimming only
here would mark `set` on rows that were kept for `set `.

```
fetch-orders  -> orders.json ------> sum-orders   (stdout)
                      |
                      +-----> fetch-order-details -> orders-details.json
                      |
                      +-----> export-excel -------> orders.xlsx / buffer
```

`fetch-order-details.js` re-reads `orders.json` and emits enriched copies of each row with `orderId` and an `items[]` array (`{name, sku, price, quantity, subtotal}`), so detail records are a superset of order records. It cannot run concurrently with `fetch-orders` — it consumes that command's output file.

Progress lines are printed through `createOrderedLog()`, which parks each finished index until every earlier one has printed, so the log counts `[1/103]`, `[2/103]`… even though 4 workers finish out of order. It takes a print *function*, not a string, so each caller keeps its own stream; **every worker path must call `report(i, …)`**, passing `null` when it prints nothing — an index that never reports stalls the cursor and silences the rest of the run.

Detail fetching runs through `mapPool(items, CONCURRENCY, worker)` at 4 in flight (measured: the site saturates there, 8 is no faster) and writes results back by index, so output order always matches `orders.json`. Before fetching, `isCacheable()` decides whether the previous `ORDERS_DETAILS_FILE` entry can be reused: only for a **terminal status** (`จัดส่งแล้ว`, `ออร์เดอร์ยกเลิก`) whose status is unchanged, with no recorded `error` and a non-empty `items[]` — so a failed or empty parse never gets frozen into the cache. Unrecognised statuses are always re-fetched. `--force` bypasses the cache entirely. Typical numbers on ~100 orders: 63s for a full re-fetch, ~8s when most orders are cached.

**The order list scrape is incremental.** `fetch-orders.js` reads the existing
`orders.json` first and stops paging at the first order number it already has —
the history is newest-first and append-only, so a familiar order means
everything below it is on disk. On ~100 orders that is 1 page fetched instead
of 4. `--force` re-crawls everything.

Two rules keep that from going stale, both in `canStopEarly` / `pendingNumbers`:

- **One known order on a page is enough to stop.** Requiring the whole page to
  be known costs an extra fetch whenever new and old orders share a page, which
  is the usual case.
- **Except while a known order is still in progress.** A
  `กำลังเตรียมสินค้า` order will later become `จัดส่งแล้ว`; stopping above it
  would freeze that status forever. Paging continues until every non-terminal
  order on disk has been re-read — cheap in practice, since pending orders are
  the newest.

`TERMINAL_STATUSES` / `isTerminal()` moved into `orders-total.js`, which already
owned `STATUS_KEY` and `CANCELLED_STATUS`; `fetch-order-details.js` had a
private duplicate and now imports it. An unrecognised status counts as still
moving, so a status the site adds later is re-fetched rather than frozen.

`mergeOrders()` puts the scraped run on top of whatever was not re-read, so a
re-read order replaces its stored copy (that is how a status change lands) and
the newest-first ordering survives the join. A merge can only grow the list;
writing fewer orders than the file already held is refused, alongside the
existing empty-scrape guard.

**`npm run stats`** is offline and read-only like `find-orders.js` — it must not
import `orders-config.js`, since it needs no cookie. It reports spend by year and
month, top series, discount codes, and the gap between list price and paid.

It is **split across two modules**, and the split is what keeps the CLI and the
UI from disagreeing:

- `src/stats-report.js` computes the figures (`groupSpend`, `fillMonths`,
  `seriesSpend`, `priceGap`, `discountCodes`, `parseOrderDate`). Like
  `orders-total.js` and `product-name.js` it is **free of Node imports**, so the
  browser bundle can import it.
- `src/stats-orders.js` is the CLI half: `readJson`, `parseArgs`, `run`, and the
  fixed-width text renderer `report()`/`bar()`. It re-exports everything it
  moved, so importers and `stats-orders.test.js` still reach for it here.

The Stats tab (`client/src/components/StatsPanel.jsx`) is the second renderer
over the same figures. A stray Node import in `stats-report.js` would break the
Vite bundle while every Node-run test stayed green — the same failure shape that
once broke `npm run excel` — so `StatsPanel.test.jsx` asserts statically that the
module imports nothing but relative paths.

Notes worth keeping:

- Dates arrive as `"29/8/26 29 สิงหาคม 2026"`. Only the `d/m/yy` prefix is
  parsed; the Thai half is redundant and would need a month-name table. It is
  **day-first** (`29` cannot be a month) and years run 2019–2026, so `yy` maps
  to `2000+yy`.
- Series totals are **list prices** from item subtotals. An order-level discount
  cannot be attributed to one item, so the report labels them rather than
  silently apportioning.
- **Discount codes are reported by order count, never by money.** An order row
  carries `โค้ดส่วนลด` and `ราคาสุทธิ` and no discount amount, so the only money
  `discountCodes()` could report is the net spend on the orders that used a
  code — which reads as "saved with this code" and is a different, much larger
  number. `StatsPanel.test.jsx` guards the column list so it cannot creep back.
- The site exposes no discount line, so the discount is **derived** as
  `sum(item subtotals) - net price`. That gap runs both ways: positive is a code
  discount, negative is the flat ฿35/฿50 delivery fee on older small orders.
  They are reported as separate figures because netting them off hides both.
  Orders with no priced items are skipped and counted, never treated as 100% off.
- Months with no orders are filled in as explicit zeroes (`fillMonths`); showing
  only the months that had orders reads as a continuous run and hides the gaps.

**Scraper conventions.** Both fetchers send a full hardcoded Chrome header set plus the session cookie and both run with redirects disabled. `fetch-orders.js` treats a missing `#my-orders-table`, a page whose first order number repeats page 1, or a 3xx **on page >1** as "past the last page" — a 3xx on page 1 is an expired session instead (see Environment). `fetch-order-details.js` does not sleep between requests; it relies on `CONCURRENCY = 4` for pacing. Both parse with cheerio against site-specific class names — selector breakage is the expected failure mode when the site changes.

**Server.** `server.js` exports the Express app and only calls `listen` when `NODE_ENV !== 'test'`, so tests drive it with supertest. It binds `127.0.0.1` only. Routes just read the JSON files and 404 with a message naming the npm script to run. `/api/excel/download` imports `generateBuffer` from `export-excel.js` lazily.

**Client.** Vite's root is `client/` and its config lives at `client/vite.config.js`, so it must be started with `--config client/vite.config.js` (the npm scripts do this). The dev server proxies `/api` to `:3001`. `useDataTable.js` is the shared search/sort/pagination hook — search recurses into nested arrays and objects so a query matches SKUs inside `items[]`, and sorting tries a `฿`/comma-stripped numeric compare before falling back to `localeCompare(…, 'th')`.

The third tab, **Stats**, renders the `npm run stats` figures rather than
printing them. It takes `orders` and `details` as props — App.jsx already holds
both — so there is **no `/api/stats` route and no second fetch**, and the tab
agrees with the header total by construction. It caps at 10 series / 12 months
like the CLI, with a `Show all` toggle per capped section so the UI is not weaker
than `--all`. Bars are CSS divs scaled against the largest value in their own
table; the month section additionally draws every month since the first order as
one strip, which is what makes `fillMonths`' zero-filled quiet months legible as
gaps rather than as a list of dashes.

`safeHref` in `OrdersTable.jsx` gates scraped URLs to http/https before rendering them as links; keep it in front of any newly rendered scraped URL, since hrefs come from untrusted page content.

**Product names are structured, and `src/product-name.js` is where that structure is decoded.** Item names follow a positional convention:

```
(PRE/MAY)(LN) Complete Set  ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน ปี 2  เล่ม 12.5
\__________/\__/ \________/ \_________________________________________/  \________/
 pre-order   kind    set                      series                        volume
```

`parseProductName()` splits those into `{preorder, preorderMonth, kind, set, series, volume, note}`, which is what the three facet selects on the Order Details tab are built from (`collectFacets`, `matchesFacets`). Like `orders-total.js`, it is **free of Node imports** so the browser bundle can import it.

Rules worth keeping, each forced by real data:

- **Everything is positional.** The set is only read directly after the tag run — `ครบ 1,000 บาท - Mini Clear Bookmark Set` is merchandise, not a `Bookmark Set` edition. `SET_TYPES` is ordered longest-first so `Short Story Set` wins over a suffix match.
- **An unrecognised leading `(...)` stops the tag scan** rather than being stripped, because an unknown tag is more likely title text than metadata.
- **The *last* `เล่ม N` wins** — a few titles carry a per-volume subtitle after it (`เล่ม 1 จอมมารผู้ไม่ยอมให้เคลียร์เกม`).
- **`seriesKey()` folds the spellings the site uses for one series** — `★`/`☆`, `―`/`-`, `ปีสอง`/`ปี 2`, stray spaces and trailing `!`. Without it the same series splits into several options. The select shows whichever spelling is most common.
- **Giveaways collapse into one `Free gift / goods` bucket.** `Free Gift - …` and `ครบ N บาท - …` are spend-threshold promos; parsed as series they contribute ~33 one-off options and swamp the list.
- **The type tag is `(MG)` for manga, not `(มังงะ)`** — the Thai word never appears as a tag in the scraped data.

Filtering is item-level: an order is kept when any of its items matches, and the card is then narrowed to just the matching items, the same rule `find-orders.js` applies to `level: 'item'` fields.

`DataTableControls.jsx` takes two generic, optional props so both tables share one control bar: `filters` (selects) and `toggles` (checkboxes). Both default to `[]`, so a table that passes neither renders exactly as before. The **Exclude cancelled** toggle is on both tabs and reuses `isCancelled` from `orders-total.js` — the same rule as the header total and `npm run sum` — and is hidden entirely when the data holds no cancelled order. `Clear filters` appears when any select *or* toggle is set and resets all of them.

## Testing

Vitest runs in the `node` environment by default. React/hook tests opt into jsdom with a docblock pragma on line 1:

```js
// @vitest-environment jsdom
```

Tests are colocated (`src/foo.js` + `src/foo.test.js`); shared fixtures live in `tests/fixtures/`. `export-excel.test.js` drives the real exceljs path via `generateBuffer()` against
a temp fixture and reads the workbook back, because the `parsePrice` unit tests
passed while `npm run excel` was broken. Coverage of the scrapers is thin — the suite exercises pure helpers (`parsePrice`, `buildUrl`, `getDetailUrl`, `safeHref`, `useDataTable`) and mocks `fs/promises` for server routes, so it does **not** catch exceljs or cheerio breakage. Verify those by running the real command against a fixture.

## Money

`src/orders-total.js` is the single source of truth for what an order is worth
and what "total" means. It holds `parsePrice`, `isCancelled`, `summarise` and
`formatBaht`, and is deliberately free of Node imports so the browser bundle can
import it too — `client/vite.config.js` sets `server.fs.allow: ['..']` for the dev
server (the production build resolves it without help).

**Cancelled orders (`ออร์เดอร์ยกเลิก`) are not money spent.** `summarise` returns
`spent` (excluding them), `cancelledCount`/`cancelledAmount`, `gross`
(= spent + cancelled) and `noPrice`. All three consumers show `spent` and report
the cancelled money beside it rather than folding it in: `npm run sum` prints
three lines, the Excel sheet has three **labelled** total rows with cancelled
order rows struck through, and the UI header shows `Total: ฿…` with a muted
`+฿… cancelled` note.

This replaced a real disagreement: sum excluded cancelled while Excel and the UI
included them, so the same 103 orders were reported as ฿157,191.00 or ฿166,003.50
with nothing on screen saying which rule applied. `sum-orders.js` and
`export-excel.js` still re-export `parsePrice` for back-compat — `export-excel.js`
must `import` it as well as re-export it, since `export { x } from '…'` does not
bind the name locally, and that mistake broke `npm run excel` while every unit
test stayed green.

## Dependencies

`package.json` pins `uuid` to `^11.1.1` via an `overrides` block on exceljs, resolving advisory GHSA-w5hq-g745-h8pq. Do not run `npm audit fix --force` — it "resolves" this by downgrading exceljs from 4.x to 3.x, which is a major version backwards and still ships a vulnerable uuid. Keep exceljs on `^4.4.0` and the override in place.
