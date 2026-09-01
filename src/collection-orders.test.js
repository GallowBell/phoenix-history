import { describe, it, expect } from 'vitest';
import { parseArgs, report, strip, collectSeries } from './collection-orders.js';
import { DELIVERED_STATUS, CANCELLED_STATUS, STATUS_KEY } from './orders-total.js';

const item = (name) => ({ name, sku: 'S1', price: '฿100.00', quantity: '1', subtotal: '฿100.00' });
const order = (names, status = DELIVERED_STATUS) => ({
  'หมายเลขคำสั่งซื้อ': '000100001',
  [STATUS_KEY]: status,
  items: names.map(item),
});
const owning = (title, vols) => order(vols.map((v) => `(LN) ${title} เล่ม ${v}`));

describe('collection parseArgs', () => {
  it('defaults to the top 10 and no complete-series listing', () => {
    expect(parseArgs([])).toEqual({ top: 10, all: false });
  });

  it('reads --top N', () => {
    expect(parseArgs(['--top', '3']).top).toBe(3);
  });

  it('ignores a --top that is not a positive number', () => {
    expect(parseArgs(['--top', 'nope']).top).toBe(10);
    expect(parseArgs(['--top', '-2']).top).toBe(10);
  });

  it('--all uncaps the list and adds the complete series', () => {
    expect(parseArgs(['--all'])).toEqual({ top: Infinity, all: true });
  });
});

describe('collection strip', () => {
  it('draws owned volumes filled and missing ones hollow', () => {
    const [series] = collectSeries([owning('ชายแปด', [1, 2, 4])]);
    expect(strip(series)).toBe('▪▪▫▪');
  });

  it('drops the strip when the run is too long to read', () => {
    const [series] = collectSeries([owning('ยาว', [1, 60])]);
    expect(strip(series)).toBe('');
  });
});

describe('collection report', () => {
  const withGap = [owning('ชายแปด', [1, 2, 4])];

  it('leads with the totals', () => {
    const text = report(withGap);
    expect(text).toMatch(/Series\s+1/);
    expect(text).toMatch(/Volumes owned\s+3/);
    expect(text).toMatch(/Series with gaps\s+1\s+\(1 volume\(s\) missing\)/);
  });

  it('names the series and the volumes it is missing', () => {
    const text = report(withGap);
    expect(text).toContain('ชายแปด');
    expect(text).toContain('missing: 3');
    expect(text).toContain('owned 3 of 4');
    expect(text).toContain('▪▪▫▪');
  });

  it('says so plainly when nothing is missing', () => {
    expect(report([owning('ชายแปด', [1, 2, 3])])).toMatch(/No gaps/);
  });

  it('caps the list at --top and says what it hid', () => {
    const many = [owning('หนึ่ง', [1, 3]), owning('สอง', [1, 3]), owning('สาม', [1, 3])];
    const text = report(many, { top: 2 });
    expect(text).toContain('Missing volumes (2 of 3)');
  });

  it('lists series that start above volume 1 apart from the gaps, with the reason', () => {
    const text = report([owning('หลาน', [3, 4])]);
    expect(text).toContain('Starts above volume 1 (1)');
    expect(text).toMatch(/more likely bought elsewhere/i);
    expect(text).toContain('from vol 3');
    // It is a note, not a gap: nothing may be reported missing here.
    expect(text).toMatch(/Series with gaps\s+0/);
  });

  it('lists complete series only under --all', () => {
    const complete = [owning('ชายแปด', [1, 2, 3])];
    expect(report(complete, { all: false })).not.toContain('Complete series');
    expect(report(complete, { all: true, top: Infinity })).toContain('Complete series (1)');
  });

  it('accounts for items with no volume number rather than hiding them', () => {
    const text = report([order(['(LN) ชายแปด เล่ม 1', '(LN) ชายแปด เล่ม 3', '(LN) เล่มเดียวจบ'])]);
    expect(text).toMatch(/1 item\(s\) carry no เล่ม number/);
  });

  it('always states that a gap may just be a volume bought elsewhere', () => {
    // The report cannot see purchases made anywhere else, and saying so is
    // the difference between a useful list and a wrong one.
    expect(report(withGap)).toMatch(/bought elsewhere/);
    expect(report([])).toMatch(/bought elsewhere/);
  });

  it('does not let a cancelled order fill a gap', () => {
    const text = report([owning('ชายแปด', [1, 3]), order(['(LN) ชายแปด เล่ม 2'], CANCELLED_STATUS)]);
    expect(text).toContain('missing: 2');
  });

  it('renders with no data at all', () => {
    expect(() => report([])).not.toThrow();
    expect(report([])).toMatch(/Series\s+0/);
  });
});
