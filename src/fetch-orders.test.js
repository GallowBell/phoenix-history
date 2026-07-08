import { describe, it, expect } from 'vitest';
import { buildUrl } from './fetch-orders.js';
import config from './orders-config.js';

describe('fetch-orders buildUrl', () => {
  it('returns the base config URL for page 1', () => {
    expect(buildUrl(1)).toBe(config.url);
  });

  it('appends the page query param for page > 1', () => {
    expect(buildUrl(2)).toBe(`${config.url}&p=2`);
    expect(buildUrl(5)).toBe(`${config.url}&p=5`);
  });
});
