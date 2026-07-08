import { describe, it, expect } from 'vitest';
import { parsePrice } from './sum-orders.js';

describe('sum-orders parsePrice', () => {
  it('parses a comma-separated Thai baht price', () => {
    expect(parsePrice('฿1,234.56')).toBe(1234.56);
  });

  it('parses a simple price without commas', () => {
    expect(parsePrice('฿500.00')).toBe(500);
  });

  it('returns null for a dash placeholder', () => {
    expect(parsePrice('-')).toBeNull();
  });

  it('returns null for empty/falsy input', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(parsePrice('not-a-price')).toBeNull();
  });
});
