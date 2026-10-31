import { describe, it, expect } from 'vitest';
import { searchOrders, collectionReport, COLLECTION_CAVEAT } from './mcp-tools.js';
import { CANCELLED_STATUS, DELIVERED_STATUS } from './orders-total.js';

const SERIES = '(LN) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน ปี 2';

const details = [
  {
    'หมายเลขคำสั่งซื้อ': '000434985',
    'วันที่ซื้อ': '29/8/26 29 สิงหาคม 2026',
    'ราคาสุทธิ': '฿1,800.00',
    'โค้ดส่วนลด': '10LEVEL999',
    'สถานะ': DELIVERED_STATUS,
    orderId: '457973',
    items: [
      { name: `${SERIES} เล่ม 1`, sku: 'BX0948-01', price: '฿900.00', quantity: '1', subtotal: '฿900.00' },
      { name: `${SERIES} เล่ม 3`, sku: 'BX0948-03', price: '฿900.00', quantity: '1', subtotal: '฿900.00' },
    ],
  },
  {
    'หมายเลขคำสั่งซื้อ': '000300001',
    'วันที่ซื้อ': '1/2/25 1 กุมภาพันธ์ 2025',
    'ราคาสุทธิ': '฿300.00',
    'โค้ดส่วนลด': '-',
    'สถานะ': CANCELLED_STATUS,
    orderId: '300001',
    items: [
      { name: '(LN) แมจิคัล★เอกซ์พลอเรอร์ เล่ม 2', sku: 'LN0001-02', price: '฿300.00', quantity: '1', subtotal: '฿300.00' },
    ],
  },
];

describe('searchOrders', () => {
  it('returns only the matching items for a name search', () => {
    const r = searchOrders(details, { query: 'เล่ม 3' });
    expect(r.total).toBe(1);
    expect(r.orders[0].items.map((i) => i.name)).toEqual([expect.stringContaining('เล่ม 3')]);
    expect(r.orders[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the whole order for an order-number or id search', () => {
    expect(searchOrders(details, { query: '000434985', field: 'order' }).orders[0].items).toHaveLength(2);
    expect(searchOrders(details, { query: '457973', field: 'id' }).total).toBe(1);
  });

  it('flags cancelled orders instead of hiding them', () => {
    expect(searchOrders(details, { query: 'แมจิคัล' }).orders[0].cancelled).toBe(true);
  });

  it('refuses an empty query', () => {
    expect(() => searchOrders(details, { query: '  ' })).toThrow('query must not be empty');
  });

  it('caps results and says how many there were', () => {
    const r = searchOrders(details, { query: '(LN)', limit: 1 });
    expect(r).toMatchObject({ total: 2, shown: 1 });
    expect(r.orders).toHaveLength(1);
  });
});

describe('collectionReport', () => {
  it('matches a series typed loosely', () => {
    for (const q of ['ปีสอง', 'ยอดคน ปี 2', 'ยอดคนปี2']) {
      expect(collectionReport(details, { series: q }).series[0]).toMatchObject({ volumes: [1, 3], missing: [2] });
    }
  });

  it('ignores cancelled orders in the collection', () => {
    expect(collectionReport(details, { series: 'แมจิคัล☆' }).series).toEqual([]);
  });

  it('lists every series with a summary when no series is given', () => {
    const r = collectionReport(details);
    expect(r.summary.series).toBe(1);
    expect(r.caveat).toBe(COLLECTION_CAVEAT);
  });

  it('hints when nothing matched', () => {
    expect(collectionReport(details, { series: 'nope' }).hint).toContain('Call collection with no series');
  });
});
