import { describe, it, expect } from 'vitest';
import {
  buildUrl,
  refusesEmptyOverwrite,
  countExisting,
  pendingNumbers,
  canStopEarly,
  mergeOrders,
  loadExisting,
  parseOrdersPage,
} from './fetch-orders.js';
import { DELIVERED_STATUS, CANCELLED_STATUS } from './orders-total.js';
import { writeFile, rm } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import config from './orders-config.js';

describe('fetch-orders buildUrl', () => {
  it('returns the base config URL for page 1', () => {
    expect(buildUrl(1)).toBe(config.url);
  });

  it('appends the page query param for page > 1', () => {
    expect(buildUrl(2)).toBe(`${config.url}&p=2`);
    expect(buildUrl(5)).toBe(`${config.url}&p=5`);
  });
});

describe('refusesEmptyOverwrite', () => {
  it('refuses when a scrape returns nothing but the file already has orders', () => {
    expect(refusesEmptyOverwrite(0, 103)).toBe(true);
  });

  it('allows a genuinely empty first run', () => {
    expect(refusesEmptyOverwrite(0, 0)).toBe(false);
  });

  it('allows any non-empty scrape, including a shrinking one', () => {
    expect(refusesEmptyOverwrite(103, 103)).toBe(false);
    expect(refusesEmptyOverwrite(1, 103)).toBe(false);
  });
});

describe('countExisting', () => {
  it('counts the orders in an existing file', async () => {
    const p = join(tmpdir(), `orders-count-${Date.now()}.json`);
    await writeFile(p, JSON.stringify([{ a: 1 }, { a: 2 }]), 'utf-8');
    expect(await countExisting(p)).toBe(2);
    await rm(p, { force: true });
  });

  it('reports 0 for a missing file, so a first run is never blocked', async () => {
    expect(await countExisting(join(tmpdir(), 'does-not-exist-orders.json'))).toBe(0);
  });

  it('reports 0 for unreadable JSON rather than throwing', async () => {
    const p = join(tmpdir(), `orders-bad-${Date.now()}.json`);
    await writeFile(p, 'not json', 'utf-8');
    expect(await countExisting(p)).toBe(0);
    await rm(p, { force: true });
  });
});

