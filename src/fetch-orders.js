import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'fs/promises';
import config from './orders-config.js';
import { SessionExpiredError, isRedirect, isLoginRedirect, NO_REDIRECT } from './session.js';
import { isTerminal } from './orders-total.js';

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';

export function buildUrl(page) {
  return page > 1 ? `${config.url}&p=${page}` : config.url;
}

async function fetchPage(page, headers) {
  const url = buildUrl(page);
  const response = await axios.get(url, {
    ...NO_REDIRECT,
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

  // Measured on the live site: a page past the last returns 200 and silently
  // re-serves page 1 (caught below by the duplicate check) — it never 3xxs. A
  // redirect to the login path is therefore an expired session on ANY page,
  // and treating a later one as "past the last page" would truncate the file.
  if (isLoginRedirect(response)) throw new SessionExpiredError(url);
  if (isRedirect(response.status)) return null;

  return parseOrdersPage(response.data, headers);
}

/**
 * The order table as records, keyed by the site's own Thai `<thead>` cells.
 *
 * Split out of `fetchPage` so the selectors can be exercised against saved
 * markup. Selector breakage is the documented failure mode when the site
 * changes, and while it was welded to the axios call it was the one thing the
 * suite could not see.
 *
 * `headers` is an in/out parameter, as it was inside the fetch loop: page 1
 * fills it from `<thead>` and later pages reuse it. Returns null when there is
 * no table at all — a 200 login page, or a page past the last one.
 */
export function parseOrdersPage(html, headers = []) {
  const $ = cheerio.load(html);
  const table = $('#my-orders-table');

  if (!table.length) return null;

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

async function fetchOrders({ force = false } = {}) {
  const existing = await loadExisting(config.outputFile);
  // `--force` re-reads every page. The existing file is still loaded, because
  // the empty-overwrite guard below has to know what it would be replacing.
  const known = force ? new Set() : new Set(existing.map(numberOf).filter(Boolean));
  const pendingRemaining = force ? new Set() : pendingNumbers(existing);

  if (known.size) {
    console.error(
      `Resuming from ${existing.length} order(s) on disk` +
        (pendingRemaining.size ? `, ${pendingRemaining.size} still in progress` : '') +
        '. Pass --force for a full re-scrape.'
    );
  }

  const scraped = [];
  const headers = [];
  let firstOrderNumber = null;
  let page = 1;
  let stoppedEarly = false;

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

    scraped.push(...rows);
    for (const row of rows) pendingRemaining.delete(numberOf(row));
    console.error(`Page ${page}: ${rows.length} orders (total: ${scraped.length})`);

    if (canStopEarly(rows, known, pendingRemaining)) {
      console.error(`Page ${page}: already up to date from here down, stopping.`);
      stoppedEarly = true;
      break;
    }
    page++;
  }

  const merged = mergeOrders(scraped, existing);
  // Counted over distinct order numbers, not raw rows: a merge only ever grows
  // the file, so the growth *is* the number of new orders, and the rest of what
  // was scraped is a re-check. Counting rows would double-count an order that
  // arrived twice because the list shifted mid-scrape.
  const distinct = new Set(scraped.map(numberOf).filter((n) => n != null)).size;
  const added = merged.length - existing.length;
  const rechecked = distinct - added;

  if (config.outputFile) {
    if (refusesEmptyOverwrite(scraped.length, existing.length)) {
      throw new Error(
        `Scraped 0 orders but ${config.outputFile} already holds ${existing.length} — refusing to overwrite it.\n` +
          '  The site returned no order table. That usually means the page layout changed,\n' +
          '  or the session is no longer valid. Your existing data has been left alone.'
      );
    }
    // A merge can only ever grow the list. Shrinking means the scrape and the
    // file disagree about which orders exist, which is not something to write.
    if (merged.length < existing.length) {
      throw new Error(
        `Merge produced ${merged.length} orders but ${config.outputFile} holds ${existing.length} — refusing to overwrite it.`
      );
    }
    await writeFile(config.outputFile, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(
      `Wrote ${merged.length} orders to ${config.outputFile}` +
        ` (${added} new, ${rechecked} re-checked` +
        (stoppedEarly ? `, ${existing.length - rechecked} untouched)` : ')')
    );
  } else {
    console.log(JSON.stringify(merged, null, 2));
  }
}

/** The previous run's orders, or [] when there is no readable file. */
export async function loadExisting(path) {
  if (!path) return [];
  try {
    const previous = JSON.parse(await readFile(path, 'utf-8'));
    return Array.isArray(previous) ? previous : [];
  } catch {
    return [];
  }
}

const numberOf = (order) => order?.[ORDER_NUMBER_KEY];

/**
 * Order numbers already on disk whose status can still change.
 *
 * These are why the scrape cannot simply stop at the first familiar order: a
 * `กำลังเตรียมสินค้า` order will later become `จัดส่งแล้ว`, and stopping above
 * it would leave that stale forever. Paging continues until every one has been
 * re-read, which in practice costs nothing — pending orders are the newest, so
 * they sit on the first page or two.
 */
export function pendingNumbers(existing) {
  const out = new Set();
  for (const order of existing ?? []) {
    if (isTerminal(order)) continue;
    const number = numberOf(order);
    if (number) out.add(number);
  }
  return out;
}

/**
 * Can paging stop here?
 *
 * The history is newest-first and append-only, so the first order we recognise
 * marks the boundary: everything below it is older, and therefore already on
 * disk. One known order on the page is enough — requiring the *whole* page to
 * be known costs an extra page fetch whenever new orders share a page with old
 * ones, which is the common case.
 *
 * The pending check overrides that: a known order whose status can still change
 * has to be re-read wherever it sits, so paging continues until none are left.
 */
export function canStopEarly(rows, known, pendingRemaining) {
  if (!known.size) return false;
  if (!rows.some((row) => known.has(numberOf(row)))) return false;
  return pendingRemaining.size === 0;
}

/**
 * Scraped rows sit on top of whatever was not re-read.
 *
 * The site lists newest first and the scrape always starts at page 1, so the
 * scraped run is a prefix of the true list — concatenating preserves order.
 * A re-read order replaces its stored copy, which is how a status change lands.
 *
 * The scrape is de-duplicated first, keeping the earliest (newest) copy: an
 * order placed while paging shifts every later row down one, so the same order
 * can arrive twice on consecutive pages.
 */
export function mergeOrders(scraped, existing) {
  const seen = new Set();
  const deduped = [];
  for (const order of scraped ?? []) {
    const number = numberOf(order);
    if (number != null && seen.has(number)) continue;
    if (number != null) seen.add(number);
    deduped.push(order);
  }
  return [...deduped, ...(existing ?? []).filter((order) => !seen.has(numberOf(order)))];
}

/** How many orders the previous run left on disk; 0 when there is no readable file. */
export async function countExisting(path) {
  try {
    const previous = JSON.parse(await readFile(path, 'utf-8'));
    return Array.isArray(previous) ? previous.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Guard against clobbering a good `orders.json` with an empty scrape. A run
 * that finds nothing where there was previously something is a failure, not a
 * legitimately empty history — and the whole pipeline downstream reads this file.
 */
export function refusesEmptyOverwrite(newCount, existingCount) {
  return newCount === 0 && existingCount > 0;
}

export async function run() {
  // The dispatcher forwards nothing; commands read their own flags, as
  // `order-details` does for its own --force.
  await fetchOrders({ force: process.argv.includes('--force') });
}
