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

/** Find the order detail URL from any key in the order object */
function getDetailUrl(order) {
  for (const val of Object.values(order)) {
    if (typeof val === 'string' && val.includes('/sales/order/view/')) {
      return val;
    }
  }
  return null;
}

/** Extract order_id number from the detail URL */
function extractOrderId(url) {
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

async function main() {
  const orders = JSON.parse(await readFile('orders.json', 'utf-8'));

  const results = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const url = getDetailUrl(order);

    if (!url) {
      console.warn(`[${i + 1}/${orders.length}] No detail URL found, skipping`);
      results.push({ ...order, orderId: null, items: [] });
      continue;
    }

    const orderId = extractOrderId(url);
    console.log(`[${i + 1}/${orders.length}] Fetching order ${orderId}...`);

    try {
      const items = await fetchOrderItems(url);
      results.push({ ...order, orderId, items });
      console.log(`  → ${items.length} item(s)`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      results.push({ ...order, orderId, items: [], error: err.message });
    }

    // Polite delay between requests (skip after last)
    if (i < orders.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const outputPath = 'orders-details.json';
  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nWrote ${results.length} orders to ${outputPath}`);
}

export async function run() {
  await main();
}
