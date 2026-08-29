import { describe, it, expect } from 'vitest';
import { getDetailUrl, extractOrderId, isCacheable, mapPool } from './fetch-order-details.js';

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
