/**
 * MCP server over stdio, for Claude Desktop: `search`, `collection`, `spend`
 * and `refresh` over the scraped order history. The logic lives in
 * `mcp-tools.js`; this file reads the files, registers the tools and connects.
 *
 * Four rules shape it (see docs/specs/2026-10-31-mcp-server-design.md):
 *
 * - **stdout is the wire.** One stray `console.log` corrupts the session, so
 *   nothing here prints; the scrapers, which do print, run as a child process.
 * - **No fetcher or `orders-config.js` import**, for the same reason as
 *   `server.js`: it exits at import time without a cookie, and three of the
 *   four tools need none.
 * - **No cookie in this process.** It is launched without `--env-file`. The
 *   refresh child loads `.env` itself on every run — and Node's `--env-file`
 *   does not override an inherited variable, so a cookie held here would pin
 *   the old one and ignore every renewal.
 * - **Paths resolve against the repo root**, not cwd: Claude Desktop launches
 *   the server from its own directory.
 */
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readJson } from './stats-orders.js';
import { createSyncJob } from './sync-job.js';
import { SEARCH_FIELDS, searchOrders, collectionReport, spendReport, createRefresh } from './mcp-tools.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORDERS = ['ORDERS_OUTPUT_FILE', 'orders.json'];
const DETAILS = ['ORDERS_DETAILS_FILE', 'orders-details.json'];

const dataPath = ([key, fallback]) => resolve(ROOT, process.env[key] ?? fallback);

/** Read a data file per call, so a refresh is visible without a restart. */
async function load(file) {
  const data = await readJson(dataPath(file));
  if (data === null) {
    throw new Error(`${dataPath(file)} could not be read. Ask me to refresh, ` +
      `or run npm run orders && npm run order-details in ${ROOT}`);
  }
  return data;
}

const counts = async () => ({
  orders: (await readJson(dataPath(ORDERS)))?.length ?? null,
  details: (await readJson(dataPath(DETAILS)))?.length ?? null,
});

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

const refresh = createRefresh({ job: createSyncJob(), counts, root: ROOT });

const server = new McpServer({ name: 'phoenix-history', version: '1.0.0' });

server.registerTool('search', {
  title: 'Search orders',
  description:
    'Search the Phoenix Next (phoenixnext.com) book order history. field "name" (default) matches ' +
    'book titles, "sku" product codes, "order" the order number (e.g. 000434985), "id" the internal ' +
    'order id, "code" a discount code. Case-insensitive substring match. Name and SKU searches return ' +
    'only the matching items of each order. Cancelled orders are included and flagged. Prices are ' +
    'Thai baht. Returns at most 50 orders and says how many matched.',
  inputSchema: {
    query: z.string().describe('Text to look for, e.g. part of a title or "เล่ม 2"'),
    field: z.enum(SEARCH_FIELDS).default('name'),
  },
  annotations: { readOnlyHint: true },
}, async ({ query, field }) => json(searchOrders(await load(DETAILS), { query, field })));

server.registerTool('collection', {
  title: 'Volumes owned per series',
  description:
    'Which volumes (เล่ม) of a book series were bought and which are missing between them. Call with ' +
    'no series to list every series, which is how to find the exact title. The series is matched ' +
    'loosely (spacing, case, ★/☆, ปีสอง/ปี 2). Cancelled orders and free gifts are not counted. ' +
    'Items without a volume number (box sets, one-shots) are not listed; use search for those.',
  inputSchema: {
    series: z.string().optional().describe('Part of a series title; omit to list every series'),
  },
  annotations: { readOnlyHint: true },
}, async ({ series }) => json(collectionReport(await load(DETAILS), { series })));

server.registerTool('spend', {
  title: 'Spend and books per period',
  description:
    'Money spent (Thai baht), orders and books per year, quarter (calendar, Q1 = Jan-Mar) or month. ' +
    'Cancelled orders are excluded and reported separately in totals. Books are item quantities ' +
    'excluding free gifts; a Complete Set counts as one book. Every period in range is present, zeros ' +
    'included, so by "month" with a year gives a ready-made series to chart.',
  inputSchema: {
    by: z.enum(['year', 'quarter', 'month']),
    year: z.number().int().optional().describe('Limit to one calendar year, e.g. 2026'),
  },
  annotations: { readOnlyHint: true },
}, async ({ by, year }) => json(spendReport(await load(ORDERS), await load(DETAILS), { by, year })));

server.registerTool('refresh', {
  title: 'Fetch the latest orders',
  description:
    'Fetch the latest orders from phoenixnext.com with the session cookie saved in .env, then their ' +
    'item details. Usually about 10 seconds; up to a minute or two when most orders are new. If the ' +
    'cookie has expired the result says how the user renews it in a terminal. Never ask the user to ' +
    'paste the cookie into the chat.',
  annotations: { readOnlyHint: false, openWorldHint: true },
}, async (extra) => {
  const progressToken = extra._meta?.progressToken;
  let progress = 0;
  // Progress notifications let a client that supports them keep waiting
  // instead of timing out on a slow first scrape.
  const onLine = progressToken === undefined ? undefined : (message) => {
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress: ++progress, message },
    }).catch(() => {});
  };
  return json(await refresh({ onLine }));
});

await server.connect(new StdioServerTransport());
