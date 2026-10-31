import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'url';
import { searchOrders, collectionReport, COLLECTION_CAVEAT, spendReport, createRefresh } from './mcp-tools.js';
import { createSyncJob } from './sync-job.js';
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

describe('spendReport', () => {
  const orders = [
    { 'วันที่ซื้อ': '2/3/26 2 มีนาคม 2026', 'ราคาสุทธิ': '฿100.10', 'สถานะ': DELIVERED_STATUS },
    { 'วันที่ซื้อ': '9/8/26 9 สิงหาคม 2026', 'ราคาสุทธิ': '฿200.20', 'สถานะ': DELIVERED_STATUS },
    { 'วันที่ซื้อ': '10/8/26 10 สิงหาคม 2026', 'ราคาสุทธิ': '฿300.00', 'สถานะ': CANCELLED_STATUS },
  ];
  const details = orders.map((o, i) => ({ ...o, items: [{ name: `(LN) Series ${i} เล่ม 1`, quantity: '1' }] }));
  const now = new Date(2026, 9, 31); // Oct 2026

  it('fills every month of the current year up to now', () => {
    const r = spendReport(orders, details, { by: 'month', year: 2026, now });
    expect(r.periods.map((p) => p.period)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    expect(r.periods[0]).toEqual({ period: '2026-01', spent: 0, orders: 0, books: 0 });
    expect(r.periods[2]).toEqual({ period: '2026-03', spent: 100.1, orders: 1, books: 1 });
  });

  it('returns twelve zero months for a year with no orders', () => {
    const r = spendReport(orders, details, { by: 'month', year: 2018, now });
    expect(r.periods).toHaveLength(12);
    expect(r.totals).toMatchObject({ spent: 0, orders: 0, books: 0 });
  });

  it('keeps quiet quarters as zero rows', () => {
    const r = spendReport(orders, details, { by: 'quarter', now });
    expect(r.periods.map((p) => [p.period, p.orders])).toEqual([['2026-Q1', 1], ['2026-Q2', 0], ['2026-Q3', 1]]);
  });

  it('reports cancelled money beside spent, never inside it', () => {
    expect(spendReport(orders, details, { by: 'year', now }).totals)
      .toMatchObject({ spent: 300.3, cancelledOrders: 1, cancelledAmount: 300 });
  });

  it('has no float drift', () => {
    expect(spendReport(orders, details, { by: 'year', now }).periods[0].spent).toBe(300.3); // 100.1 + 200.2 is 300.29999999999995 unrounded
  });
});

describe('createRefresh', () => {
  const SCRIPT = fileURLToPath(new URL('../tests/fixtures/fake-scrape.mjs', import.meta.url));
  // envFile: null keeps `--env-file` off the argv, so these never depend on .env.
  const makeJob = () => createSyncJob({ script: SCRIPT, envFile: null, commands: new Set(['ok', 'expired', 'fail']) });
  const counts = vi.fn(async () => ({ orders: 3, details: 3 }));
  const root = '/repo';

  it('runs both steps and reports counts', async () => {
    const r = await createRefresh({ job: makeJob(), counts, root, steps: ['ok', 'ok'] })();
    expect(r).toMatchObject({
      status: 'done',
      steps: [{ command: 'ok', status: 'done' }, { command: 'ok', status: 'done' }],
      before: { orders: 3 },
      after: { orders: 3 },
    });
    expect(r.output).toBeUndefined();
  });

  it('does not run the second step when the first fails', async () => {
    const r = await createRefresh({ job: makeJob(), counts, root, steps: ['fail', 'ok'] })();
    expect(r.status).toBe('failed');
    expect(r.steps).toHaveLength(1);
    expect(r.output).toContain('Error: something else broke');
  });

  it('tells the user how to renew an expired cookie', async () => {
    const r = await createRefresh({ job: makeJob(), counts, root, steps: ['ok', 'expired'] })();
    expect(r.status).toBe('expired');
    expect(r.message).toContain('Run `npm run orders` in a terminal in /repo');
  });

  it('joins a run already in flight instead of starting another', async () => {
    const refresh = createRefresh({ job: makeJob(), counts, root, steps: ['ok'] });
    const a = refresh();
    expect(refresh()).toBe(a);
    await a;
    const c = refresh();
    expect(c).not.toBe(a);
    await c;
  });

  it('streams progress lines', async () => {
    const lines = [];
    await createRefresh({ job: makeJob(), counts, root, steps: ['ok'] })({ onLine: (t) => lines.push(t) });
    expect(lines).toContain('Fetching page 1…');
  });
});
