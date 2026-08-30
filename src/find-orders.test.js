import { describe, it, expect } from 'vitest';
import {
  resolveField,
  parseArgs,
  findOrders,
  FIELD_NAMES,
  highlight,
  colorEnabled,
  HIGHLIGHTS,
} from './find-orders.js';

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';
const DISCOUNT_KEY = 'โค้ดส่วนลด';

const orders = [
  {
    [ORDER_NUMBER_KEY]: '000100001',
    [DISCOUNT_KEY]: 'LV999MAY',
    orderId: '100001',
    items: [
      { name: 'Complete Set Alpha', sku: 'BX0001-01', quantity: '1', subtotal: '฿100.00' },
      { name: 'Special Set Beta', sku: 'BX0002-01', quantity: '2', subtotal: '฿200.00' },
    ],
  },
  {
    [ORDER_NUMBER_KEY]: '000100002',
    [DISCOUNT_KEY]: '',
    orderId: '100002',
    items: [{ name: 'Complete Set Gamma', sku: 'LN0003-01', quantity: '1', subtotal: '฿300.00' }],
  },
  { [ORDER_NUMBER_KEY]: '000100003', [DISCOUNT_KEY]: '', orderId: '100003', items: [] },
];

describe('find-orders resolveField', () => {
  it('passes canonical field names through', () => {
    for (const f of FIELD_NAMES) expect(resolveField(f)).toBe(f);
  });

  it('resolves ASCII aliases to the Thai keys', () => {
    expect(resolveField('order')).toBe(ORDER_NUMBER_KEY);
    expect(resolveField('code')).toBe(DISCOUNT_KEY);
    expect(resolveField('discount')).toBe(DISCOUNT_KEY);
  });

  it('resolves aliases case-insensitively', () => {
    expect(resolveField('ORDER')).toBe(ORDER_NUMBER_KEY);
    expect(resolveField('Id')).toBe('orderId');
  });

  it('returns null for an unknown key', () => {
    expect(resolveField('nope')).toBeNull();
  });
});

describe('find-orders parseArgs', () => {
  it('defaults to the name field when only a value is given', () => {
    expect(parseArgs(['Alpha'])).toEqual({ field: 'name', query: 'Alpha' });
  });

  it('uses an explicit field when the first argument names one', () => {
    expect(parseArgs(['sku', 'BX0001-01'])).toEqual({ field: 'sku', query: 'BX0001-01' });
  });

  it('resolves an alias in the field position', () => {
    expect(parseArgs(['code', 'LV999MAY'])).toEqual({ field: DISCOUNT_KEY, query: 'LV999MAY' });
  });

  it('joins a multi-word value after an explicit field', () => {
    expect(parseArgs(['name', 'Complete', 'Set'])).toEqual({ field: 'name', query: 'Complete Set' });
  });

  it('treats every argument as the query when the first is not a field', () => {
    expect(parseArgs(['Complete', 'Set'])).toEqual({ field: 'name', query: 'Complete Set' });
  });

  it('treats a lone field name as a query, not a field', () => {
    expect(parseArgs(['sku'])).toEqual({ field: 'name', query: 'sku' });
  });

  it('returns an empty query for no arguments', () => {
    expect(parseArgs([])).toEqual({ field: 'name', query: '' });
  });
});

describe('find-orders findOrders', () => {
  it('matches item names case-insensitively', () => {
    const res = findOrders(orders, 'name', 'complete set');
    expect(res.map((r) => r.order[ORDER_NUMBER_KEY])).toEqual(['000100001', '000100002']);
  });

  it('returns only the items responsible for the match', () => {
    const res = findOrders(orders, 'name', 'Alpha');
    expect(res).toHaveLength(1);
    expect(res[0].items.map((i) => i.sku)).toEqual(['BX0001-01']);
  });

  it('returns every item on the order for an order-level field', () => {
    const res = findOrders(orders, ORDER_NUMBER_KEY, '000100001');
    expect(res[0].items).toHaveLength(2);
  });

  it('matches on sku', () => {
    const res = findOrders(orders, 'sku', 'LN0003');
    expect(res[0].order.orderId).toBe('100002');
  });

  it('matches either name or sku for the items field', () => {
    expect(findOrders(orders, 'items', 'BX0002')).toHaveLength(1);
    expect(findOrders(orders, 'items', 'Gamma')).toHaveLength(1);
  });

  it('matches on discount code', () => {
    const res = findOrders(orders, DISCOUNT_KEY, 'LV999MAY');
    expect(res).toHaveLength(1);
  });

  it('does not match an empty discount code against an empty query', () => {
    expect(findOrders(orders, 'sku', 'NOPE')).toEqual([]);
  });

  it('skips orders with no items when searching item fields', () => {
    const res = findOrders(orders, 'name', 'Set');
    expect(res.every((r) => r.items.length > 0)).toBe(true);
  });

  it('tolerates an order with a missing items array', () => {
    expect(() => findOrders([{ [ORDER_NUMBER_KEY]: 'x' }], 'name', 'a')).not.toThrow();
  });

  it('throws on an unknown field', () => {
    expect(() => findOrders(orders, 'bogus', 'x')).toThrow(/Unknown field/);
  });
});

