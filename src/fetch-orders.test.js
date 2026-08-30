import { describe, it, expect } from 'vitest';
import {
  buildUrl,
  refusesEmptyOverwrite,
  countExisting,
  pendingNumbers,
  canStopEarly,
  mergeOrders,
  loadExisting,
} from './fetch-orders.js';
import { DELIVERED_STATUS, CANCELLED_STATUS } from './orders-total.js';
import { writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
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

describe('refusesEmptyOverwrite', () => {
  it('refuses when a scrape returns nothing but the file already has orders', () => {
    expect(refusesEmptyOverwrite(0, 103)).toBe(true);
  });

  it('allows a genuinely empty first run', () => {
    expect(refusesEmptyOverwrite(0, 0)).toBe(false);
  });

  it('allows any non-empty scrape, including a shrinking one', () => {
    expect(refusesEmptyOverwrite(103, 103)).toBe(false);
    expect(refusesEmptyOverwrite(1, 103)).toBe(false);
  });
});

describe('countExisting', () => {
  it('counts the orders in an existing file', async () => {
    const p = join(tmpdir(), `orders-count-${Date.now()}.json`);
    await writeFile(p, JSON.stringify([{ a: 1 }, { a: 2 }]), 'utf-8');
    expect(await countExisting(p)).toBe(2);
    await rm(p, { force: true });
  });

  it('reports 0 for a missing file, so a first run is never blocked', async () => {
    expect(await countExisting(join(tmpdir(), 'does-not-exist-orders.json'))).toBe(0);
  });

  it('reports 0 for unreadable JSON rather than throwing', async () => {
    const p = join(tmpdir(), `orders-bad-${Date.now()}.json`);
    await writeFile(p, 'not json', 'utf-8');
    expect(await countExisting(p)).toBe(0);
    await rm(p, { force: true });
  });
});

describe('incremental scraping', () => {
  const order = (number, status = DELIVERED_STATUS) => ({
    'หมายเลขคำสั่งซื้อ': number,
    'สถานะ': status,
  });
  const PENDING = 'กำลังเตรียมสินค้า';

  describe('pendingNumbers', () => {
    it('collects only the orders whose status can still change', () => {
      const out = pendingNumbers([
        order('1'), order('2', PENDING), order('3', CANCELLED_STATUS), order('4', PENDING),
      ]);
      expect([...out].sort()).toEqual(['2', '4']);
    });

    it('treats an unrecognised status as still moving', () => {
      expect(pendingNumbers([order('1', 'สถานะใหม่')]).has('1')).toBe(true);
    });

    it('handles an empty or missing list', () => {
      expect(pendingNumbers([]).size).toBe(0);
      expect(pendingNumbers(undefined).size).toBe(0);
    });
  });

  describe('canStopEarly', () => {
    const known = new Set(['1', '2']);

    it('stops when the page is all known and nothing is pending', () => {
      expect(canStopEarly([order('1'), order('2')], known, new Set())).toBe(true);
    });

    it('stops at the first known order, even beside new ones', () => {
      // Newest-first and append-only: a familiar order means everything below
      // is already on disk, so the rest of the page does not have to be known.
      expect(canStopEarly([order('99'), order('1')], known, new Set())).toBe(true);
    });

    it('keeps going while the whole page is new', () => {
      expect(canStopEarly([order('98'), order('99')], known, new Set())).toBe(false);
    });

    it('keeps going while a pending order has not been re-read', () => {
      // This is the case that makes a plain "stop at the first familiar order"
      // wrong: order 2 is known, but its status is still moving.
      expect(canStopEarly([order('1')], known, new Set(['2']))).toBe(false);
    });

    it('never stops early on a first run, when nothing is known', () => {
      expect(canStopEarly([order('1')], new Set(), new Set())).toBe(false);
    });
  });

  describe('mergeOrders', () => {
    it('keeps orders that were not re-read', () => {
      const merged = mergeOrders([order('3'), order('2')], [order('2'), order('1')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['3', '2', '1']);
    });

    it('lets a re-read order replace its stored copy, so a status change lands', () => {
      const merged = mergeOrders([order('1', DELIVERED_STATUS)], [order('1', PENDING)]);
      expect(merged).toHaveLength(1);
      expect(merged[0]['สถานะ']).toBe(DELIVERED_STATUS);
    });

    it('preserves newest-first order across the join', () => {
      const merged = mergeOrders([order('9'), order('8')], [order('8'), order('7'), order('6')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['9', '8', '7', '6']);
    });

    it('returns the scrape unchanged when there is nothing on disk', () => {
      expect(mergeOrders([order('1')], [])).toHaveLength(1);
      expect(mergeOrders([order('1')], undefined)).toHaveLength(1);
    });

    it('drops a row the scrape saw twice', () => {
      // An order placed mid-scrape shifts every later row down one, so the
      // same order can come back on the next page.
      const merged = mergeOrders([order('3'), order('2'), order('2'), order('1')], [order('1')]);
      expect(merged.map((o) => o['หมายเลขคำสั่งซื้อ'])).toEqual(['3', '2', '1']);
    });

    it('keeps the newest copy of a duplicated order', () => {
      const merged = mergeOrders([order('1', PENDING), order('1', DELIVERED_STATUS)], []);
      expect(merged).toHaveLength(1);
      expect(merged[0]['สถานะ']).toBe(PENDING);
    });

    it('can only grow the list, never shrink it', () => {
      const existing = [order('3'), order('2'), order('1')];
      expect(mergeOrders([], existing)).toHaveLength(3);
      expect(mergeOrders([order('4')], existing)).toHaveLength(4);
    });
  });

  describe('loadExisting', () => {
    it('returns [] for a missing file or no path', async () => {
      expect(await loadExisting('/nope/does-not-exist.json')).toEqual([]);
      expect(await loadExisting(null)).toEqual([]);
    });
  });
});
