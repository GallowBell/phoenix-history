import { describe, it, expect } from 'vitest';
import {
  parseOrderDate, monthKey, formatMonth, fillMonths,
  groupSpend, seriesSpend, discountCodes, priceGap, bar, parseArgs, report,
} from './stats-orders.js';
import { CANCELLED_STATUS, DELIVERED_STATUS } from './orders-total.js';

const order = (date, price, status = DELIVERED_STATUS, code = '-') => ({
  'วันที่ซื้อ': date,
  'ราคาสุทธิ': price,
  'สถานะ': status,
  'โค้ดส่วนลด': code,
});

describe('parseOrderDate', () => {
  it('reads the d/m/yy prefix and ignores the Thai long form', () => {
    expect(parseOrderDate('29/8/26 29 สิงหาคม 2026')).toEqual({ year: 2026, month: 8, day: 29 });
    expect(parseOrderDate('2/1/19 2 มกราคม 2019')).toEqual({ year: 2019, month: 1, day: 2 });
  });

  it('is day-first, not month-first', () => {
    // 29 cannot be a month, which is what settles the ordering on this data.
    expect(parseOrderDate('29/8/26 …').month).toBe(8);
  });

  it('returns null for junk rather than a wrong date', () => {
    for (const bad of [undefined, null, '', 'not a date', '13 สิงหาคม']) {
      expect(parseOrderDate(bad)).toBe(null);
    }
    expect(parseOrderDate('29/13/26')).toBe(null); // month out of range
    expect(parseOrderDate('0/8/26')).toBe(null);   // day out of range
  });
});

