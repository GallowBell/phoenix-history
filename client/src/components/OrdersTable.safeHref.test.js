import { describe, it, expect } from 'vitest';
import { safeHref } from './OrdersTable.jsx';

describe('safeHref', () => {
  it('allows https URLs', () => {
    expect(safeHref('https://www.phoenixnext.com/sales/order/view/order_id/1/')).toBe(
      'https://www.phoenixnext.com/sales/order/view/order_id/1/'
    );
  });

  it('allows http URLs', () => {
    expect(safeHref('http://example.com')).toBe('http://example.com');
  });

  it('rejects javascript: URLs to prevent XSS', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });

  it('rejects malformed non-URL strings', () => {
    expect(safeHref('not a url')).toBeNull();
  });
});
