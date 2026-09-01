import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  getDetailUrl,
  extractOrderId,
  isCacheable,
  mapPool,
  createOrderedLog,
  refusesEmptyOverwrite,
  parseOrderItems,
} from './fetch-order-details.js';

describe('fetch-order-details getDetailUrl', () => {
  it('finds the detail URL among order object values', () => {
    const order = {
      หมายเลขคำสั่งซื้อ: '000100001',
      ดูรายละเอียด: 'https://www.phoenixnext.com/sales/order/view/order_id/100001/',
    };
    expect(getDetailUrl(order)).toBe('https://www.phoenixnext.com/sales/order/view/order_id/100001/');
  });

  it('returns null when no value contains a detail URL', () => {
    const order = { หมายเลขคำสั่งซื้อ: '000100001', ราคาสุทธิ: '฿100.00' };
    expect(getDetailUrl(order)).toBeNull();
  });
});

describe('fetch-order-details extractOrderId', () => {
  it('extracts the numeric order id from a detail URL', () => {
    expect(extractOrderId('https://www.phoenixnext.com/sales/order/view/order_id/100001/')).toBe('100001');
  });

  it('returns null when the URL has no order_id segment', () => {
    expect(extractOrderId('https://www.phoenixnext.com/sales/order/view/')).toBeNull();
  });
});

describe('fetch-order-details isCacheable', () => {
  const shipped = { 'หมายเลขคำสั่งซื้อ': '000100001', 'สถานะ': 'จัดส่งแล้ว' };
  const cachedOk = { ...shipped, orderId: '100001', items: [{ sku: 'A-1' }] };

  it('reuses a finished order whose status is unchanged', () => {
    expect(isCacheable(cachedOk, shipped)).toBe(true);
  });

  it('reuses a cancelled order', () => {
    const cancelled = { 'หมายเลขคำสั่งซื้อ': '000100002', 'สถานะ': 'ออร์เดอร์ยกเลิก' };
    expect(isCacheable({ ...cancelled, items: [{ sku: 'B-1' }] }, cancelled)).toBe(true);
  });

  it('re-fetches when there is no cached record', () => {
    expect(isCacheable(undefined, shipped)).toBe(false);
  });

  it('re-fetches an order that is still in progress', () => {
    const preparing = { 'หมายเลขคำสั่งซื้อ': '000100003', 'สถานะ': 'กำลังเตรียมสินค้า' };
    expect(isCacheable({ ...preparing, items: [{ sku: 'C-1' }] }, preparing)).toBe(false);
  });

  it('re-fetches when an unrecognised status is seen', () => {
    const unknown = { 'หมายเลขคำสั่งซื้อ': '000100004', 'สถานะ': 'สถานะใหม่' };
    expect(isCacheable({ ...unknown, items: [{ sku: 'D-1' }] }, unknown)).toBe(false);
  });

  it('re-fetches when the status changed since the cache was written', () => {
    const nowShipped = { ...shipped, 'สถานะ': 'จัดส่งแล้ว' };
    const wasPreparing = { ...cachedOk, 'สถานะ': 'กำลังเตรียมสินค้า' };
    expect(isCacheable(wasPreparing, nowShipped)).toBe(false);
  });

  it('re-fetches when the cached run recorded an error', () => {
    expect(isCacheable({ ...cachedOk, error: 'boom' }, shipped)).toBe(false);
  });

  it('re-fetches when the cached run produced no items', () => {
    expect(isCacheable({ ...cachedOk, items: [] }, shipped)).toBe(false);
  });
});

