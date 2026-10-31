# MCP server — ask Claude Desktop about your orders

**Status:** approved
**Date:** 2026-10-31

## Intent

Ask Claude Desktop about the Phoenix Next order history in plain words and get
answers from the same data and the same rules as `npm run sum`, `stats`,
`collection` and the web UI. The questions that drove this, in the user's words:

- "Did I buy *xxx* volume 2 yet?"
- "List all *yyyy*, every volume."
- "Summary of spend by year, quarter, month."
- "How many books did I buy?"
- "Make me a graph of the books I bought this year."
- Search by book name, and by the IDs in the data.

Claude Desktop draws the graph itself from the numbers a tool returns; the
server returns data, never images.

## Decided with the user

- **Transport is stdio, client is Claude Desktop.** Both run on this machine, so
  the cookie never leaves it. claude.ai (web/phone) cannot reach a stdio server
  and is out of scope.
- **Same repo, no `phoenix-history-mcp`.** Every answer above already has a
  tested module here (`find-orders.js`, `collection-report.js`,
  `stats-report.js`, `orders-total.js`, `sync-job.js`). A separate repo would
  copy or depend on them and drift from the CLI and the UI.
- **Same cookie as today:** `ORDERS_COOKIE` in `.env`, only needed by `refresh`.
- **No tool that takes a cookie from the chat, and no new CLI command for it.**
  Pasting PHPSESSID into the chat would put a live credential in the
  transcript. Renewal already works: `npm run orders` in a terminal re-prompts
  on an expired cookie, validates it, saves it to `.env` and retries
  (`src/index.js` → `promptForCookie`).
- **Four tools:** `search`, `collection`, `spend`, `refresh`.

## Goals, non-goals, anti-goals

**Goals:** the four tools below, answering the questions above, launched by
Claude Desktop with no manual step beyond adding it to its config once.

