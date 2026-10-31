# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server Claude Desktop launches, with four tools — `search`, `collection`, `spend`, `refresh` — answering from the same data and rules as the CLI and web UI.

**Architecture:** Pure tool logic in a new `src/mcp-tools.js` (data in, JSON-able object out) built on the existing modules; a thin `src/mcp-server.js` that reads the files, registers the tools with the SDK and connects stdio. `refresh` drives the existing `createSyncJob` child process, so the scrapers never run in the server process.

**Tech Stack:** Node (ESM), `@modelcontextprotocol/sdk` ^1.32.2 (`McpServer.registerTool`, `StdioServerTransport`), `zod` ^4, vitest.

**Spec:** `docs/specs/2026-10-31-mcp-server-design.md`

## Global Constraints

- Nothing in the server process writes to stdout. No `console.log` in `mcp-server.js` or `mcp-tools.js`; diagnostics go to `console.error`.
- `mcp-server.js` and `mcp-tools.js` never import `orders-config.js`, `fetch-orders.js` or `fetch-order-details.js`.
- The server is launched **without** `--env-file`, never reads `ORDERS_COOKIE`, and no tool takes or returns a cookie.
- Data paths resolve against the repo root, not cwd: `ORDERS_OUTPUT_FILE` ?? `orders.json`, `ORDERS_DETAILS_FILE` ?? `orders-details.json`.
- Money comes from `orders-total.js`; cancelled orders are not spent and not books. Every baht figure in a result is rounded to 2 dp.
- Tool names are exactly `search`, `collection`, `spend`, `refresh`.
- `src/stats-report.js` stays free of Node imports (`StatsPanel.test.jsx` asserts it).
- Leave the `exceljs` `uuid` override alone; never `npm audit fix --force`.
- Must start under Windows Node v22.19.0 (`/mnt/c/Program Files/nodejs/node.exe`), not only WSL Node.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Launched from a cwd that is not the repo** (Claude Desktop does this) → data files are still found. Test: Task 5, e2e spawns with `cwd: os.tmpdir()`.
2. **Data files missing** (never synced) → the call returns `isError` naming the fix, and the server answers the next call. Test: Task 5.
3. **A loosely typed series name** (`ปีสอง` for `ปี 2`, `☆` for `★`, case, spaces) → still matches. Test: Task 2.
4. **A year with no orders, or the current partial year** → zero rows Jan–Dec / Jan–current month, never an empty list. Test: Task 3.
5. **Float drift in sums** → `spent` matches `npm run sum` to the satang. Test: Task 3.

---

### Task 1: Period keys and book counts in `stats-report.js`

**Files:**
- Modify: `src/stats-report.js` (append after `fillMonths`)
- Create: `src/stats-report.test.js`

**Interfaces:**
- Consumes: `parseOrderDate`, `monthKey`, `DATE_KEY` (same file); `isCancelled` (`orders-total.js`); `parseProductName` (`product-name.js`).
- Produces:
  - `yearKey(date) -> string|null` → `'2026'`
  - `quarterKey(date) -> string|null` → `'2026-Q3'` (calendar quarters)
  - `PERIOD_KEYS = { year: yearKey, quarter: quarterKey, month: monthKey }`
  - `periodKeys(by: 'year'|'quarter'|'month', from: string, to: string) -> string[]` — every key from `from` to `to` inclusive; `[]` when `from > to`.
  - `groupBooks(details, keyOf) -> Array<{key: string, books: number}>` sorted by key — sums `Number(item.quantity) || 0` over items of non-cancelled orders, skipping `isFreebie` items and orders whose date does not parse.

- [ ] **Step 1: Write the failing tests** in `src/stats-report.test.js`:

```js
it('maps months onto calendar quarters', () => {
  expect(quarterKey({ year: 2026, month: 1 })).toBe('2026-Q1');
  expect(quarterKey({ year: 2026, month: 3 })).toBe('2026-Q1');
  expect(quarterKey({ year: 2026, month: 4 })).toBe('2026-Q2');
  expect(quarterKey({ year: 2026, month: 12 })).toBe('2026-Q4');
  expect(quarterKey(null)).toBe(null);
  expect(yearKey({ year: 2026, month: 5 })).toBe('2026');
});

it('lists every period between two keys, across year ends', () => {
  expect(periodKeys('month', '2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  expect(periodKeys('quarter', '2025-Q4', '2026-Q2')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
  expect(periodKeys('year', '2019', '2021')).toEqual(['2019', '2020', '2021']);
  expect(periodKeys('month', '2026-03', '2026-01')).toEqual([]);
});

it('counts books by quantity, leaving out cancelled orders and free gifts', () => {
  const details = [
    { 'วันที่ซื้อ': '1/3/26 …', 'สถานะ': 'จัดส่งแล้ว', items: [
      { name: '(LN) Some Series เล่ม 1', quantity: '1' },
      { name: '(LN) Other Series เล่ม 4', quantity: '2' },
      { name: 'Free Gift - Bookmark', quantity: '1' },
    ] },
    { 'วันที่ซื้อ': '5/3/26 …', 'สถานะ': 'ออร์เดอร์ยกเลิก', items: [{ name: '(LN) X เล่ม 1', quantity: '1' }] },
    { 'วันที่ซื้อ': 'not a date', 'สถานะ': 'จัดส่งแล้ว', items: [{ name: '(LN) Y เล่ม 1', quantity: '1' }] },
  ];
  expect(groupBooks(details, monthKey)).toEqual([{ key: '2026-03', books: 3 }]);
});
```

- [ ] **Step 2: Run** `npx vitest run src/stats-report.test.js` — expect FAIL (`quarterKey is not a function` / not exported).
- [ ] **Step 3: Implement** `yearKey`, `quarterKey`, `PERIOD_KEYS`, `periodKeys`, `groupBooks` in `src/stats-report.js`. `periodKeys` steps a `{year, month}` cursor by 1 month, 3 months or 12 months and formats with the matching key function. No new imports: `isCancelled` and `parseProductName` are already imported.
- [ ] **Step 4: Run** `npx vitest run src/stats-report.test.js src/stats-orders.test.js client/src/components/StatsPanel.test.jsx` — expect PASS (the last one proves the module is still Node-free).
- [ ] **Step 5: Commit** — `feat: add quarter keys, period ranges and book counts to stats-report`

---

### Task 2: `search` and `collection` tool logic

**Files:**
- Create: `src/mcp-tools.js`, `src/mcp-tools.test.js`

**Interfaces:**
- Consumes: `findOrders`, `resolveField` (`find-orders.js`); `collectSeries`, `collectionSummary` (`collection-report.js`); `seriesKey` (`product-name.js`); `parseOrderDate`, `DATE_KEY` (`stats-report.js`); `isCancelled`, `PRICE_KEY`, `STATUS_KEY` (`orders-total.js`).
- Produces:
  - `SEARCH_FIELDS = ['name', 'sku', 'order', 'id', 'code']`
  - `searchOrders(details, { query, field = 'name', limit = 50 }) -> { total: number, shown: number, orders: Hit[] }`
    where `Hit = { orderNumber, orderId, date, status, netPrice, cancelled: boolean, items: Array<{name, sku, price, quantity}> }`. `date` is ISO `YYYY-MM-DD` from `parseOrderDate`, else the raw string. `netPrice` is the raw `ราคาสุทธิ` string. Query is trimmed; empty → `throw new Error('query must not be empty')`. Field goes through `resolveField`.
  - `COLLECTION_CAVEAT` (exact copy): `Only orders from phoenixnext.com are counted, so a missing volume may have been bought elsewhere. Items without a เล่ม number (box sets, one-shots) are not listed here; use search to find them.`
  - `collectionReport(details, { series } = {})`:
    - no/blank `series` → `{ summary: collectionSummary(details), series: [{label, count, first, last, missing, startsAbove}], caveat }`
    - with `series` → `{ series: [{label, volumes, count, first, last, missing, startsAbove}], caveat }` for every entry whose `key` includes `seriesKey(series)`; when none match, add `hint: 'No series matched "<series>". Call collection with no series to list every title.'`