describe('fetch-order-details mapPool', () => {
  it('preserves input order regardless of completion order', async () => {
    const delays = [40, 5, 25, 0, 15];
    const out = await mapPool(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([...Array(20).keys()], 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
  });

  it('handles an empty list without hanging', async () => {
    await expect(mapPool([], 4, async () => 1)).resolves.toEqual([]);
  });
});

describe('createOrderedLog', () => {
  it('holds a later index until the earlier ones have printed', () => {
    const out = [];
    const report = createOrderedLog();

    report(2, () => out.push('third'));
    expect(out).toEqual([]); // 0 and 1 are still outstanding

    report(1, () => out.push('second'));
    expect(out).toEqual([]); // still waiting on 0

    report(0, () => out.push('first'));
    expect(out).toEqual(['first', 'second', 'third']);
  });

  it('prints immediately when indexes arrive in order', () => {
    const out = [];
    const report = createOrderedLog();
    report(0, () => out.push('a'));
    expect(out).toEqual(['a']);
    report(1, () => out.push('b'));
    expect(out).toEqual(['a', 'b']);
  });

  it('releases the queue behind a silent index', () => {
    const out = [];
    const report = createOrderedLog();
    report(1, () => out.push('second'));
    report(0, null); // a cached order prints nothing but must not stall the run
    expect(out).toEqual(['second']);
  });

  it('stays ordered under a shuffled completion sequence', () => {
    const out = [];
    const report = createOrderedLog();
    const order = [3, 7, 0, 2, 9, 1, 8, 5, 4, 6];
    for (const i of order) report(i, () => out.push(i));
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps each report independent', () => {
    const a = [];
    const b = [];
    const reportA = createOrderedLog();
    const reportB = createOrderedLog();
    reportA(0, () => a.push('a0'));
    reportB(1, () => b.push('b1'));
    expect(a).toEqual(['a0']);
    expect(b).toEqual([]);
  });
});

describe('refusesEmptyOverwrite (details)', () => {
  const withItems = (n) => ({ items: Array.from({ length: n }, (_, i) => ({ sku: `S${i}` })) });
  const cacheOf = (...records) => new Map(records.map((r, i) => [String(i), r]));

  it('refuses when every order came back empty but the file had items', () => {
    const results = [withItems(0), withItems(0)];
    expect(refusesEmptyOverwrite(results, cacheOf(withItems(2), withItems(1)))).toBe(true);
  });

  it('allows the write when even one order produced items', () => {
    const results = [withItems(0), withItems(1)];
    expect(refusesEmptyOverwrite(results, cacheOf(withItems(2)))).toBe(false);
  });

  it('allows a first run, when there is nothing on disk to lose', () => {
    expect(refusesEmptyOverwrite([withItems(0)], new Map())).toBe(false);
  });

  it('allows an all-empty run over an all-empty file', () => {
    expect(refusesEmptyOverwrite([withItems(0)], cacheOf(withItems(0)))).toBe(false);
  });

  it('tolerates records with no items key at all', () => {
    expect(refusesEmptyOverwrite([{}], cacheOf({}))).toBe(false);
    expect(refusesEmptyOverwrite([{}], cacheOf(withItems(1)))).toBe(true);
  });
});

/**
 * Runs the item selectors against saved markup — see the note on
 * `parseOrdersPage` in fetch-orders.test.js for what this fixture is and is
 * not. Everything the parser reads here is positional inside `.parent-item`,
 * so these tests are mostly about position: the right span, the right index.
 */
describe('parseOrderItems', () => {
  const html = readFileSync('tests/fixtures/order-detail-page.html', 'utf8');

  it('returns one record per .parent-item with the full item shape', () => {
    const items = parseOrderItems(html);
    expect(items).toHaveLength(2);
    expect(Object.keys(items[0])).toEqual(['name', 'sku', 'price', 'quantity', 'subtotal']);
  });

  it('reads the product name from the direct-child span, not the SKU label', () => {
    // The SKU label is also .font-semibold; only the `>` in the selector
    // keeps 'SKU:' out of the name, and the name is what product-name.js
    // parses every facet from.
    const items = parseOrderItems(html);
    expect(items[0].name).toBe(
      '(PRE/SEP)(LN) Complete Set ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน ปี 3 เล่ม 2'
    );
    expect(items[0].name).not.toMatch(/SKU/);
  });

  it('takes the SKU value and skips its label', () => {
    expect(parseOrderItems(html).map((i) => i.sku)).toEqual(['BX0948-01', 'LN0832-01P']);
  });

  it('reads unit price and subtotal from separate cells, in that order', () => {
    // Item 2 is quantity 2, so a parser reading the wrong price span would
    // report ฿780 as the subtotal and silently understate every total.
    const [, second] = parseOrderItems(html);
    expect(second.quantity).toBe('2');
    expect(second.price).toBe('฿780.00');
    expect(second.subtotal).toBe('฿1,560.00');
  });

  it('returns no items for a 200 login page', () => {
    // The details fetcher's empty-overwrite guard exists for exactly this.
    expect(parseOrderItems(readFileSync('tests/fixtures/login-page.html', 'utf8'))).toEqual([]);
  });
});

/**
 * Selector rules, pinned with minimal synthetic markup — statements about the
 * parser rather than claims about the live page. Each guards a restriction
 * that a tidying refactor would plausibly drop.
 */
describe('parseOrderItems selector rules', () => {
  const row = (infoCol, tail) => `
    <div class="parent-item"><div class="lg:grid grid-cols-5">
      <div class="p-2 col-span-2">${infoCol}</div>${tail}
    </div></div>`;

  it('does not mistake the SKU label for the product name when no name span is present', () => {
    // The name is read as a DIRECT child span; the SKU label is also
    // .font-semibold but sits deeper. Dropping the `>` would name this item
    // "SKU:" and every product-name facet would be derived from it.
    const items = parseOrderItems(
      row('<div class="item-options"><div class="text-sm flex"><span class="font-semibold">SKU:</span><span>LN0001-01</span></div></div>', '')
    );
    expect(items[0].name).toBe('');
    expect(items[0].sku).toBe('LN0001-01');
  });

  it('reads quantity only from a span carrying both classes, not any .content span', () => {
    // A bare .content span appears as a mobile label; matching it would put
    // the label text where a number belongs.
    const items = parseOrderItems(
      row('<span class="font-semibold">ชื่อ</span>', '<div class="p-2"><span class="content">จำนวน</span><span class="content font-semibold">3</span></div>')
    );
    expect(items[0].quantity).toBe('3');
  });

  it('reads only prices inside .price-including-tax, ignoring other .price spans', () => {
    // The scope is deliberate: a bare .price elsewhere in the row (a strike-
    // through list price, a per-unit note) would otherwise be read as money
    // and land in the totals.
    const items = parseOrderItems(
      row(
        '<span class="font-semibold">ชื่อ</span>',
        '<div class="p-2"><span class="price">฿999.00</span>' +
          '<span class="price-including-tax"><span class="price">฿100.00</span></span>' +
          '<span class="price-including-tax"><span class="price">฿200.00</span></span></div>'
      )
    );
    expect(items[0].price).toBe('฿100.00');
    expect(items[0].subtotal).toBe('฿200.00');
  });

  it('leaves prices empty rather than guessing when the price cells are absent', () => {
    const items = parseOrderItems(row('<span class="font-semibold">ชื่อ</span>', ''));
    expect(items[0]).toMatchObject({ name: 'ชื่อ', price: '', subtotal: '', quantity: '' });
  });
});
