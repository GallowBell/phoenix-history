import { describe, it, expect } from 'vitest';
import { getDetailUrl, extractOrderId, isCacheable, mapPool, createOrderedLog, refusesEmptyOverwrite } from './fetch-order-details.js';

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
