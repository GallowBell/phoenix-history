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

### `.env` options

| Variable | Required | Default | Description |
|---|---|---|---|
| `ORDERS_COOKIE` | **Yes** | — | Session cookie from your browser |
| `ORDERS_URL` | No | `https://www.phoenixnext.com/sales/order/history/?limit=50` | Order history page URL |
| `ORDERS_OUTPUT_FILE` | No | `orders.json` | Path to save scraped orders |
| `ORDERS_DETAILS_FILE` | No | `orders-details.json` | Path to save order item details |
| `ORDERS_EXCEL_FILE` | No | `orders.xlsx` | Path to save the Excel export |
| `SERVER_PORT` | No | `3001` | Port for the web UI API server |

---

## How to get your cookie

1. Open **Chrome** and log in to [phoenixnext.com](https://www.phoenixnext.com)
2. Go to your [order history page](https://www.phoenixnext.com/sales/order/history/)
3. Open **DevTools** → **Network** tab (`F12`)
4. Reload the page and click the first request in the list
5. In the **Headers** panel, find the `cookie:` request header
6. Copy the entire value and paste it into `.env` as `ORDERS_COOKIE="..."`

> **Note:** Cookies expire. If scraping stops working or returns no data, repeat these steps to get a fresh cookie.

---

## CLI Commands

Run these in order the first time. Each command reads from `.env` automatically.

### Fetch all orders

Scrapes all paginated order history pages and saves them to `ORDERS_OUTPUT_FILE`.

```bash
npm run orders
```

### Fetch order item details

Visits each order's detail page and saves product names, SKUs, quantities, and prices to `ORDERS_DETAILS_FILE`.

```bash
npm run order-details
```

> Requires `orders.json` to exist. Run `npm run orders` first.

### Print total spend

Sums all `ราคาสุทธิ` values and prints the total to the terminal.

```bash
npm run sum
```

### Export to Excel

Generates a styled `.xlsx` file with a frozen header row, auto-filter, and a total row.

```bash
npm run excel
```

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
- **Total** displayed in the header
- **Download Excel** button in the header

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
3. npm run excel           # (optional) export to .xlsx
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