**Non-goals:** claude.ai web/mobile; rendering chart images (no Mermaid);
series spend, discount-code and price-gap reports (`npm run stats` has them,
add a tool if they get asked for); a last-synced timestamp (still the open item
in the project's backlog); `--force` re-crawl from chat.

**Anti-goals — it fails even if it "works" when:**

- a number disagrees with `npm run sum` / the UI header for the same files;
- anything in the server process writes to stdout (that is the protocol wire;
  one stray `console.log` corrupts the session);
- the cookie appears in a tool argument, a tool result, or a log line;
- a refresh can overwrite or truncate the JSON in a way `npm run orders` can't.

## Constraints that shape the build

1. **stdout is the wire.** The server never prints to stdout; diagnostics go to
   stderr. The scrapers print progress with `console.log`, so they must run in a
   child process with piped stdout — which `src/sync-job.js` already does.
2. **Never import the fetchers or `orders-config.js`.** It calls
   `process.exit(1)` at import time without a cookie; that would kill the server
   for the three tools that need no cookie. Same rule as `server.js`.
3. **The server process must not hold `ORDERS_COOKIE`.** Node's `--env-file`
   does not override an inherited variable (verified:
   `X=inherited node --env-file=t.env` prints `inherited`). `sync-job.js`
   spawns `node --env-file=.env …` with the parent's env, so if the server has
   the cookie, every refresh reuses it and a renewed `.env` is ignored. So:
   launch **without** `--env-file`, and the README must say not to put the
   cookie in Claude Desktop's config `env`.
4. **cwd is not the repo.** Claude Desktop launches the server from its own
   directory, and the existing readers resolve file paths against cwd. The
   server must resolve the data files against the repo root (`sync-job.js`
   already passes `cwd = ROOT` to the child).
5. **File paths:** with no `--env-file`, `ORDERS_OUTPUT_FILE` /
   `ORDERS_DETAILS_FILE` from `.env` are not seen. Use the defaults
   (`orders.json`, `orders-details.json`, which match `.env.example`), still
   honouring those variables if set in the process env. *My call* — the user
   has never changed them.
6. **Platform.** The repo is `C:\NodeJS\phoenix-history` (worked on from WSL at
   `/mnt/c/...`). Windows Node v22.19.0 is installed at
   `C:\Program Files\nodejs\node.exe`, so Claude Desktop runs
   `node C:\NodeJS\phoenix-history\src\mcp-server.js` directly. `node_modules`
   was installed from WSL; the runtime deps the server touches are pure JS, but
   the builder must confirm the server starts under Windows Node, not only WSL.
7. **Money rules come from `orders-total.js`.** Cancelled orders are not money
   spent and not books owned.

## The tools

All results are JSON text. The three reading tools read the files on each call
(they are ~190 KB together) and are marked read-only.

### `search(query, field = "name")`

Wraps `findOrders()` from `find-orders.js`, so it matches exactly like
`npm run find`: case-insensitive substring.

- `field`: `name`, `sku`, `order` (order number, e.g. `000434985`), `id`
  (orderId from the detail URL, e.g. `457973`), `code` (discount code). Mapped
  through the existing `resolveField`.
- Each hit: order number, date, status, net price, `cancelled: true|false`, and
  items (`name`, `sku`, `price`, `quantity`). Name/SKU searches return only the
  matching items; order/id/code searches return the whole order — the rule
  `find-orders.js` already applies.
- Cancelled orders are returned and flagged, not hidden: "did I order this?"
  deserves the honest answer.
- *My calls:* an empty query is an error (it would return everything); results
  cap at 50 orders with the remaining count stated.

### `collection(series?)`

Wraps `collectSeries()` / `collectionSummary()` from `collection-report.js`.

- No `series`: every series with `label`, `count`, `first`, `last`, `missing`,
  `startsAbove`, plus the summary. This is how Claude finds the site's spelling
  of a title the user typed loosely.
- With `series`: the series whose `seriesKey` or label contains the query
  (folded with `seriesKey` so `ปีสอง`/`ปี 2`, `★`/`☆` match), each with every
  owned volume listed.
- Every result carries the caveat both existing renderers state: a gap may be a
  volume bought elsewhere, and items without `เล่ม N` (box sets, one-shots) are
  not in this view — the tool description tells Claude to use `search` for
  those.

### `spend(by, year?)`

- `by`: `year` | `quarter` | `month`. Quarters are calendar quarters
  (Q1 = Jan–Mar), keyed `2026-Q3`. *My call.*
- Money and order count per period from `orders.json` via `groupSpend()` —
  the same file and function `npm run stats` uses — plus the
  `summarise()` totals (spent, cancelled count and amount).
- **Books per period** from `orders-details.json`: sum of `quantity` over items
  of non-cancelled orders, skipping `isFreebie`. A Complete Set counts as **1**
  — in this data it is one volume plus extras, not a bundle of volumes.
  *My call, with a known ceiling:* the one non-book purchase in the data
  (`Class C - Acrylic Standee …`) counts as a book. Today's data gives 216.
- "A graph of the books I bought this year" is answered by
  `spend(by: "month", year)` book counts. *My call:* no date filter on
  `search` for listing which titles; cheap to add if asked.
  This counting is a new pure function in `stats-report.js` (Node-free like the
  rest of that module), not inline in the server.
- Empty periods are zero rows at every granularity — a quiet quarter is a fact
  the chart must show (`fillMonths` already does this for months). With `year`,
  months run January to December, or to the current month for the current year.

### `refresh()`

- Runs `orders`, then `order-details` only if the first finished `done`, using
  `createSyncJob()` from `sync-job.js` and awaiting `finished()`. Every guard in
  the scrapers (empty-overwrite refusal, merge shrink check, details cache) comes
  along unchanged.
- Returns the status of each step, order/detail counts before and after, and on
  failure the last ~20 output lines.
- On `expired` (exit 2): "Your PHPSESSID has expired. Run `npm run orders` in a
  terminal in `C:\NodeJS\phoenix-history` — it asks for a new one and saves it —
  then ask me to refresh again."
- No `force` argument (non-goal).
- *My call:* a `refresh` call while a run is already in progress waits for that
  run and reports it, rather than failing on the job lock.

## Wiring

- `src/mcp-server.js` — the server. Thin: argument handling and result shaping;
  logic stays in the existing modules.
- `npm run mcp` → `node src/mcp-server.js` (no `--env-file`, per constraint 3).
- Dependency: `@modelcontextprotocol/sdk` (plus whatever schema library its
  current API requires).
- README: the `claude_desktop_config.json` snippet, and the warning not to put
  `ORDERS_COOKIE` in its `env`.
- CLAUDE.md: a short section on the four constraints above.

## Testing

- Unit tests for the new pure pieces: quarter keys, book counting, zero-filled
  periods, series matching, search result shaping and the 50 cap.
- **One end-to-end stdio test:** spawn the real server with the SDK's stdio
  client against `tests/fixtures/` files, list tools, call `search`, `spend`
  and `collection`. This is the only thing that catches a stray stdout write,
  which no unit test sees — the same failure shape as the past `npm run excel`
  break that unit tests missed.
- `refresh` with an injected `spawnFn`, as `sync-job.test.js` does: done,
  failed, expired, and "first step failed so the second never ran".

## Left to the builder

SDK version and API style; exact tool descriptions; result field names; where
the series-matching and result-shaping helpers live.

## Risks

- **Client timeouts.** A typical refresh is ~10 s (1 order page, details mostly
  cached), but a cold full scrape is 60–90 s, which can exceed a client's
  per-call timeout. Send progress notifications when the client provides a
  progress token; if Claude Desktop still times out, the scrape keeps running
  in the child, and a `refresh` made while it runs waits for it and reports it.
  One that finished after the client gave up goes unreported; the next refresh
  just finds nothing new.
- **Two refreshes at once.** The web UI's Sync button and the MCP server each
  have their own job lock, so both could scrape at once. Rare for one person;
  not guarded.
