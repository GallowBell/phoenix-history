import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'fs/promises';
import config from './orders-config.js';

const HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en,th-TH;q=0.9,th;q=0.8,ja;q=0.7',
  'cache-control': 'no-cache',
  cookie: config.cookie,
  pragma: 'no-cache',
  'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';
const STATUS_KEY = 'สถานะ';

// Orders in these states are finished and their items can never change, so a
// previous run's result is safe to reuse. Any other status — including one we
// don't recognise — is re-fetched every time.
const TERMINAL_STATUSES = new Set(['จัดส่งแล้ว', 'ออร์เดอร์ยกเลิก']);

// The site saturates around 4 concurrent detail requests; 8 measured no faster.
const CONCURRENCY = 4;

/** Find the order detail URL from any key in the order object */
export function getDetailUrl(order) {
  for (const val of Object.values(order)) {
    if (typeof val === 'string' && val.includes('/sales/order/view/')) {
      return val;
    }
  }
  return null;
}

/** Extract order_id number from the detail URL */
export function extractOrderId(url) {
  const match = url.match(/order_id\/(\d+)/);
  return match ? match[1] : null;
}

/** Fetch one order detail page and extract items from .order-items */
async function fetchOrderItems(url) {
  const response = await axios.get(url, { headers: { ...HEADERS, referer: url } });
  const $ = cheerio.load(response.data);

  const items = [];

  $('.parent-item').each((_, parentItem) => {
    const $grid = $(parentItem).find('.lg\\:grid.grid-cols-5').first();

    // Column 1-2: product name + SKU
    const $infoCol = $grid.find('.p-2.col-span-2').first();
    const name = $infoCol.find('> span.font-semibold').first().text().trim();
    const sku = $infoCol
      .find('.item-options .text-sm.flex span:not(.font-semibold)')
      .first()
      .text()
      .trim();

    // All price spans in this row — index 0 = unit price, index 1 = subtotal
    const priceCells = $grid.find('span.price-including-tax span.price');
    const price = priceCells.eq(0).text().trim();
    const subtotal = priceCells.eq(1).text().trim();

    // Quantity
    const quantity = $grid.find('span.content.font-semibold').first().text().trim();

    items.push({ name, sku, price, quantity, subtotal });
  });

  return items;
}

/** Index the previous run's output by order number so finished orders can be reused. */
export async function loadCache(path) {
  try {
    const previous = JSON.parse(await readFile(path, 'utf-8'));
    return new Map(previous.map((o) => [o[ORDER_NUMBER_KEY], o]));
  } catch {
    // No previous run, or the file is unreadable — fetch everything.
    return new Map();
  }
}

/**
 * Reuse a cached record only when the order is finished, its status has not
 * changed since the cache was written, and that run actually produced items —
 * so a failed or empty parse never gets frozen in.
 */
export function isCacheable(cached, order) {
  if (!cached || cached.error) return false;
  if (!TERMINAL_STATUSES.has(order[STATUS_KEY])) return false;
  if (cached[STATUS_KEY] !== order[STATUS_KEY]) return false;
  return Array.isArray(cached.items) && cached.items.length > 0;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving input order. */
export async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const ordersPath = process.env.ORDERS_OUTPUT_FILE ?? 'orders.json';
  const outputPath = process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json';

  const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));
  const cache = force ? new Map() : await loadCache(outputPath);

  let reused = 0;
  let fetched = 0;
  let failed = 0;

  const results = await mapPool(orders, CONCURRENCY, async (order, i) => {
    const label = `[${i + 1}/${orders.length}]`;
    const cached = cache.get(order[ORDER_NUMBER_KEY]);

    if (isCacheable(cached, order)) {
      reused++;
      return { ...order, orderId: cached.orderId, items: cached.items };
    }

    const url = getDetailUrl(order);
    if (!url) {
      console.warn(`${label} No detail URL found, skipping`);
      return { ...order, orderId: null, items: [] };
    }

    const orderId = extractOrderId(url);

    try {
      const items = await fetchOrderItems(url);
      fetched++;
      console.log(`${label} order ${orderId} → ${items.length} item(s)`);
      return { ...order, orderId, items };
    } catch (err) {
      failed++;
      console.error(`${label} order ${orderId} ✗ ${err.message}`);
      return { ...order, orderId, items: [], error: err.message };
    }
  });

  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');

  console.log(`\nWrote ${results.length} orders to ${outputPath}`);
  console.log(`Reused ${reused} cached, fetched ${fetched}${failed ? `, ${failed} failed` : ''}`);
  if (reused > 0) console.log('Run with --force to re-fetch everything.');
}

export async function run() {
  await main();
}
