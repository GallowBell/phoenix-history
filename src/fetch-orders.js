import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFile } from 'fs/promises';
import config from './orders-config.js';

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';

export function buildUrl(page) {
  return page > 1 ? `${config.url}&p=${page}` : config.url;
}

async function fetchPage(page, headers) {
  const url = buildUrl(page);
  const response = await axios.get(url, {
    maxRedirects: 0,
    validateStatus: (status) => status < 400,
    headers: {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'en,th-TH;q=0.9,th;q=0.8,ja;q=0.7',
      'cache-control': 'no-cache',
      cookie: config.cookie,
      pragma: 'no-cache',
      priority: 'u=0, i',
      referer: buildUrl(page - 1),
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
    },
  });

  // Server redirects when page is out of range
  if (response.status >= 300 && response.status < 400) {
    return null;
  }

  const $ = cheerio.load(response.data);
  const table = $('#my-orders-table');

  if (!table.length) {
    // Could be a redirect to login or an empty page beyond last page
    return null;
  }

  // Extract column headers (only needed once, passed in after page 1)
  if (!headers.length) {
    table.find('thead tr th').each((_, th) => {
      headers.push($(th).text().trim());
    });
  }

  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('th, td');
    if (!cells.length) return;

    const row = {};
    cells.each((i, cell) => {
      const key = headers[i];
      if (!key) return;

      const $cell = $(cell).clone();
      $cell.find('.lg\\:hidden').remove();

      const textContent = $cell.text().replace(/\s+/g, ' ').trim();
      const anchor = $cell.find('a[href]').first();
      if (!textContent && anchor.length) {
        row[key] = anchor.attr('href');
      } else {
        row[key] = textContent;
      }
    });
    rows.push(row);
  });

  return rows;
}

async function fetchOrders() {
  const allOrders = [];
  const headers = [];
  let firstOrderNumber = null;
  let page = 1;

  while (true) {
    console.error(`Fetching page ${page}…`);
    const rows = await fetchPage(page, headers);

    // null means redirect or no table — we've gone past the last page
    if (!rows || rows.length === 0) {
      console.error(`Page ${page}: no data, stopping.`);
      break;
    }

    const pageFirstOrderNumber = rows[0][ORDER_NUMBER_KEY];

    // On page > 1, if the server looped back to page 1, the first order number will match
    if (page > 1 && pageFirstOrderNumber === firstOrderNumber) {
      console.error(`Page ${page}: duplicate of page 1, stopping.`);
      break;
    }

    if (page === 1) {
      firstOrderNumber = pageFirstOrderNumber;
    }

    allOrders.push(...rows);
    console.error(`Page ${page}: ${rows.length} orders (total: ${allOrders.length})`);
    page++;
  }

  const json = JSON.stringify(allOrders, null, 2);

  if (config.outputFile) {
    await writeFile(config.outputFile, json, 'utf-8');
    console.log(`Wrote ${allOrders.length} orders to ${config.outputFile}`);
  } else {
    console.log(json);
  }
}

export async function run() {
  await fetchOrders();
}
