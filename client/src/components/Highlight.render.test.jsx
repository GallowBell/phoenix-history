// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OrdersTable from './OrdersTable.jsx';
import OrderDetailsTable from './OrderDetailsTable.jsx';

// Vitest globals are off, so unmounting between tests is on us — without it
// each render stacks in the same document and the queries below go ambiguous.
afterEach(cleanup);

const ORDER = {
  'หมายเลขคำสั่งซื้อ': '000434985',
  'วันที่ซื้อ': '29/8/26',
  'ราคาสุทธิ': '฿1,234.56',
  'สถานะ': 'จัดส่งแล้ว',
  'โค้ดส่วนลด': 'SAVE10',
  'ดูรายละเอียด': 'https://example.com/order/1',
};

const DETAIL = {
  ...ORDER,
  orderId: '1',
  items: [{ name: 'Complete Set', sku: 'PRE-SEP-LN', price: '฿1,000', quantity: 1, subtotal: '฿1,000' }],
};

const search = (value) =>
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value } });

const marks = () => [...document.querySelectorAll('mark.hl')].map((m) => m.textContent);

describe('search highlighting in the tables', () => {
  it('marks the matching part of an orders-table cell', () => {
    render(<OrdersTable orders={[ORDER]} />);
    expect(marks()).toEqual([]);
    search('434');
    expect(marks()).toEqual(['434']);
  });

  it('keeps the rest of the cell text intact around the mark', () => {
    render(<OrdersTable orders={[ORDER]} />);
    search('434');
    expect(screen.getByRole('cell', { name: '000434985' })).toBeTruthy();
  });

  it('marks item name and sku in the details table', () => {
    render(<OrderDetailsTable details={[DETAIL]} />);
    search('se');
    // "Complete Set" and "PRE-SEP-LN" both contain "se", case-insensitively.
    expect(marks()).toEqual(['Se', 'SE']);
  });

  it('marks the order number and discount code in the details header', () => {
    render(<OrderDetailsTable details={[DETAIL]} />);
    search('SAVE10');
    expect(marks()).toEqual(['SAVE10']);
  });

  it('does not mark a row that only matched a hidden field', () => {
    render(<OrdersTable orders={[ORDER]} />);
    search('nomatch');
    expect(marks()).toEqual([]);
    expect(screen.getByText('No results')).toBeTruthy();
  });
});
