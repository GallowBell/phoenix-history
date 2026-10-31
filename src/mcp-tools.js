/**
 * The logic behind the MCP server's tools — data in, plain objects out — so it
 * is tested without a stdio session. `mcp-server.js` only reads the files,
 * registers these and connects.
 *
 * Built on the modules the CLI and the UI already use, so an answer in Claude
 * Desktop matches `npm run find`, `collection` and `stats` for the same files.
 */
import { findOrders, resolveField } from './find-orders.js';
import { collectSeries, collectionSummary } from './collection-report.js';
import { seriesKey } from './product-name.js';
import { parseOrderDate, DATE_KEY, groupSpend, groupBooks, periodKeys, PERIOD_KEYS } from './stats-report.js';
import { isCancelled, summarise, PRICE_KEY, STATUS_KEY } from './orders-total.js';

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';

/** The `field` values `search` accepts — aliases `npm run find` understands. */
export const SEARCH_FIELDS = ['name', 'sku', 'order', 'id', 'code'];

/** `2026-08-29`, or the raw string when the date does not parse. */
function isoDate(raw) {
  const d = parseOrderDate(raw);
  if (!d) return raw ?? null;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/**
 * `npm run find` for Claude: name/SKU searches return only the matching items,
 * order-level searches the whole order. Cancelled orders are returned and
 * flagged — "did I order this?" deserves the honest answer.
 */
export function searchOrders(details, { query, field = 'name', limit = 50 }) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('query must not be empty');
  const hits = findOrders(details ?? [], resolveField(field), q);
  return {
    total: hits.length,
    shown: Math.min(hits.length, limit),
    orders: hits.slice(0, limit).map(({ order, items }) => ({
      orderNumber: order[ORDER_NUMBER_KEY],
      orderId: order.orderId,
      date: isoDate(order[DATE_KEY]),
      status: order[STATUS_KEY],
      netPrice: order[PRICE_KEY],
      cancelled: isCancelled(order),
      items: items.map(({ name, sku, price, quantity }) => ({ name, sku, price, quantity })),
    })),
  };
}

export const COLLECTION_CAVEAT =
  'Only orders from phoenixnext.com are counted, so a missing volume may have been bought elsewhere. ' +
  'Items without a เล่ม number (box sets, one-shots) are not listed here; use search to find them.';

/**
 * `npm run collection` for Claude. With no series it lists every title, which
 * is how Claude finds the site's spelling of a name typed loosely; with one it
 * matches through `seriesKey`, so `ปีสอง`/`ปี 2` and `★`/`☆` are the same series.
 */
export function collectionReport(details, { series } = {}) {
  const all = collectSeries(details ?? []);
  const q = String(series ?? '').trim();

  if (!q) {
    return {
      summary: collectionSummary(details ?? []),
      series: all.map(({ label, count, first, last, missing, startsAbove }) =>
        ({ label, count, first, last, missing, startsAbove })),
      caveat: COLLECTION_CAVEAT,
    };
  }

  const key = seriesKey(q);
  const matches = all
    .filter((s) => s.key.includes(key))
    .map(({ label, volumes, count, first, last, missing, startsAbove }) =>
      ({ label, volumes, count, first, last, missing, startsAbove }));
  const result = { series: matches, caveat: COLLECTION_CAVEAT };
  if (!matches.length) result.hint = `No series matched "${q}". Call collection with no series to list every title.`;
  return result;
}

/** Baht to the satang, so a sum never reads `300.29999999999995`. */
const round = (x) => Math.round(x * 100) / 100;

/** The first and last key of a calendar year at each granularity. */
const YEAR_BOUNDS = {
  year: (y) => [`${y}`, `${y}`],
  quarter: (y) => [`${y}-Q1`, `${y}-Q4`],
  month: (y) => [`${y}-01`, `${y}-12`],
};

/**
 * Spend, orders and books per year, quarter or month. Money comes from the
 * order list via `groupSpend`, as `npm run stats` does; books from the detail
 * file via `groupBooks`. Every period in range gets a row — a quiet month is a
 * fact a chart must show, not a gap to close up.
 *
 * With `year`, the range is that calendar year, cut at `now` for the current
 * one so the chart does not run on into months that have not happened.
 */
export function spendReport(orders, details, { by, year, now = new Date() }) {
  const keyOf = PERIOD_KEYS[by];
  const inYear = (o) => year == null || parseOrderDate(o?.[DATE_KEY])?.year === year;
  const yearOrders = (orders ?? []).filter(inYear);
  const yearDetails = (details ?? []).filter(inYear);

  const money = new Map(groupSpend(yearOrders, keyOf).map((r) => [r.key, r]));
  const books = new Map(groupBooks(yearDetails, keyOf).map((r) => [r.key, r.books]));

  let range = null;
  if (year != null) {
    const [first, last] = YEAR_BOUNDS[by](year);
    range = [first, year === now.getFullYear() ? keyOf({ year, month: now.getMonth() + 1 }) : last];
  } else {
    const keys = [...money.keys(), ...books.keys()].sort();
    if (keys.length) range = [keys[0], keys.at(-1)];
  }

  const periods = range
    ? periodKeys(by, ...range).map((period) => ({
      period,
      spent: round(money.get(period)?.spent ?? 0),
      orders: money.get(period)?.orders ?? 0,
      books: books.get(period) ?? 0,
    }))
    : [];

  const total = summarise(yearOrders);
  return {
    by,
    year: year ?? null,
    periods,
    totals: {
      spent: round(total.spent),
      orders: periods.reduce((n, p) => n + p.orders, 0),
      books: periods.reduce((n, p) => n + p.books, 0),
      cancelledOrders: total.cancelledCount,
      cancelledAmount: round(total.cancelledAmount),
    },
  };
}
