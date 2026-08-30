import { describe, it, expect } from 'vitest';
import { buildUrl, refusesEmptyOverwrite, countExisting } from './fetch-orders.js';
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
