// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OrderDetailsTable from './OrderDetailsTable.jsx';
import { seriesKey } from '../../../src/product-name.js';

afterEach(cleanup);

const order = (id, ...names) => ({
  'หมายเลขคำสั่งซื้อ': id,
  'วันที่ซื้อ': '1/1/25',
  'ราคาสุทธิ': '฿100.00',
  'สถานะ': 'จัดส่งแล้ว',
  orderId: id,
  items: names.map((name, i) => ({
    name, sku: `SKU${i}`, price: '฿100', quantity: 1, subtotal: '฿100',
  })),
});

const DETAILS = [
  order('A', '(PRE/MAY)(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10'),
  order('B', '(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9',
             '(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12'),
  order('C', 'Free Gift - BokuYaba the Movie Free Postcard'),
];

const select = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const rowCount = () => Number(screen.getByText(/\d+ rows/).textContent.split(' ')[0]);
const productCells = () =>
  [...document.querySelectorAll('.items-table tbody tr td:first-child')].map((td) => td.textContent);

describe('order-details facet filters', () => {
  it('offers one option per series, not one per volume', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    const options = [...screen.getByLabelText('Series').options].map((o) => o.textContent);
    expect(options).toEqual([
      'All series',
      'แง้มหัวใจยัยน้องสาวจำเป็น (2)',
      'ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน (1)',
      'Free gift / goods (1)',
    ]);
  });

  it('keeps only the orders that contain a matching item', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    expect(rowCount()).toBe(3);
    select('Series', seriesKey('แง้มหัวใจยัยน้องสาวจำเป็น'));
    expect(rowCount()).toBe(2);
    expect(screen.queryByText('C')).toBeNull();
  });

  it('narrows a mixed order to the items that matched', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    expect(productCells()).toHaveLength(4);
    select('Type', 'MG');
    // Order B held two items; only the manga one is left, and A and C are gone.
    expect(productCells()).toEqual(['(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12']);
  });

  it('combines the three selects as AND', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    select('Type', 'LN');
    expect(rowCount()).toBe(2);
    select('Set', 'Complete Set');
    expect(rowCount()).toBe(1);
    expect(productCells()).toEqual(['(PRE/MAY)(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10']);
  });

  it('filters unset items through the "No set" option', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    select('Set', 'NONE');
    expect(productCells()).not.toContain(
      '(PRE/MAY)(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10');
    expect(rowCount()).toBe(2);
  });

  it('shows a clear button only while a filter is set, and it resets every select', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    expect(screen.queryByText('Clear filters')).toBeNull();
    select('Type', 'LN');
    select('Set', 'Complete Set');
    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.queryByText('Clear filters')).toBeNull();
    expect(rowCount()).toBe(3);
    expect(screen.getByLabelText('Type').value).toBe('');
    expect(screen.getByLabelText('Set').value).toBe('');
  });

  it('still applies the search box on top of a filter', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    select('Type', 'LN');
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'เล่ม 9' } });
    expect(rowCount()).toBe(1);
  });

  it('reports no results when a combination matches nothing', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    // Both options exist on their own; no item is both.
    select('Type', 'MG');
    select('Set', 'Complete Set');
    expect(rowCount()).toBe(0);
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('never offers a facet the data does not contain', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    const values = (label) => [...screen.getByLabelText(label).options].map((o) => o.value);
    expect(values('Type')).toEqual(['', 'LN', 'MG', 'GOODS']);
    expect(values('Set')).toEqual(['', 'Complete Set', 'NONE']);
  });
});
