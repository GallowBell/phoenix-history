import { describe, it, expect } from 'vitest';
import { getDetailUrl, extractOrderId } from './fetch-order-details.js';

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
