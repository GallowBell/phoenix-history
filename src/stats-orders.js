/**
 * `npm run stats` — the terminal rendering and file reading for the spend report.
 *
 * Read-only and, like `find-orders.js`, deliberately free of
 * `orders-config.js` — it never talks to the site, so it must work without a
 * cookie.
 *
 * The figures themselves live in `stats-report.js`, which is free of Node
 * imports so the Stats tab in the UI can compute the same numbers from the
 * same code. This module is the CLI half: read the JSON, lay the numbers out
 * as fixed-width text. Everything moved is re-exported below, so importers
 * (and `stats-orders.test.js`) can keep reaching for it here.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { formatBaht, summarise } from './orders-total.js';
import { GOODS_SERIES } from './product-name.js';
import {
  discountCodes,
  fillMonths,
  formatMonth,
  groupSpend,
  monthKey,
  parseOrderDate,
  priceGap,
  seriesSpend,
} from './stats-report.js';

export {
  DATE_KEY,
  DISCOUNT_KEY,
  discountCodes,
  fillMonths,
  formatMonth,
  groupSpend,
  monthKey,
  parseOrderDate,
  priceGap,
  seriesSpend,
} from './stats-report.js';

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
      lines.push(`  ${pad(c.code, 16)}${String(c.orders).padStart(3)} order(s)`);
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