describe('highlight', () => {
  const wrap = (m) => `[${m}]`;

  it('wraps every case-insensitive occurrence', () => {
    expect(highlight('Complete Set complete', 'complete', wrap)).toBe('[Complete] Set [complete]');
  });

  it('returns the text untouched when no wrapper is given', () => {
    expect(highlight('Complete Set', 'complete', null)).toBe('Complete Set');
  });

  it('returns the text untouched for an empty query', () => {
    expect(highlight('Complete Set', '', wrap)).toBe('Complete Set');
  });

  it('treats regex metacharacters in the query as literals', () => {
    expect(highlight('a.c abc', '.', wrap)).toBe('a[.]c abc');
    expect(() => highlight('anything', '(', wrap)).not.toThrow();
  });

  it('leaves a replacement pattern in the matched text alone', () => {
    // Function-form replace: a bare '$&' would otherwise re-expand.
    expect(highlight('cost $& up', '$&', wrap)).toBe('cost [$&] up');
  });

  it('highlights Thai text', () => {
    expect(highlight('ออร์เดอร์ยกเลิก', 'ยกเลิก', wrap)).toBe('ออร์เดอร์[ยกเลิก]');
  });

  it('coerces nullish and non-string values', () => {
    expect(highlight(null, 'a', wrap)).toBe('');
    expect(highlight(1234, '23', wrap)).toBe('1[23]4');
  });
});

describe('colorEnabled', () => {
  it('is on for a TTY', () => {
    expect(colorEnabled({}, { isTTY: true })).toBe(true);
  });

  it('is off when piped', () => {
    expect(colorEnabled({}, { isTTY: false })).toBe(false);
  });

  it('is off when NO_COLOR is set, even on a TTY', () => {
    expect(colorEnabled({ NO_COLOR: '1' }, { isTTY: true })).toBe(false);
  });

  it('is on when FORCE_COLOR is set, even when piped', () => {
    expect(colorEnabled({ FORCE_COLOR: '1' }, { isTTY: false })).toBe(true);
  });

  it('ignores FORCE_COLOR=0', () => {
    expect(colorEnabled({ FORCE_COLOR: '0' }, { isTTY: false })).toBe(false);
  });

  it('lets NO_COLOR win over FORCE_COLOR', () => {
    expect(colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, { isTTY: false })).toBe(false);
  });
});

describe('HIGHLIGHTS', () => {
  it('covers every searchable field, so a new field cannot be forgotten', () => {
    expect(Object.keys(HIGHLIGHTS).sort()).toEqual([...FIELD_NAMES].sort());
  });

  it('marks only the cell that was searched', () => {
    expect([...HIGHLIGHTS['name']]).toEqual(['name']);
    expect([...HIGHLIGHTS['sku']]).toEqual(['sku']);
    expect([...HIGHLIGHTS['items']].sort()).toEqual(['name', 'sku']);
  });

  it('marks nothing for orderId, which is never printed as a cell', () => {
    expect(HIGHLIGHTS['orderId'].size).toBe(0);
  });

  it('marks the order number and discount only in their own columns', () => {
    expect([...HIGHLIGHTS['หมายเลขคำสั่งซื้อ']]).toEqual(['orderNumber']);
    expect([...HIGHLIGHTS['โค้ดส่วนลด']]).toEqual(['discount']);
  });
});
