// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OrdersTable from './OrdersTable.jsx';
import OrderDetailsTable from './OrderDetailsTable.jsx';
import { CANCELLED_STATUS } from '../../../src/orders-total.js';

afterEach(cleanup);

// OrdersTable renders every key as a column, so the fixture carries no
// duplicate of the order number — `orderId` would make queries ambiguous.
const order = (id, status = 'จัดส่งแล้ว') => ({
  'หมายเลขคำสั่งซื้อ': id,
  'วันที่ซื้อ': '1/1/25',
  'ราคาสุทธิ': '฿100.00',
  'สถานะ': status,
  'ดูรายละเอียด': 'https://example.com/1',
});

const detail = (id, status, items) => ({ ...order(id, status), orderId: id, items });

const LN = (name) => ({ name, sku: 'S1', price: '฿100', quantity: 1, subtotal: '฿100' });

const ORDERS = [
  order('A'),
  order('B', CANCELLED_STATUS),
  order('C'),
  order('D', CANCELLED_STATUS),
];

const DETAILS = [
  detail('A', 'จัดส่งแล้ว', [LN('(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9')]),
  detail('B', CANCELLED_STATUS, [LN('(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10')]),
  detail('C', 'จัดส่งแล้ว', [LN('(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12')]),
];

const box = () => screen.getByRole('checkbox');
const rowCount = () => Number(screen.getByText(/\d+ rows/).textContent.split(' ')[0]);

describe('exclude-cancelled checkbox', () => {
  it('is unchecked by default, so nothing is hidden until asked', () => {
    render(<OrdersTable orders={ORDERS} />);
    expect(box().checked).toBe(false);
    expect(rowCount()).toBe(4);
  });

  it('labels itself with the number of cancelled orders', () => {
    render(<OrdersTable orders={ORDERS} />);
    expect(screen.getByText('Exclude cancelled')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  it('drops cancelled rows from the orders table when checked', () => {
    render(<OrdersTable orders={ORDERS} />);
    fireEvent.click(box());
    expect(rowCount()).toBe(2);
    expect(screen.queryByText('B')).toBeNull();
    expect(screen.queryByText('D')).toBeNull();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('puts them back when unchecked', () => {
    render(<OrdersTable orders={ORDERS} />);
    fireEvent.click(box());
    fireEvent.click(box());
    expect(rowCount()).toBe(4);
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('drops cancelled cards from the details table too', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    expect(rowCount()).toBe(3);
    fireEvent.click(box());
    expect(rowCount()).toBe(2);
    expect(screen.queryByText('B')).toBeNull();
  });

  it('combines with a facet filter as AND', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'LN' } });
    expect(rowCount()).toBe(2); // A and B are both light novels
    fireEvent.click(box());
    expect(rowCount()).toBe(1); // B is cancelled
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('is cleared by the Clear filters button along with the selects', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    fireEvent.click(box());
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'LN' } });
    fireEvent.click(screen.getByText('Clear filters'));
    expect(box().checked).toBe(false);
    expect(screen.getByLabelText('Type').value).toBe('');
    expect(rowCount()).toBe(3);
  });

  it('shows the Clear filters button for the checkbox alone', () => {
    render(<OrderDetailsTable details={DETAILS} />);
    expect(screen.queryByText('Clear filters')).toBeNull();
    fireEvent.click(box());
    expect(screen.getByText('Clear filters')).toBeTruthy();
  });

  it('is hidden entirely when no order was cancelled', () => {
    render(<OrdersTable orders={[order('A'), order('C')]} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Exclude cancelled')).toBeNull();
  });
});
