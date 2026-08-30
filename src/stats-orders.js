/**
 * Offline spend analysis over the scraped files.
 *
 * Read-only and, like `find-orders.js`, deliberately free of
 * `orders-config.js` — it never talks to the site, so it must work without a
 * cookie. Money rules come from `orders-total.js` so a cancelled order is
 * excluded here exactly as it is in `npm run sum`, Excel and the UI.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parsePrice, isCancelled, formatBaht, summarise, PRICE_KEY } from './orders-total.js';
import { parseProductName, GOODS_SERIES } from './product-name.js';

const DATE_KEY = 'วันที่ซื้อ';
const DISCOUNT_KEY = 'โค้ดส่วนลด';
const NO_DISCOUNT = '-';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Order dates arrive as `"29/8/26 29 สิงหาคม 2026"` — a `d/m/yy` prefix
 * followed by the same date written out in Thai. Only the prefix is parsed;
 * the Thai half is redundant and would need a month-name table to read.
 *
 * The years present run 2019–2026, so a 2-digit year maps to 2000+yy.
 * @returns {{year: number, month: number, day: number}|null}
 */
export function parseOrderDate(raw) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\b/.exec(String(raw ?? ''));
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: 2000 + Number(m[3]), month, day };
}

/** `2026-08` — sorts lexically, which is what the grouping relies on. */
export function monthKey(date) {
  return date ? `${date.year}-${String(date.month).padStart(2, '0')}` : null;
}