describe('incremental scraping', () => {
  const order = (number, status = DELIVERED_STATUS) => ({
    'หมายเลขคำสั่งซื้อ': number,
    'สถานะ': status,
  });
  const PENDING = 'กำลังเตรียมสินค้า';

  describe('pendingNumbers', () => {
    it('collects only the orders whose status can still change', () => {
      const out = pendingNumbers([
        order('1'), order('2', PENDING), order('3', CANCELLED_STATUS), order('4', PENDING),
      ]);
      expect([...out].sort()).toEqual(['2', '4']);
    });

    it('treats an unrecognised status as still moving', () => {
      expect(pendingNumbers([order('1', 'สถานะใหม่')]).has('1')).toBe(true);
    });

    it('handles an empty or missing list', () => {
      expect(pendingNumbers([]).size).toBe(0);
      expect(pendingNumbers(undefined).size).toBe(0);
    });
  });

  describe('canStopEarly', () => {
    const known = new Set(['1', '2']);

    it('stops when the page is all known and nothing is pending', () => {
      expect(canStopEarly([order('1'), order('2')], known, new Set())).toBe(true);
    });

    it('stops at the first known order, even beside new ones', () => {
      // Newest-first and append-only: a familiar order means everything below
      // is already on disk, so the rest of the page does not have to be known.
      expect(canStopEarly([order('99'), order('1')], known, new Set())).toBe(true);
    });

    it('keeps going while the whole page is new', () => {
      expect(canStopEarly([order('98'), order('99')], known, new Set())).toBe(false);
    });

    it('keeps going while a pending order has not been re-read', () => {
      // This is the case that makes a plain "stop at the first familiar order"
      // wrong: order 2 is known, but its status is still moving.
      expect(canStopEarly([order('1')], known, new Set(['2']))).toBe(false);
    });

    it('never stops early on a first run, when nothing is known', () => {
      expect(canStopEarly([order('1')], new Set(), new Set())).toBe(false);
    });
  });

  describe('mergeOrders', () => {
    it('keeps orders that were not re-read', () => {
      const merged = mergeOrders([order('3'), order('2')], [order('2'), order('1')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['3', '2', '1']);
    });

    it('lets a re-read order replace its stored copy, so a status change lands', () => {
      const merged = mergeOrders([order('1', DELIVERED_STATUS)], [order('1', PENDING)]);
      expect(merged).toHaveLength(1);
      expect(merged[0]['สถานะ']).toBe(DELIVERED_STATUS);
    });

    it('preserves newest-first order across the join', () => {
      const merged = mergeOrders([order('9'), order('8')], [order('8'), order('7'), order('6')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['9', '8', '7', '6']);
    });

    it('returns the scrape unchanged when there is nothing on disk', () => {
      expect(mergeOrders([order('1')], [])).toHaveLength(1);
      expect(mergeOrders([order('1')], undefined)).toHaveLength(1);
    });

    it('drops a row the scrape saw twice', () => {
      // An order placed mid-scrape shifts every later row down one, so the
      // same order can come back on the next page.
      const merged = mergeOrders([order('3'), order('2'), order('2'), order('1')], [order('1')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['3', '2', '1']);
    });

    it('keeps the newest copy of a duplicated order', () => {
      const merged = mergeOrders([order('1', PENDING), order('1', DELIVERED_STATUS)], []);
      expect(merged).toHaveLength(1);
      expect(merged[0]['สถานะ']).toBe(PENDING);
    });

    it('can only grow the list, never shrink it', () => {
      const existing = [order('3'), order('2'), order('1')];
      expect(mergeOrders([], existing)).toHaveLength(3);
      expect(mergeOrders([order('4')], existing)).toHaveLength(4);
    });
  });

  describe('loadExisting', () => {
    it('returns [] for a missing file or no path', async () => {
      expect(await loadExisting('/nope/does-not-exist.json')).toEqual([]);
      expect(await loadExisting(null)).toEqual([]);
    });
  });
});

/**
 * The one part of the scraper the rest of the suite cannot see.
 *
 * Everything else here tests the logic *around* the parse — paging, merging,
 * the stop rule. These run the cheerio selectors themselves against saved
 * markup, which is the documented failure mode when the site changes.
 *
 * `tests/fixtures/order-history-page.html` is a reconstruction, not a capture:
 * it is built to satisfy what the live parser demonstrably produced (the eight
 * Thai keys in order, an empty address and reorder cell, a URL for the detail
 * cell). It cannot prove the live markup still looks like this — only a fresh
 * capture does that — but it does pin every behaviour the parser relies on.
 */
describe('parseOrdersPage', () => {
  const html = readFileSync('tests/fixtures/order-history-page.html', 'utf8');

  it('keys each row by the <thead> cells verbatim, which is the data contract', () => {
    const headers = [];
    const rows = parseOrdersPage(html, headers);
    expect(headers).toEqual([
      'หมายเลขคำสั่งซื้อ',
      'วันที่ซื้อ',
      'ที่อยู่จัดส่ง',
      'ราคาสุทธิ',
      'โค้ดส่วนลด',
      'สถานะ',
      'ดูรายละเอียด',
      'สั่งซื้ออีกครั้ง',
    ]);
    expect(Object.keys(rows[0])).toEqual(headers);
  });

  it('reads every row on the page', () => {
    const rows = parseOrdersPage(html, []);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r['หมายเลขคำสั่งซื้อ'])).toEqual(['000100001', '000100002', '000100003']);
  });

  it('strips the lg:hidden mobile label instead of reading it as the value', () => {
    // Every cell repeats its column name for narrow screens. Left in, the
    // status would parse as 'สถานะ กำลังเตรียมสินค้า' and never match
    // isTerminal() — the incremental scrape would re-read the whole history.
    const rows = parseOrdersPage(html, []);
    expect(rows[0]['สถานะ']).toBe('กำลังเตรียมสินค้า');
    expect(rows[0]['ราคาสุทธิ']).toBe('฿1,800.00');
    expect(rows[0]['หมายเลขคำสั่งซื้อ']).toBe('000100001');
  });

  it('collapses the split date cell into the single string the parser expects', () => {
    // The two halves sit in separate spans; stats parses the d/m/yy prefix.
    expect(parseOrdersPage(html, [])[0]['วันที่ซื้อ']).toBe('29/8/26 29 สิงหาคม 2026');
  });

  it('takes the href when a cell holds an icon link and no text', () => {
    // This is how ดูรายละเอียด becomes a URL, which the whole details
    // pipeline depends on — getDetailUrl() scans the row for exactly this.
    const rows = parseOrdersPage(html, []);
    expect(rows[0]['ดูรายละเอียด']).toBe(
      'https://www.phoenixnext.com/sales/order/view/order_id/100001/'
    );
  });

  it('leaves a cell empty when its action is a form button rather than a link', () => {
    // สั่งซื้ออีกครั้ง posts to the cart; if its URL leaked into the row,
    // getDetailUrl could hand the details fetcher the wrong page.
    const rows = parseOrdersPage(html, []);
    expect(rows[0]['สั่งซื้ออีกครั้ง']).toBe('');
    expect(rows[0]['ที่อยู่จัดส่ง']).toBe('');
  });

  it('reuses headers already read rather than re-reading them per page', () => {
    // Page 2+ is parsed with the headers page 1 filled in.
    const headers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rows = parseOrdersPage(html, headers);
    expect(headers).toHaveLength(8);
    expect(Object.keys(rows[0])).toEqual(headers);
  });

  it('returns null for a 200 login page, which no redirect check can catch', () => {
    // An expired session can arrive as a 200. Returning null is what makes
    // the caller stop rather than write an empty orders.json.
    const login = readFileSync('tests/fixtures/login-page.html', 'utf8');
    expect(parseOrdersPage(login, [])).toBeNull();
  });

  it('parses each status the live site actually uses', () => {
    const rows = parseOrdersPage(html, []);
    expect(rows.map((r) => r['สถานะ'])).toEqual([
      'กำลังเตรียมสินค้า',
      DELIVERED_STATUS,
      CANCELLED_STATUS,
    ]);
  });
});

/**
 * Precedence rules, pinned with minimal synthetic markup rather than a page
 * fixture. These are statements about the parser, not claims about the site:
 * each one exists because the selector is written a particular way, and a
 * refactor that "simplified" it would change the scraped data silently.
 */
describe('parseOrdersPage cell rules', () => {
  const page = (cells) => `
    <table id="my-orders-table">
      <thead><tr><th>ก</th><th>ข</th></tr></thead>
      <tbody><tr>${cells}</tr></tbody>
    </table>`;

  it('prefers a cell’s text over its link, taking the href only when there is no text', () => {
    // A linked order number must stay the order number. Reversing this would
    // put a URL in หมายเลขคำสั่งซื้อ and break every lookup keyed on it.
    const rows = parseOrdersPage(
      page('<td><a href="https://example.com/x/">000100001</a></td><td><a href="https://example.com/y/"></a></td>'),
      []
    );
    expect(rows[0]['ก']).toBe('000100001');
    expect(rows[0]['ข']).toBe('https://example.com/y/');
  });

  it('reads a <th> in a body row as a cell, not just <td>', () => {
    // The first cell of a row is markup-dependent; scoping to td alone would
    // drop it and shift every remaining value one column left.
    const rows = parseOrdersPage(page('<th>000100001</th><td>two</td>'), []);
    expect(rows[0]['ก']).toBe('000100001');
    expect(rows[0]['ข']).toBe('two');
  });

  it('ignores a column with no header rather than keying it undefined', () => {
    const rows = parseOrdersPage(page('<td>one</td><td>two</td><td>extra</td>'), []);
    expect(Object.keys(rows[0])).toEqual(['ก', 'ข']);
  });
});
