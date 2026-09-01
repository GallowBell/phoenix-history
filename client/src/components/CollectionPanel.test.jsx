// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import CollectionPanel from './CollectionPanel.jsx';
import { DELIVERED_STATUS, CANCELLED_STATUS, STATUS_KEY } from '../../../src/orders-total.js';

afterEach(cleanup);

const item = (name) => ({ name, sku: 'S1', price: '฿100.00', quantity: '1', subtotal: '฿100.00' });
const order = (names, status = DELIVERED_STATUS) => ({
  'หมายเลขคำสั่งซื้อ': '000100001',
  [STATUS_KEY]: status,
  items: names.map(item),
});
const owning = (title, vols) => order(vols.map((v) => `(LN) ${title} เล่ม ${v}`));

const section = (name) => screen.getByRole('region', { name: new RegExp(name, 'i') });

describe('CollectionPanel', () => {
  const DETAILS = [
    owning('ชายแปด', [1, 2, 3, 5]),
    owning('ห้องเรียน', [1, 2, 3]),
    owning('หลานจอมปราชญ์', [3, 4]),
  ];

  it('leads with the headline counts', () => {
    render(<CollectionPanel details={DETAILS} />);
    const overall = within(section('collection'));
    expect(overall.getByText('Series').nextSibling.textContent).toBe('3');
    expect(overall.getByText('Volumes owned').nextSibling.textContent).toBe('9');
    expect(overall.getByText('Volumes missing').nextSibling.textContent).toBe('1');
  });

  it('names each series that has a hole and the volumes it is missing', () => {
    render(<CollectionPanel details={DETAILS} />);
    const gapSection = section('missing volumes');
    const gaps = within(gapSection);
    expect(gaps.getByText('ชายแปด')).toBeTruthy();
    // Queried directly rather than by text: the number sits in its own
    // <strong>, and '4' is also a slot in the strip above it.
    expect(gapSection.querySelector('.collection-missing').textContent).toBe('Missing 4');
    // The complete series must not appear in the gap list.
    expect(gaps.queryByText('ห้องเรียน')).toBeNull();
  });

  it('draws the whole run, marking only the volumes not owned as missing', () => {
    // "22 of 23" says nothing about where the hole is; the strip does.
    render(<CollectionPanel details={[owning('ชายแปด', [1, 2, 3, 5])]} />);
    const strip = screen.getByRole('list', { name: /ชายแปด/ });
    const slots = within(strip).getAllByRole('listitem');
    expect(slots.map((s) => s.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(slots.filter((s) => s.className.includes('is-missing')).map((s) => s.textContent))
      .toEqual(['4']);
  });

  it('describes the strip for a screen reader, which cannot see the shape', () => {
    render(<CollectionPanel details={[owning('ชายแปด', [1, 2, 3, 5])]} />);
    expect(screen.getByRole('list', { name: /owns 4 of 5 volumes, missing 4/i })).toBeTruthy();
  });

  it('reports a series starting above volume 1 separately, not as missing', () => {
    render(<CollectionPanel details={[owning('หลานจอมปราชญ์', [3, 4])]} />);
    const above = within(section('starts above volume 1'));
    expect(above.getByText('หลานจอมปราชญ์')).toBeTruthy();
    expect(above.getByText(/more likely bought elsewhere/i)).toBeTruthy();
    expect(screen.getByText('Volumes missing').nextSibling.textContent).toBe('0');
  });

  it('does not let a cancelled order fill a gap', () => {
    // Same rule as the header total: a cancelled order is not a book you have.
    render(
      <CollectionPanel
        details={[owning('ชายแปด', [1, 3]), order(['(LN) ชายแปด เล่ม 2'], CANCELLED_STATUS)]}
      />
    );
    expect(screen.getByText('Volumes missing').nextSibling.textContent).toBe('1');
  });

  it('says plainly when nothing is missing', () => {
    render(<CollectionPanel details={[owning('ห้องเรียน', [1, 2, 3])]} />);
    expect(within(section('missing volumes')).getByText(/No gaps/i)).toBeTruthy();
  });

  it('states that a gap may be a volume bought elsewhere', () => {
    // The report cannot see purchases made anywhere else. Saying so is the
    // difference between a useful list and a wrong one.
    render(<CollectionPanel details={DETAILS} />);
    expect(screen.getByText(/only sees what you ordered here/i)).toBeTruthy();
  });

  it('accounts for items with no volume number rather than hiding them', () => {
    render(
      <CollectionPanel details={[order(['(LN) ชายแปด เล่ม 1', '(LN) ชายแปด เล่ม 3', '(LN) เล่มเดียวจบ'])]} />
    );
    expect(screen.getByText(/1 item\(s\) carry no/)).toBeTruthy();
  });

  it('caps the gap list and reveals the rest on demand', () => {
    const many = Array.from({ length: 13 }, (_, i) => owning(`เรื่อง${i}`, [1, 3]));
    render(<CollectionPanel details={many} />);
    const gaps = section('missing volumes');
    expect(within(gaps).getAllByRole('list').length).toBe(10);
    fireEvent.click(within(gaps).getByRole('button', { name: /show all 13/i }));
    expect(within(gaps).getAllByRole('list').length).toBe(13);
  });

  it('lists complete series of more than one volume', () => {
    render(<CollectionPanel details={DETAILS} />);
    expect(within(section('complete series')).getByText('ห้องเรียน')).toBeTruthy();
  });

  it('points at the npm script when no details have been scraped', () => {
    render(<CollectionPanel details={[]} />);
    expect(screen.getByText(/npm run order-details/)).toBeTruthy();
  });

  it('says so when nothing scraped carries a volume number', () => {
    render(<CollectionPanel details={[order(['(LN) เล่มเดียวจบ'])]} />);
    expect(screen.getByText(/no series to track/i)).toBeTruthy();
  });
});

describe('collection-report.js stays importable by the browser', () => {
  // A stray Node import here would break the Vite bundle while every Node-run
  // test stayed green — the same shape of failure that broke `npm run excel`.
  it('imports nothing from Node built-ins', () => {
    // Vitest runs from the repo root, so this resolves without import.meta.
    const src = readFileSync('src/collection-report.js', 'utf8');
    const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('.')).toBe(true);
    }
  });
});
