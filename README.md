# Phoenix Order History

A local tool for scraping, browsing, and exporting your order history from [phoenixnext.com](https://www.phoenixnext.com).

Includes a CLI for fetching data and an optional web UI for searching, sorting, and downloading an Excel report.

---

## Requirements

- **Node.js 20.6+** (uses the native `--env-file` flag — no dotenv needed)
- A [phoenixnext.com](https://www.phoenixnext.com) account with order history

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your environment

Copy the example file and fill in your cookie:

```bash
cp .env.example .env
```

Then open `.env` and set your `ORDERS_COOKIE` (see [How to get your cookie](#how-to-get-your-cookie) below).

You can also skip this step: `npm start`, `npm run orders`, and `npm run order-details`
check for a cookie first, and if `.env` doesn't have one they print the steps below,
prompt you to paste your `PHPSESSID`, verify it with a single request, and write it
to `.env` for you. `.env` is created from `.env.example` if it doesn't exist yet.

```
No session cookie found in .env.

  1. Log in at https://www.phoenixnext.com
  ...
Paste PHPSESSID: <paste>
  Checking… ok — 50 orders visible
  Saved to /path/to/.env
```

You can paste the bare value, `PHPSESSID=...`, or the entire `cookie:` header — it
pulls the session id out of any of them.

Notes:

- The check only runs when `.env` has **no** cookie. An **expired** cookie still looks
  present, so if scraping suddenly returns nothing, refresh it by hand — or blank the
  `ORDERS_COOKIE` line and re-run to get the prompt back.
- Setting `ORDERS_COOKIE` in your environment (`ORDERS_COOKIE=… npm run orders`, or
  `docker -e`) skips the check entirely and takes priority over `.env`.
- On a non-interactive terminal it prints the instructions and continues rather than
  failing, so `npm start` still serves already-scraped data with no cookie present.

### `.env` options

| Variable | Required | Default | Description |
|---|---|---|---|
| `ORDERS_COOKIE` | **Yes** | — | `PHPSESSID=...` session cookie (see below) |
| `ORDERS_URL` | No | `https://www.phoenixnext.com/sales/order/history/?limit=50` | Order history page URL |
| `ORDERS_OUTPUT_FILE` | No | `orders.json` | Path to save scraped orders |
| `ORDERS_DETAILS_FILE` | No | `orders-details.json` | Path to save order item details |
| `ORDERS_EXCEL_FILE` | No | `orders.xlsx` | Path to save the Excel export |
| `SERVER_PORT` | No | `3001` | Port for the web UI API server |

---

## How to get your cookie

Only one cookie matters: **`PHPSESSID`**. It is the single cookie the site checks on both the order history and order detail pages — everything else in your browser (Google Analytics, TikTok, Hotjar, Klaviyo, Mixpanel) is ignored by the server.

1. Open **Chrome** and log in to [phoenixnext.com](https://www.phoenixnext.com)
2. Open **DevTools** (`F12`) → **Application** tab
3. In the sidebar, expand **Storage** → **Cookies** → `https://www.phoenixnext.com`
4. Find the row named **`PHPSESSID`** and copy its **Value**
5. Paste it into `.env` like this:

```bash
ORDERS_COOKIE="PHPSESSID=paste_the_value_here"
```

> **Note:** `PHPSESSID` expires. If scraping stops working or returns no data, it is almost always this value that died — repeat these steps to get a fresh one.

> Pasting the full `cookie:` request header still works too, since the value is passed to the site untouched. It just sends a few kilobytes of analytics identifiers along with every request.

---

## CLI Commands

Run these in order the first time. Each command reads from `.env` automatically.

### Fetch all orders

Scrapes the paginated order history and saves it to `ORDERS_OUTPUT_FILE`.

```bash
npm run orders
```

**Later runs are incremental.** The order history is newest-first and only ever
grows, so the scrape stops as soon as it reaches an order it already has. On
~100 orders that is **one page fetched instead of four**:

```
Resuming from 103 order(s) on disk, 2 still in progress. Pass --force for a full re-scrape.
Fetching page 1…
Page 1: 50 orders (total: 50)
Page 1: already up to date from here down, stopping.
Wrote 103 orders to orders.json (0 new, 50 re-checked, 53 untouched)
```

Orders still in progress (`กำลังเตรียมสินค้า`) are always re-read wherever they
sit in the list, so a status that later becomes `จัดส่งแล้ว` is picked up rather
than frozen at whatever it was on the first scrape.

To ignore what is on disk and re-crawl every page:

```bash
npm run orders -- --force
```

Your existing file is never replaced by a smaller one: a scrape that returns no
orders, or a merge that would lose orders, is refused and leaves the file alone.

### Fetch order item details

Visits each order's detail page and saves product names, SKUs, quantities, and prices to `ORDERS_DETAILS_FILE`.

```bash
npm run order-details
```

> Requires `orders.json` to exist. Run `npm run orders` first.

Detail pages are fetched **4 at a time**, and orders that are already finished
(shipped or cancelled) are reused from the previous `ORDERS_DETAILS_FILE` instead
of being re-scraped. A first run of ~100 orders takes about a minute; a later run
usually only re-fetches the handful of orders still in progress, plus any new ones.

To ignore the cache and re-scrape every order:

```bash
npm run order-details -- --force
```

### Print total spend

Sums all `ราคาสุทธิ` values and prints the total to the terminal.

```bash
npm run sum
```

### Spend analysis

Breaks the scraped data down by period and by series. Offline and read-only —
it needs no cookie.

```bash
npm run stats
npm run stats -- --top 20 --months 24   # longer lists
npm run stats -- --all                  # no limits
```

The same figures are in the web UI under the **Stats** tab (`npm start`), where
each capped list has a **Show all** button.

It prints:

| Section | What it shows |
|---|---|
| **Overall** | Orders, spend, and cancelled money noted separately |
| **Spend by year** | One row per year, with a proportional bar |
| **Spend by month** | Recent months; quiet months appear as `฿0.00` rather than being skipped |
| **Top series by list price** | Which series cost the most, volumes collapsed together |
| **List price vs paid** | Discounts and delivery fees, derived (see below) |
| **Discount codes used** | Which codes you used, and on how many orders |

Two honest caveats the report repeats on screen:

- **Series figures are list prices.** A discount applies to the whole order, not
  to one item, so per-series totals add up to more than you actually paid.
- **The discount is derived, not scraped.** The site shows only item prices and
  an order total, so the discount is the gap between them. That gap runs both
  ways — on older, smaller orders it is a flat ฿35/฿50 delivery fee instead of a
  discount, so the two are reported as separate lines rather than netted off.
- **Codes are counted, not priced.** A scraped order carries the code and what
  was paid, never a discount amount, so the code list reports order counts only.
  A money column there would be the spend on those orders, which reads as the
  saving and is a much larger number.

Series and discount figures need `orders-details.json`; run
`npm run order-details` first, or the report says so and shows the rest.

### Sync from the browser

`npm start` puts a **Sync** button in the header, so a refresh does not need a
terminal. It runs the order list and then the order details — in that order,
since the second reads what the first writes — and streams their progress.

- **Full re-scrape** ticks `--force` onto both, ignoring the incremental stop
  and the details cache.
- **Cancel** is safe: both scrapers write their file once, at the very end, so
  stopping early leaves your existing data untouched.
- When your `PHPSESSID` expires, the button asks for a new one inline, checks it
  against the site, saves it to `.env`, and picks the sync up where it stopped —
  the same validate-and-save the terminal prompt does. The server only listens
  on `127.0.0.1`.
- Beside the button, `103 orders · 2h ago` says what is on disk and when it was
  last written.

### Export to Excel

Generates a styled `.xlsx` file with a frozen header row, auto-filter, and a total row.

```bash
npm run excel
```

### When the session expires

`PHPSESSID` expires regularly. When it does, the site silently redirects every
request to its login page, which used to show up as a successful run that found
`0 item(s)` on every order — and then wrote those empty results over your data.

Both scrapers now stop instead:

```
Error: Session expired — the site redirected to the login page.

  Your PHPSESSID is no longer valid. To refresh it:
    1. Open https://www.phoenixnext.com in your browser and sign in
    2. DevTools → Application → Cookies → https://www.phoenixnext.com
    3. Copy the PHPSESSID value
    4. Set ORDERS_COOKIE="PHPSESSID=<value>" in .env

  No files were written, so your existing data is untouched.
```

In an interactive terminal you are simply asked to paste a fresh `PHPSESSID` at
that point; it is checked against the site, saved to `.env`, and the command you
ran continues by itself. Piped or in CI, it stops with the message above instead.

This is detected by the redirect going to the login page, so it is caught wherever
it happens — including a cookie that dies halfway through a scrape, which would
otherwise have looked like the end of the order list and truncated the file.

Nothing is written on such a run, so `orders.json` and `orders-details.json` keep
whatever they held. As a backstop for failures a redirect check cannot see, neither
file is ever replaced by an empty result: a scrape finding 0 orders, or a detail run
where no order produced items, stops with an error instead of overwriting. Refresh the cookie and re-run; `npm run order-details` will
reuse its cache and only re-fetch what it must.

### How totals are counted

Cancelled orders (`ออร์เดอร์ยกเลิก`) are **not** counted as money spent. Every
view uses the same rule and shows the cancelled money separately, so the figures
always agree:

| Where | Shows |
|---|---|
| `npm run sum` | `Spent`, then `Cancelled` and `Gross` when any exist |
| `orders.xlsx` | three labelled rows; cancelled order rows struck through |
| Web UI header | `Total: ฿…` with a muted `+฿… cancelled` note |

`Gross` is spent + cancelled, if you want the older combined figure.

### Find orders

Searches the already-scraped `ORDERS_DETAILS_FILE` — no network requests — and prints
each matching order with the items that matched and their combined total.

```bash
npm run find "Complete Set"        # default: searches item names
npm run find sku BX0948-01
npm run find code LV999MAY
npm run find order 000434985
```

Matching is case-insensitive substring. The key is optional and defaults to `name`,
so `npm run find Alpha` searches item names.

| Key | Searches | Aliases |
|---|---|---|
| `name` *(default)* | item names | `product` |
| `sku` | item SKUs | — |
| `items` | item names **and** SKUs | `item` |
| `หมายเลขคำสั่งซื้อ` | order number | `order`, `order-number`, `no` |
| `โค้ดส่วนลด` | discount code | `code`, `discount` |
| `orderId` | numeric order id from the detail URL | `id` |

Matched text is highlighted in the output. Colour follows the usual conventions:
it is off when the output is piped or when `NO_COLOR` is set, and can be forced
through a pipe with `FORCE_COLOR=1`.

> Requires `orders-details.json`. Run `npm run order-details` first.

---

## Web UI

The web UI lets you browse, search, sort, and paginate your orders in a browser. It also provides a one-click Excel download.

### Start the UI

```bash
npm start
```

This starts two servers in parallel:

| Server | URL | Purpose |
|---|---|---|
| API (Express) | `http://localhost:3001` | Serves JSON data and Excel download |
| UI (Vite) | `http://localhost:5173` | React frontend |

Open **http://localhost:5173** in your browser.

### UI features

- **Orders tab** — searchable, sortable table of all orders
- **Order Details tab** — searchable cards showing items per order; search works inside product names and SKUs
- **Filters** on the Order Details tab — three dropdowns built from the product names (see below)
- **Exclude cancelled** checkbox on both tabs — hides cancelled orders (`ออร์เดอร์ยกเลิก`) from the list
- **Total** displayed in the header
- **Download Excel** button in the header

### Filtering by series, type and set

Product names on the site are decorated with tags, so filtering on the raw text
would give you one option per volume:

```
(PRE/MAY)(LN) Complete Set ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน ปี 2 เล่ม 12.5
```

The Order Details tab strips that decoration and turns it into three dropdowns,
each showing how many items it covers:

| Filter | Options |
|---|---|
| **Series** | The title on its own, with every volume collapsed into one entry |
| **Type** | Light Novel `(LN)`, Manga `(MG)`, Art Book `(AB)`, Free gift / goods, Untagged |
| **Set** | Complete Set, Special Set, Short Story Set, Collection Box Set, Ultimate Set, No set |

The three combine with AND. An order stays on screen if **any** of its items
matches, and the card is narrowed to show only the matching items — so you can
see at a glance why it is listed.

Alongside them is an **Exclude cancelled** checkbox, which drops cancelled
orders from the list — the same rule the header total and `npm run sum` already
apply to your spend. It shows how many orders it would hide, and only appears
when there is at least one cancelled order. It is also on the Orders tab.

**Clear filters** resets all four, and appears only while something is set.

A series is often spelled inconsistently between orders (`★` vs `☆`, `ปีสอง` vs
`ปี 2`, a stray space); those are folded together into a single option, labelled
with whichever spelling the site used most. Promotional giveaways (`Free Gift -
…` and `ครบ N บาท - …`) are grouped under one **Free gift / goods** entry rather
than appearing as dozens of one-off options.

> The UI reads from the JSON files on disk. Run the CLI commands first to populate data before starting the UI.

### API-only mode (no UI)

```bash
npm run server
```

Starts only the Express API on `http://localhost:3001`.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/orders` | Returns contents of `ORDERS_OUTPUT_FILE` |
| `GET` | `/api/order-details` | Returns contents of `ORDERS_DETAILS_FILE` |
| `GET` | `/api/excel/download` | Streams a generated `.xlsx` file |

---

## Typical workflow

```
1. npm run orders          # scrape order list
2. npm run order-details   # scrape item details for each order
3. npm run stats           # (optional) spend by year, month and series
4. npm run excel           # (optional) export to .xlsx
   — or —
   npm start               # browse in the web UI
```

---

## File structure

```
.
├── src/
│   ├── index.js              # CLI dispatcher
│   ├── orders-config.js      # Reads config from environment
│   ├── fetch-orders.js       # Scrapes order history pages
│   ├── fetch-order-details.js # Scrapes item details per order
│   ├── sum-orders.js         # Sums total spend
│   ├── find-orders.js        # Searches scraped orders/items
│   └── export-excel.js       # Generates Excel file
├── client/
│   └── src/
│       ├── App.jsx            # Main React app (tabs, header)
│       ├── components/
│       │   ├── OrdersTable.jsx
│       │   ├── OrderDetailsTable.jsx
│       │   └── DataTableControls.jsx
│       └── hooks/
│           └── useDataTable.js  # Search, sort, pagination logic
├── server.js                 # Express API server
├── .env.example              # Config template — copy to .env
└── package.json
```

---

## Notes

- `.env`, `orders.json`, `orders-details.json`, and `*.xlsx` are all **gitignored** — your cookie and personal data will not be committed.
- The API server only accepts connections from `127.0.0.1` (localhost). It is not accessible from other devices on your network.