export function formatMonth(key) {
  const [year, month] = String(key).split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * Spend per period, cancelled orders excluded.
 * @param {object[]} orders
 * @param {(d: object) => string|null} keyOf
 */
export function groupSpend(orders, keyOf) {
  const groups = new Map();
  for (const order of orders ?? []) {
    if (isCancelled(order)) continue;
    const key = keyOf(parseOrderDate(order[DATE_KEY]));
    if (key == null) continue;
    const entry = groups.get(key) ?? { key, spent: 0, orders: 0 };
    entry.spent += parsePrice(order[PRICE_KEY]) ?? 0;
    entry.orders++;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/**
 * Spend per series, from item subtotals in the detail file.
 *
 * These are **list prices**: an order-level discount is not attributable to
 * one item, so series figures will exceed what was actually paid. The report
 * says so rather than silently apportioning.
 */
export function seriesSpend(details) {
  const groups = new Map();
  for (const order of details ?? []) {
    if (isCancelled(order)) continue;
    for (const item of order.items ?? []) {
      const parsed = parseProductName(item?.name);
      if (!parsed.key) continue;
      const entry = groups.get(parsed.key) ?? { key: parsed.key, label: parsed.series, listed: 0, items: 0 };
      entry.listed += parsePrice(item?.subtotal) ?? 0;
      entry.items += Number(item?.quantity) || 1;
      groups.set(parsed.key, entry);
    }
  }
  return [...groups.values()].sort((a, b) => b.listed - a.listed || a.label.localeCompare(b.label, 'th'));
}

/** Which discount codes were used, and on how much spend. */
export function discountCodes(orders) {
  const groups = new Map();
  for (const order of orders ?? []) {
    if (isCancelled(order)) continue;
    const code = String(order[DISCOUNT_KEY] ?? '').trim();
    if (!code || code === NO_DISCOUNT) continue;
    const entry = groups.get(code) ?? { code, orders: 0, spent: 0 };
    entry.orders++;
    entry.spent += parsePrice(order[PRICE_KEY]) ?? 0;
    groups.set(code, entry);
  }
  return [...groups.values()].sort((a, b) => b.orders - a.orders || b.spent - a.spent);
}

/**
 * The gap between what the items list for and what the order cost.
 *
 * The site exposes no discount line, so this is **derived**, and it runs both
 * ways: on this data a positive gap is a code discount, while a negative one
 * is a flat ฿35/฿50 delivery fee on older, smaller orders. They are reported
 * separately because netting them off would hide both.
 */
export function priceGap(details) {
  const out = {
    listed: 0, paid: 0,
    discount: 0, discountOrders: 0,
    surcharge: 0, surchargeOrders: 0,
    skipped: 0,
  };
  for (const order of details ?? []) {
    if (isCancelled(order)) continue;
    const paid = parsePrice(order[PRICE_KEY]);
    const items = order.items ?? [];
    const listed = items.reduce((sum, i) => sum + (parsePrice(i?.subtotal) ?? 0), 0);
    // No details fetched, or nothing priced: counting these as a 100% discount
    // would be worse than leaving them out and saying how many were left out.
    if (paid == null || !items.length || listed === 0) {
      out.skipped++;
      continue;
    }
    out.listed += listed;
    out.paid += paid;
    const gap = listed - paid;
    if (gap > 0.005) {
      out.discount += gap;
      out.discountOrders++;
    } else if (gap < -0.005) {
      out.surcharge += -gap;
      out.surchargeOrders++;
    }
  }
  return out;
}

/**
 * Insert the months that saw no orders as explicit zeroes.
 *
 * `groupSpend` only emits months that have data, which reads as a continuous
 * run and hides the quiet months entirely — a gap is a fact about the spending,
 * so it gets a row.
 */
export function fillMonths(rows) {
  if (rows.length < 2) return rows;
  const out = [];
  // Derived from the min and max key, not from rows[0]/rows.at(-1): reading
  // the ends off an unsorted list yields a backwards range, and the loop below
  // would then emit nothing and silently drop every row.
  const keys = rows.map((r) => r.key).sort();
  const [startY, startM] = keys[0].split('-').map(Number);
  const [endY, endM] = keys.at(-1).split('-').map(Number);
  const found = new Map(rows.map((r) => [r.key, r]));
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(found.get(key) ?? { key, spent: 0, orders: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** A proportional bar, for scanning a column of figures at a glance. */
export function bar(value, max, width = 24) {
  if (!(max > 0) || !(value > 0)) return '';
  return '█'.repeat(Math.max(1, Math.round((value / max) * width)));
}

async function readJson(path) {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

/** Parse `--top N` / `--months N`, defaulting when absent or not a number. */
export function parseArgs(argv) {
  const opts = { top: 10, months: 12 };
  for (const [flag, key] of [['--top', 'top'], ['--months', 'months']]) {
    const i = argv.indexOf(flag);
    if (i === -1) continue;
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) opts[key] = Math.floor(n);
  }
  if (argv.includes('--all')) {
    opts.top = Infinity;
    opts.months = Infinity;
  }
  return opts;
}

export function report(orders, details, opts = {}) {
  const { top = 10, months = 12 } = opts;
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  const money = (n) => formatBaht(n).padStart(12);

  const { count, spent, cancelledCount, cancelledAmount } = summarise(orders);
  lines.push('Overall');
  lines.push(`  Orders            ${count}`);
  lines.push(`  Spent          ${money(spent)}`);
  if (cancelledCount) {
    lines.push(`  Cancelled      ${money(cancelledAmount)}  (${cancelledCount} order(s), not counted above)`);
  }

  const years = groupSpend(orders, (d) => (d ? String(d.year) : null));
  if (years.length) {
    const max = Math.max(...years.map((y) => y.spent));
    lines.push('', 'Spend by year');
    for (const y of years) {
      lines.push(`  ${pad(y.key, 6)}${money(y.spent)}  ${pad(`${y.orders} order(s)`, 12)} ${bar(y.spent, max)}`);
    }
  }

  const byMonth = fillMonths(groupSpend(orders, monthKey));
  if (byMonth.length) {
    const shown = Number.isFinite(months) ? byMonth.slice(-months) : byMonth;
    const max = Math.max(...shown.map((m) => m.spent));
    const label = byMonth.length > shown.length
      ? `Spend by month (last ${shown.length} of ${byMonth.length})`
      : 'Spend by month';
    lines.push('', label);
    for (const m of shown) {
      const count = m.orders ? `${m.orders} order(s)` : '-';
      lines.push(`  ${pad(formatMonth(m.key), 10)}${money(m.spent)}  ${pad(count, 12)} ${bar(m.spent, max)}`);
    }
  }

  if (details?.length) {
    const series = seriesSpend(details).filter((s) => s.label !== GOODS_SERIES);
    if (series.length) {
      const shown = Number.isFinite(top) ? series.slice(0, top) : series;
      lines.push('', `Top series by list price${Number.isFinite(top) && series.length > shown.length ? ` (${shown.length} of ${series.length})` : ''}`);
      shown.forEach((s, i) => {
        lines.push(`  ${pad(`${i + 1}.`, 4)}${money(s.listed)}  ${pad(`${s.items} item(s)`, 12)} ${s.label}`);
      });
      lines.push('  Item prices are list prices — an order discount belongs to the order, not one item.');
    }

    const gap = priceGap(details);
    lines.push('', 'List price vs paid');
    lines.push(`  Items list to  ${money(gap.listed)}`);
    lines.push(`  Paid           ${money(gap.paid)}`);
    lines.push(`  Discounts      ${`-${formatBaht(gap.discount)}`.padStart(12)}  across ${gap.discountOrders} order(s)`);
    lines.push(`  Delivery/fees  ${`+${formatBaht(gap.surcharge)}`.padStart(12)}  across ${gap.surchargeOrders} order(s)`);
    if (gap.skipped) {
      lines.push(`  ${gap.skipped} order(s) had no priced items and were left out.`);
    }
    lines.push('  Derived: the site shows no discount line, only the item prices and the total.');
  } else {
    lines.push('', 'No order details on disk — run `npm run order-details` for series and discount figures.');
  }

  const codes = discountCodes(orders);
  if (codes.length) {
    const shown = Number.isFinite(top) ? codes.slice(0, top) : codes;
    lines.push('', `Discount codes used${Number.isFinite(top) && codes.length > shown.length ? ` (${shown.length} of ${codes.length})` : ''}`);
    for (const c of shown) {
      lines.push(`  ${pad(c.code, 14)}${money(c.spent)}  ${c.orders} order(s)`);
    }
  }

  return lines.join('\n');
}

export async function run() {
  const opts = parseArgs(process.argv.slice(3));
  const ordersPath = process.env.ORDERS_OUTPUT_FILE ?? 'orders.json';
  const detailsPath = process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json';

  const orders = await readJson(ordersPath);
  if (orders === null) {
    console.error(`Could not read ${ordersPath}. Run \`npm run orders\` first.`);
    process.exitCode = 1;
    return;
  }
  if (!orders.length) {
    console.error(`${ordersPath} holds no orders. Run \`npm run orders\` first.`);
    process.exitCode = 1;
    return;
  }

  console.log(report(orders, await readJson(detailsPath), opts));
}