- [ ] **Step 1: Write the failing tests** (build a small `details` array inline: one delivered order with `(LN) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน ปี 2 เล่ม 1` and `… เล่ม 3`, SKU `BX0948-01`, order number `000434985`, orderId `457973`; one cancelled order with `(LN) แมจิคัล★เอกซ์พลอเรอร์ เล่ม 2`):

```js
it('returns only the matching items for a name search', () => {
  const r = searchOrders(details, { query: 'เล่ม 3' });
  expect(r.total).toBe(1);
  expect(r.orders[0].items.map((i) => i.name)).toEqual([expect.stringContaining('เล่ม 3')]);
  expect(r.orders[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
it('returns the whole order for an order-number or id search', () => {
  expect(searchOrders(details, { query: '000434985', field: 'order' }).orders[0].items).toHaveLength(2);
  expect(searchOrders(details, { query: '457973', field: 'id' }).total).toBe(1);
});
it('flags cancelled orders instead of hiding them', () => {
  expect(searchOrders(details, { query: 'แมจิคัล' }).orders[0].cancelled).toBe(true);
});
it('refuses an empty query', () => {
  expect(() => searchOrders(details, { query: '  ' })).toThrow('query must not be empty');
});
it('caps results and says how many there were', () => {
  const r = searchOrders(details, { query: '(LN)', limit: 1 });
  expect(r).toMatchObject({ total: 2, shown: 1 });
  expect(r.orders).toHaveLength(1);
});
it('matches a series typed loosely', () => {
  for (const q of ['ปีสอง', 'ยอดคน ปี 2', 'ยอดคนปี2']) {
    expect(collectionReport(details, { series: q }).series[0]).toMatchObject({ volumes: [1, 3], missing: [2] });
  }
});
it('ignores cancelled orders in the collection', () => {
  expect(collectionReport(details, { series: 'แมจิคัล☆' }).series).toEqual([]);
});
it('lists every series with a summary when no series is given', () => {
  const r = collectionReport(details);
  expect(r.summary.series).toBe(1);
  expect(r.caveat).toBe(COLLECTION_CAVEAT);
});
it('hints when nothing matched', () => {
  expect(collectionReport(details, { series: 'nope' }).hint).toContain('Call collection with no series');
});
```

- [ ] **Step 2: Run** `npx vitest run src/mcp-tools.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `SEARCH_FIELDS`, `searchOrders`, `COLLECTION_CAVEAT`, `collectionReport` in `src/mcp-tools.js`.
- [ ] **Step 4: Run** `npx vitest run src/mcp-tools.test.js` — expect PASS.
- [ ] **Step 5: Commit** — `feat: add search and collection logic for the MCP server`

---

### Task 3: `spend` tool logic

**Files:**
- Modify: `src/mcp-tools.js`, `src/mcp-tools.test.js`

**Interfaces:**
- Consumes: Task 1's `PERIOD_KEYS`, `periodKeys`, `groupBooks`; `groupSpend`, `parseOrderDate`, `DATE_KEY` (`stats-report.js`); `summarise` (`orders-total.js`).
- Produces: `spendReport(orders, details, { by, year, now = new Date() }) -> { by, year: number|null, periods: Array<{period, spent, orders, books}>, totals: { spent, orders, books, cancelledOrders, cancelledAmount } }`
  - With `year`: both inputs are first filtered to orders whose `parseOrderDate(...).year === year`; periods run from the first key of that year to its last (`'2026'`, `'2026-Q4'`, `'2026-12'`), or to the key of `now` when `year === now.getFullYear()`.
  - Without `year`: periods run from the smallest to the largest key in the data; no data → `periods: []`.
  - Every period in range appears; missing ones are `{ spent: 0, orders: 0, books: 0 }`.
  - `totals.spent`, `cancelledOrders`, `cancelledAmount` come from `summarise(filteredOrders)`; `totals.orders`/`books` are the period sums. Every baht value is `Math.round(x * 100) / 100`.

- [ ] **Step 1: Write the failing tests** (inline `orders` and matching `details`: delivered `฿1,000.10` on `2/3/26`, delivered `฿500.20` on `9/8/26`, cancelled `฿300.00` on `10/8/26`):

```js
const now = new Date(2026, 9, 31); // Oct 2026