describe('monthKey / formatMonth', () => {
  it('zero-pads so keys sort lexically', () => {
    expect(monthKey({ year: 2026, month: 8 })).toBe('2026-08');
    expect(['2026-10', '2026-08', '2026-09'].sort()).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('renders a readable label', () => {
    expect(formatMonth('2026-08')).toBe('Aug 2026');
    expect(formatMonth('2019-01')).toBe('Jan 2019');
  });

  it('is null-safe', () => {
    expect(monthKey(null)).toBe(null);
  });
});

describe('groupSpend', () => {
  const orders = [
    order('1/1/25 …', '฿100.00'),
    order('2/1/25 …', '฿50.00'),
    order('1/2/25 …', '฿25.00'),
    order('5/2/25 …', '฿999.00', CANCELLED_STATUS),
    order('bad date', '฿10.00'),
  ];

  it('sums by period and counts orders', () => {
    expect(groupSpend(orders, monthKey)).toEqual([
      { key: '2025-01', spent: 150, orders: 2 },
      { key: '2025-02', spent: 25, orders: 1 },
    ]);
  });

  it('excludes cancelled orders, matching npm run sum', () => {
    const spent = groupSpend(orders, monthKey).reduce((a, g) => a + g.spent, 0);
    expect(spent).toBe(175); // the ฿999 cancelled order is not in it
  });

  it('drops rows whose date cannot be read instead of bucketing them wrongly', () => {
    expect(groupSpend(orders, monthKey).some((g) => g.key == null)).toBe(false);
  });

  it('groups by year through the same helper', () => {
    expect(groupSpend(orders, (d) => (d ? String(d.year) : null)))
      .toEqual([{ key: '2025', spent: 175, orders: 3 }]);
  });

  it('handles no orders', () => {
    expect(groupSpend([], monthKey)).toEqual([]);
    expect(groupSpend(undefined, monthKey)).toEqual([]);
  });
});

describe('fillMonths', () => {
  it('inserts the quiet months as explicit zeroes', () => {
    const filled = fillMonths([
      { key: '2025-11', spent: 10, orders: 1 },
      { key: '2026-02', spent: 20, orders: 1 },
    ]);
    expect(filled.map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(filled[1]).toEqual({ key: '2025-12', spent: 0, orders: 0 });
  });

  it('rolls the year over correctly', () => {
    const filled = fillMonths([
      { key: '2025-12', spent: 1, orders: 1 },
      { key: '2026-01', spent: 1, orders: 1 },
    ]);
    expect(filled.map((m) => m.key)).toEqual(['2025-12', '2026-01']);
  });

  it('does not depend on the input being sorted', () => {
    // Reading the range off rows[0]/rows.at(-1) gives a backwards span here,
    // which silently dropped every row.
    const filled = fillMonths([
      { key: '2026-02', spent: 20, orders: 1 },
      { key: '2025-12', spent: 10, orders: 1 },
    ]);
    expect(filled.map((m) => m.key)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('leaves a single month or an empty list alone', () => {
    expect(fillMonths([])).toEqual([]);
    expect(fillMonths([{ key: '2026-01', spent: 1, orders: 1 }])).toHaveLength(1);
  });
});

describe('seriesSpend', () => {
  const details = [
    { 'สถานะ': DELIVERED_STATUS, items: [
      { name: '(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9', subtotal: '฿100.00', quantity: 1 },
      { name: '(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10', subtotal: '฿200.00', quantity: 2 },
    ] },
    { 'สถานะ': DELIVERED_STATUS, items: [
      { name: '(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12', subtotal: '฿50.00', quantity: 1 },
    ] },
    { 'สถานะ': CANCELLED_STATUS, items: [
      { name: '(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 11', subtotal: '฿9999.00', quantity: 1 },
    ] },
  ];

  it('collapses volumes into one series and sorts by spend', () => {
    const out = seriesSpend(details);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: 'แง้มหัวใจยัยน้องสาวจำเป็น', listed: 300, items: 3 });
  });

  it('excludes items from cancelled orders', () => {
    expect(seriesSpend(details)[0].listed).toBe(300); // not 10299
  });

  it('handles missing items and empty input', () => {
    expect(seriesSpend([{ 'สถานะ': DELIVERED_STATUS }])).toEqual([]);
    expect(seriesSpend(undefined)).toEqual([]);
  });
});

describe('discountCodes', () => {
  it('ignores the "-" placeholder and cancelled orders', () => {
    const out = discountCodes([
      order('1/1/25', '฿100.00', DELIVERED_STATUS, 'LV999'),
      order('2/1/25', '฿50.00', DELIVERED_STATUS, 'LV999'),
      order('3/1/25', '฿10.00', DELIVERED_STATUS, '-'),
      order('4/1/25', '฿10.00', DELIVERED_STATUS, ''),
      order('5/1/25', '฿999.00', CANCELLED_STATUS, 'LV999'),
    ]);
    expect(out).toEqual([{ code: 'LV999', orders: 2, spent: 150 }]);
  });
});

describe('priceGap', () => {
  const detail = (net, subtotals, status = DELIVERED_STATUS) => ({
    'ราคาสุทธิ': net,
    'สถานะ': status,
    items: subtotals.map((s) => ({ subtotal: s })),
  });

  it('reports a discount when the items list for more than was paid', () => {
    const g = priceGap([detail('฿800.00', ['฿1,000.00'])]);
    expect(g).toMatchObject({ listed: 1000, paid: 800, discount: 200, discountOrders: 1, surcharge: 0 });
  });

  it('reports a delivery fee separately instead of netting it off', () => {
    // Real shape: older small orders paid a flat ฿35 over the item price.
    const g = priceGap([detail('฿330.00', ['฿295.00']), detail('฿800.00', ['฿1,000.00'])]);
    expect(g.discount).toBe(200);
    expect(g.surcharge).toBe(35);
    expect(g.discountOrders).toBe(1);
    expect(g.surchargeOrders).toBe(1);
  });

  it('skips orders with no priced items rather than calling them 100% off', () => {
    const g = priceGap([detail('฿500.00', []), detail('฿500.00', ['฿0.00'])]);
    expect(g.skipped).toBe(2);
    expect(g.discount).toBe(0);
    expect(g.listed).toBe(0);
  });

  it('excludes cancelled orders', () => {
    const g = priceGap([detail('฿800.00', ['฿1,000.00'], CANCELLED_STATUS)]);
    expect(g).toMatchObject({ listed: 0, paid: 0, discount: 0 });
  });

  it('keeps listed - paid equal to discount - surcharge', () => {
    const g = priceGap([detail('฿330.00', ['฿295.00']), detail('฿800.00', ['฿1,000.00'])]);
    expect(g.listed - g.paid).toBeCloseTo(g.discount - g.surcharge, 6);
  });
});

describe('bar', () => {
  it('scales to the maximum and never vanishes for a nonzero value', () => {
    expect(bar(10, 10, 10)).toBe('█'.repeat(10));
    expect(bar(5, 10, 10)).toBe('█'.repeat(5));
    expect(bar(0.01, 1000, 10)).toBe('█');
  });

  it('is empty for zero or a missing maximum', () => {
    expect(bar(0, 10)).toBe('');
    expect(bar(10, 0)).toBe('');
  });
});

describe('parseArgs', () => {
  it('defaults to a readable slice', () => {
    expect(parseArgs([])).toEqual({ top: 10, months: 12 });
  });

  it('reads --top and --months', () => {
    expect(parseArgs(['--top', '3', '--months', '6'])).toEqual({ top: 3, months: 6 });
  });

  it('ignores a missing or nonsense value instead of producing NaN', () => {
    expect(parseArgs(['--top'])).toEqual({ top: 10, months: 12 });
    expect(parseArgs(['--top', 'lots'])).toEqual({ top: 10, months: 12 });
    expect(parseArgs(['--top', '0'])).toEqual({ top: 10, months: 12 });
  });

  it('--all lifts both limits', () => {
    const o = parseArgs(['--all']);
    expect(o.top).toBe(Infinity);
    expect(o.months).toBe(Infinity);
  });
});

describe('report', () => {
  const orders = [
    order('1/1/25 …', '฿100.00', DELIVERED_STATUS, 'LV999'),
    order('1/2/25 …', '฿300.00'),
    order('1/3/25 …', '฿999.00', CANCELLED_STATUS),
  ];

  it('shows spend excluding cancelled, with cancelled noted beside it', () => {
    const out = report(orders, null);
    expect(out).toMatch(/Spent\s+฿400\.00/);
    expect(out).toMatch(/Cancelled\s+฿999\.00/);
  });

  it('says what to run when there are no details on disk', () => {
    expect(report(orders, null)).toMatch(/npm run order-details/);
    expect(report(orders, [])).toMatch(/npm run order-details/);
  });

  it('flags series figures as list prices, since a discount is order-level', () => {
    const out = report(orders, [
      { 'สถานะ': DELIVERED_STATUS, 'ราคาสุทธิ': '฿100.00',
        items: [{ name: '(LN) ก เล่ม 1', subtotal: '฿120.00', quantity: 1 }] },
    ]);
    expect(out).toMatch(/list price/i);
    expect(out).toMatch(/Discounts/);
  });

  it('does not crash on an empty order list', () => {
    expect(() => report([], null)).not.toThrow();
  });
});
