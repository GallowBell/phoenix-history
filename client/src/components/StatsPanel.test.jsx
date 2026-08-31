// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import StatsPanel from './StatsPanel.jsx';
import { CANCELLED_STATUS, summarise, formatBaht } from '../../../src/orders-total.js';

afterEach(cleanup);

const order = (id, date, price, status = 'จัดส่งแล้ว', code = '-') => ({
  'หมายเลขคำสั่งซื้อ': id,
  'วันที่ซื้อ': date,
  'ราคาสุทธิ': price,
  'สถานะ': status,
  'โค้ดส่วนลด': code,
  'ดูรายละเอียด': 'https://example.com/1',
});

const item = (name, subtotal) => ({ name, sku: 'S1', price: subtotal, quantity: 1, subtotal });

// Jan and Apr 2025 have orders; Feb and Mar are the gap the report must show.
const ORDERS = [
  order('A', '10/1/25 10 มกราคม 2025', '฿1,000.00', 'จัดส่งแล้ว', 'LV999'),
  order('B', '20/4/25 20 เมษายน 2025', '฿2,000.00', 'จัดส่งแล้ว', 'LV999'),
  order('C', '25/4/25 25 เมษายน 2025', '฿500.00', CANCELLED_STATUS, '-'),
  order('D', '5/6/26 5 มิถุนายน 2026', '฿300.00', 'จัดส่งแล้ว', 'BF2019'),
];

const DETAILS = [
  { ...ORDERS[0], orderId: 'A', items: [item('(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9', '฿1,100.00')] },
  { ...ORDERS[1], orderId: 'B', items: [item('(MG) สกิลโกงไร้เทียมทาน เล่ม 3', '฿2,000.00')] },
  { ...ORDERS[3], orderId: 'D', items: [item('(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10', '฿280.00')] },
];

const section = (name) => screen.getByRole('region', { name: new RegExp(name, 'i') });

describe('StatsPanel', () => {
  it('reports the same spent total as summarise(), the rule the header uses', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const { spent } = summarise(ORDERS);
    expect(spent).toBe(3300);
    expect(within(section('overall')).getByText(formatBaht(spent))).toBeTruthy();
  });

  it('reports cancelled money beside the total rather than folded into it', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const overall = within(section('overall'));
    expect(overall.getByText(formatBaht(500))).toBeTruthy();
    expect(overall.queryByText(formatBaht(3800))).toBeNull();
  });

  it('shows a row for a month with no orders, so a gap in spending stays visible', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const months = section('month');
    // Jan 2025 → Jun 2026 is 18 months, past the 12-month default, so the
    // gap being asserted on only exists once the full range is shown.
    fireEvent.click(within(months).getByRole('button', { name: /show all/i }));
    expect(within(months).getByText('Feb 2025')).toBeTruthy();
    expect(within(months).getByText('Mar 2025')).toBeTruthy();
    expect(within(months).getAllByRole('row').length - 1).toBe(18);
  });

  it('excludes cancelled orders from the year figures', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const years = within(section('year'));
    // 2025 = 1,000 + 2,000; the ฿500 cancelled order is not money spent.
    expect(years.getByText(formatBaht(3000))).toBeTruthy();
  });

  it('caps the series list and reveals the rest on demand', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      ({ ...order(`S${i}`, '1/1/25', '฿100.00'), orderId: `S${i}`, items: [item(`(LN) เรื่องที่ ${i} เล่ม 1`, '฿100.00')] }));
    render(<StatsPanel orders={ORDERS} details={many} />);
    const series = section('series');
    expect(within(series).getAllByRole('row').length - 1).toBe(10);
    fireEvent.click(within(series).getByRole('button', { name: /show all/i }));
    expect(within(series).getAllByRole('row').length - 1).toBe(14);
  });

  it('labels series figures as list prices rather than presenting them as spend', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    expect(within(section('series')).getByText(/an order discount belongs to the order/i)).toBeTruthy();
  });

  it('reports discount and delivery separately, since the gap runs both ways', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const gap = within(section('list price vs paid'));
    // A: listed 1,100 vs paid 1,000 -> ฿100 discount. D: 280 vs 300 -> ฿20 fee.
    expect(gap.getByText(`-${formatBaht(100)}`)).toBeTruthy();
    expect(gap.getByText(`+${formatBaht(20)}`)).toBeTruthy();
  });

  it('says the discount is derived, because the site publishes no discount line', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    expect(within(section('list price vs paid')).getByText(/derived/i)).toBeTruthy();
  });

  it('lists discount codes and ignores the "-" placeholder', () => {
    render(<StatsPanel orders={ORDERS} details={DETAILS} />);
    const codes = within(section('discount codes'));
    expect(codes.getByText('LV999')).toBeTruthy();
    expect(codes.getByText('BF2019')).toBeTruthy();
    expect(codes.queryByText('-')).toBeNull();
  });

  it('points at the npm script when no details have been scraped', () => {
    render(<StatsPanel orders={ORDERS} details={[]} />);
    expect(screen.getByText(/npm run order-details/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /series/i })).toBeNull();
  });

  it('renders without crashing on no data at all', () => {
    render(<StatsPanel orders={[]} details={[]} />);
    expect(screen.getByText(/npm run orders/)).toBeTruthy();
  });
});

describe('stats-report.js stays importable by the browser', () => {
  // A stray Node import here would break the Vite bundle while every Node-run
  // test stayed green — the same shape of failure that broke `npm run excel`.
  it('imports nothing from Node built-ins', () => {
    // Vitest runs from the repo root, so this resolves without import.meta.
    const src = readFileSync('src/stats-report.js', 'utf8');
    const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('.')).toBe(true);
    }
  });
});