it('fills every month of the current year up to now', () => {
  const r = spendReport(orders, details, { by: 'month', year: 2026, now });
  expect(r.periods.map((p) => p.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  expect(r.periods[0]).toEqual({ period: '2026-01', spent: 0, orders: 0, books: 0 });
  expect(r.periods[2]).toMatchObject({ spent: 1000.1, orders: 1 });
});
it('returns twelve zero months for a year with no orders', () => {
  const r = spendReport(orders, details, { by: 'month', year: 2018, now });
  expect(r.periods).toHaveLength(12);
  expect(r.totals).toMatchObject({ spent: 0, orders: 0, books: 0 });
});
it('keeps quiet quarters as zero rows', () => {
  const r = spendReport(orders, details, { by: 'quarter', now });
  expect(r.periods.map((p) => [p.period, p.orders])).toEqual([['2026-Q1', 1], ['2026-Q2', 0], ['2026-Q3', 1]]);
});
it('reports cancelled money beside spent, never inside it', () => {
  expect(spendReport(orders, details, { by: 'year', now }).totals)
    .toMatchObject({ spent: 1500.3, cancelledOrders: 1, cancelledAmount: 300 });
});
it('has no float drift', () => {
  expect(spendReport(orders, details, { by: 'year', now }).periods[0].spent).toBe(1500.3);
});
```

- [ ] **Step 2: Run** `npx vitest run src/mcp-tools.test.js` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** `spendReport` in `src/mcp-tools.js`.
- [ ] **Step 4: Run** `npx vitest run src/mcp-tools.test.js` — expect PASS.
- [ ] **Step 5: Check against the real data:** `node --input-type=module -e "import o from './orders.json' with {type:'json'}; import d from './orders-details.json' with {type:'json'}; import {spendReport} from './src/mcp-tools.js'; const r=spendReport(o,d,{by:'year'}); console.log(r.totals)"` — expect `spent: 157191` and `books: 216`.
- [ ] **Step 6: Commit** — `feat: add spend by year, quarter and month for the MCP server`

---

### Task 4: `refresh` tool logic

**Files:**
- Modify: `src/mcp-tools.js`, `src/mcp-tools.test.js`

**Interfaces:**
- Consumes: a job shaped like `createSyncJob()` (`start(command)`, `finished()`, `subscribe(listener)`), injected; not imported.
- Produces: `createRefresh({ job, counts, root, steps = ['orders', 'order-details'] }) -> (opts?: { onLine?: (text: string) => void }) => Promise<RefreshResult>`
  - `counts: () => Promise<{ orders: number|null, details: number|null }>`
  - `RefreshResult = { status: 'done'|'expired'|'failed', steps: Array<{command, status}>, before, after, message?: string, output?: string[] }`
  - Runs `steps` in order, stopping at the first whose final status is not `'done'`. `output` is the last 20 lines of that step, present only on failure.
  - While a run is in flight, every call returns **the same promise** (`inFlight ??= run().finally(() => { inFlight = null; })`).
  - `onLine` gets each `type: 'line'` event's `text`; unsubscribe when the run ends.
  - Expired `message` (exact copy): `` `Your PHPSESSID has expired. Run \`npm run orders\` in a terminal in ${root} — it asks for a new one and saves it — then ask me to refresh again.` ``

- [ ] **Step 1: Write the failing tests** using the real `createSyncJob` against `tests/fixtures/fake-scrape.mjs`, the same way `src/sync-job.test.js` builds `makeJob` (`envFile: null`, `commands: new Set(['ok', 'expired', 'fail'])`), with `counts = vi.fn(async () => ({ orders: 3, details: 3 }))` and `root: '/repo'`:

```js
it('runs both steps and reports counts', async () => {
  const r = await createRefresh({ job: makeJob(), counts, root, steps: ['ok', 'ok'] })();
  expect(r).toMatchObject({ status: 'done', steps: [{ command: 'ok', status: 'done' }, { command: 'ok', status: 'done' }], before: { orders: 3 }, after: { orders: 3 } });
  expect(r.output).toBeUndefined();
});
it('does not run the second step when the first fails', async () => {
  const r = await createRefresh({ job: makeJob(), counts, root, steps: ['fail', 'ok'] })();
  expect(r.status).toBe('failed');
  expect(r.steps).toHaveLength(1);
  expect(r.output).toContain('Error: something else broke');
});
it('tells the user how to renew an expired cookie', async () => {
  const r = await createRefresh({ job: makeJob(), counts, root, steps: ['ok', 'expired'] })();
  expect(r.status).toBe('expired');
  expect(r.message).toContain('Run `npm run orders` in a terminal in /repo');
});
it('joins a run already in flight instead of starting another', async () => {
  const refresh = createRefresh({ job: makeJob(), counts, root, steps: ['ok'] });
  const a = refresh();
  expect(refresh()).toBe(a);
  await a;
  const c = refresh();
  expect(c).not.toBe(a);
  await c;
});
it('streams progress lines', async () => {
  const lines = [];
  await createRefresh({ job: makeJob(), counts, root, steps: ['ok'] })({ onLine: (t) => lines.push(t) });
  expect(lines).toContain('Fetching page 1…');
});
```

- [ ] **Step 2: Run** `npx vitest run src/mcp-tools.test.js` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** `createRefresh` in `src/mcp-tools.js`.
- [ ] **Step 4: Run** `npx vitest run src/mcp-tools.test.js src/sync-job.test.js` — expect PASS.
- [ ] **Step 5: Commit** — `feat: add refresh logic for the MCP server on top of sync-job`

---

### Task 5: The stdio server, wiring and docs

**Files:**
- Modify: `package.json` (dependencies, `"mcp": "node src/mcp-server.js"`), `src/stats-orders.js` (`export` its existing `readJson`), `README.md` (new `## Claude Desktop (MCP)` section after `## Web UI`), `CLAUDE.md` (new **MCP server** paragraph under Architecture)
- Create: `src/mcp-server.js`, `src/mcp-server.test.js`

**Interfaces:**
- Consumes: everything Tasks 2–4 produce; `createSyncJob` (`sync-job.js`); `readJson` (`stats-orders.js`, returns `null` when missing).
- Produces: a process that speaks MCP on stdio. No exports.

`src/mcp-server.js` decisions:
- `ROOT = fileURLToPath(new URL('..', import.meta.url))`; `dataPath(key, fallback) = resolve(ROOT, process.env[key] ?? fallback)`.
- Each reading tool loads its file(s) per call; `null` → `throw new Error(\`${file} not found. Ask me to refresh, or run npm run orders && npm run order-details in ${ROOT}\`)` (the SDK returns a thrown error as an `isError` result).
- Results are `{ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }`.
- Input schemas (zod): `search { query: z.string(), field: z.enum(SEARCH_FIELDS).default('name') }`, `collection { series: z.string().optional() }`, `spend { by: z.enum(['year','quarter','month']), year: z.number().int().optional() }`, `refresh {}`.
- Annotations: `readOnlyHint: true` on the three readers; `refresh` gets `openWorldHint: true`.
- Descriptions must tell Claude: amounts are baht; books exclude free gifts and cancelled orders and a Complete Set counts as one; use `spend` by month for charts; use `search` for items `collection` cannot see; `refresh` scrapes phoenixnext.com and may take a minute.
- `refresh` uses `createRefresh({ job: createSyncJob(), counts, root: ROOT })`; when `extra._meta?.progressToken` is set, `onLine` sends `notifications/progress` with an incrementing `progress` and the line as `message`.

- [ ] **Step 1: Install** `npm install @modelcontextprotocol/sdk@^1.32.2 zod@^4` — then `git diff package.json` shows only the two new dependencies (override untouched).
- [ ] **Step 2: Write the failing e2e test** `src/mcp-server.test.js`: write small `orders`/`details` fixtures (orders in 2025) to a `mkdtemp` dir; spawn with `StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: os.tmpdir(), env: { ...getDefaultEnvironment(), ORDERS_OUTPUT_FILE, ORDERS_DETAILS_FILE }, stderr: 'pipe' })`; set `client.onerror = (e) => errors.push(e)` before connecting.

```js
it('lists exactly the four tools', async () => {
  expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['collection', 'refresh', 'search', 'spend']);
});
it('answers from the data files even when launched outside the repo', async () => {
  const r = await client.callTool({ name: 'spend', arguments: { by: 'month', year: 2025 } });
  expect(JSON.parse(r.content[0].text).periods).toHaveLength(12);
  expect(JSON.parse((await client.callTool({ name: 'search', arguments: { query: 'เล่ม' } })).content[0].text).total).toBeGreaterThan(0);
  expect((await client.callTool({ name: 'collection', arguments: {} })).isError).toBeFalsy();
});
it('reports missing data files as a tool error and keeps serving', async () => {
  // a second client whose env points at files that do not exist
  const r = await missing.callTool({ name: 'spend', arguments: { by: 'year' } });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain('refresh');
  expect((await missing.listTools()).tools).toHaveLength(4);
});
it('never writes anything but protocol messages to stdout', () => {
  expect(errors).toEqual([]); // a stray stdout line surfaces here as a parse error
});
```

- [ ] **Step 3: Run** `npx vitest run src/mcp-server.test.js` — expect FAIL (server file missing).
- [ ] **Step 4: Implement** `src/mcp-server.js`, export `readJson` from `src/stats-orders.js`, add the `mcp` script.
- [ ] **Step 5: Run** `npm test` — expect the whole suite to PASS.
- [ ] **Step 6: Verify under Windows Node from outside the repo, against the real files:**

```bash
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'check', version: '1' });
c.onerror = (e) => console.error('ERR', e.message);
await c.connect(new StdioClientTransport({ command: '/mnt/c/Program Files/nodejs/node.exe', args: ['C:\\\\NodeJS\\\\phoenix-history\\\\src\\\\mcp-server.js'], cwd: '/mnt/c/Windows' }));
console.log((await c.listTools()).tools.map((t) => t.name));
console.log(JSON.parse((await c.callTool({ name: 'spend', arguments: { by: 'year' } })).content[0].text).totals);
await c.close();"
```

Expected: the four tool names, `spent: 157191`, `books: 216`, and no `ERR` lines.
- [ ] **Step 7: Docs.** README: the `%APPDATA%\Claude\claude_desktop_config.json` snippet below, a note that Claude Desktop must be restarted after editing it, **do not put `ORDERS_COOKIE` in `env`** (it would pin the cookie and ignore every renewal), and renewal is `npm run orders` in a terminal. CLAUDE.md: the four constraints from the spec (stdout is the wire; no fetcher imports; no cookie in the server env; paths against the repo root) and the `npm run mcp` command in the Commands block.

```json
{
  "mcpServers": {
    "phoenix-history": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\NodeJS\\phoenix-history\\src\\mcp-server.js"]
    }
  }
}
```

- [ ] **Step 8: Commit** — `feat: serve orders to Claude Desktop over MCP stdio`
