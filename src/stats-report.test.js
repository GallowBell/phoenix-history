import { describe, it, expect } from 'vitest';
import { yearKey, quarterKey, periodKeys, groupBooks, monthKey } from './stats-report.js';
import { CANCELLED_STATUS, DELIVERED_STATUS } from './orders-total.js';

describe('yearKey / quarterKey', () => {
  it('maps months onto calendar quarters', () => {
    expect(quarterKey({ year: 2026, month: 1 })).toBe('2026-Q1');
    expect(quarterKey({ year: 2026, month: 3 })).toBe('2026-Q1');
    expect(quarterKey({ year: 2026, month: 4 })).toBe('2026-Q2');
    expect(quarterKey({ year: 2026, month: 12 })).toBe('2026-Q4');
    expect(quarterKey(null)).toBe(null);
    expect(yearKey({ year: 2026, month: 5 })).toBe('2026');
  });
});

describe('periodKeys', () => {
  it('lists every period between two keys, across year ends', () => {
    expect(periodKeys('month', '2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(periodKeys('quarter', '2025-Q4', '2026-Q2')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(periodKeys('year', '2019', '2021')).toEqual(['2019', '2020', '2021']);
    expect(periodKeys('month', '2026-03', '2026-01')).toEqual([]);
  });
});

describe('groupBooks', () => {
  it('counts books by quantity, leaving out cancelled orders and free gifts', () => {
    const details = [
      { 'วันที่ซื้อ': '1/3/26 1 มีนาคม 2026', 'สถานะ': DELIVERED_STATUS, items: [
        { name: '(LN) Some Series เล่ม 1', quantity: '1' },
        { name: '(LN) Other Series เล่ม 4', quantity: '2' },
        { name: 'Free Gift - Bookmark', quantity: '1' },
      ] },
      { 'วันที่ซื้อ': '5/3/26 5 มีนาคม 2026', 'สถานะ': CANCELLED_STATUS, items: [{ name: '(LN) X เล่ม 1', quantity: '1' }] },
      { 'วันที่ซื้อ': 'not a date', 'สถานะ': DELIVERED_STATUS, items: [{ name: '(LN) Y เล่ม 1', quantity: '1' }] },
    ];
    expect(groupBooks(details, monthKey)).toEqual([{ key: '2026-03', books: 3 }]);
  });
});
