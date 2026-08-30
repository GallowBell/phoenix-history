import { describe, it, expect } from 'vitest';
import {
  parsePrice,
  isCancelled,
  summarise,
  formatBaht,
  PRICE_KEY,
  STATUS_KEY,
  CANCELLED_STATUS,
} from './orders-total.js';

const order = (price, status = 'จัดส่งแล้ว') => ({ [PRICE_KEY]: price, [STATUS_KEY]: status });
const cancelled = (price) => order(price, CANCELLED_STATUS);

describe('parsePrice', () => {
  it('parses a Thai baht price with separators', () => {
    expect(parsePrice('฿1,234.56')).toBe(1234.56);
  });

  it('returns null for a missing or placeholder price', () => {
    expect(parsePrice(undefined)).toBe(null);
    expect(parsePrice('')).toBe(null);
    expect(parsePrice('-')).toBe(null);
    expect(parsePrice('฿')).toBe(null);
  });

  it('distinguishes a real zero from a missing price', () => {
    expect(parsePrice('฿0.00')).toBe(0);
    expect(parsePrice(0)).toBe(0);
  });

  it('accepts a number as well as a string', () => {
    expect(parsePrice(99.5)).toBe(99.5);
  });
});

describe('isCancelled', () => {
  it('recognises the cancelled status', () => {
    expect(isCancelled(cancelled('฿1'))).toBe(true);
  });

  it('is false for other statuses and for junk', () => {
    expect(isCancelled(order('฿1'))).toBe(false);
    expect(isCancelled(order('฿1', 'กำลังเตรียมสินค้า'))).toBe(false);
    expect(isCancelled(undefined)).toBe(false);
  });
});

describe('summarise', () => {
  it('excludes cancelled orders from what was spent', () => {
    const s = summarise([order('฿100'), cancelled('฿30'), order('฿20')]);
    expect(s.spent).toBe(120);
  });

  it('reports the cancelled money instead of discarding it', () => {
    const s = summarise([order('฿100'), cancelled('฿30')]);
    expect(s.cancelledCount).toBe(1);
    expect(s.cancelledAmount).toBe(30);
  });

  it('gross is spent plus cancelled — the figure the UI used to show', () => {
    const s = summarise([order('฿100'), cancelled('฿30')]);
    expect(s.gross).toBe(130);
    expect(s.gross).toBe(s.spent + s.cancelledAmount);
  });

  it('counts unparsable prices rather than silently shrinking the total', () => {
    const s = summarise([order('฿100'), order('-'), order(undefined)]);
    expect(s.spent).toBe(100);
    expect(s.noPrice).toBe(2);
  });

  it('handles an empty list', () => {
    expect(summarise([])).toEqual({
      count: 0, spent: 0, cancelledCount: 0, cancelledAmount: 0, gross: 0, noPrice: 0,
    });
  });

  it('defaults to an empty list when called with nothing', () => {
    expect(summarise().count).toBe(0);
  });

  it('counts every order, including ones with no price', () => {
    expect(summarise([order('฿1'), order('-'), cancelled('฿2')]).count).toBe(3);
  });
});

describe('formatBaht', () => {
  it('always shows two decimals with separators', () => {
    expect(formatBaht(1234.5)).toBe('฿1,234.50');
    expect(formatBaht(0)).toBe('฿0.00');
  });

  it('round-trips through parsePrice', () => {
    expect(parsePrice(formatBaht(157191))).toBe(157191);
  });
});
