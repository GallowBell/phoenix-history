import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parsePrice } from './sum-orders.js';

const ORDER_NUMBER_KEY = 'หมายเลขคำสั่งซื้อ';
const DISCOUNT_KEY = 'โค้ดส่วนลด';
const DATE_KEY = 'วันที่ซื้อ';
const PRICE_KEY = 'ราคาสุทธิ';
const STATUS_KEY = 'สถานะ';

/**
 * Searchable fields. Order-level fields return the order's own value; item
 * fields return one entry per item, so the matching items can be reported.
 */
const FIELDS = {
  [ORDER_NUMBER_KEY]: { level: 'order', values: (o) => [o[ORDER_NUMBER_KEY]] },
  [DISCOUNT_KEY]: { level: 'order', values: (o) => [o[DISCOUNT_KEY]] },
  orderId: { level: 'order', values: (o) => [o.orderId] },
  items: { level: 'item', values: (i) => [i.name, i.sku] },
  name: { level: 'item', values: (i) => [i.name] },
  sku: { level: 'item', values: (i) => [i.sku] },
};

/** ASCII aliases, so the Thai keys don't have to be typed at a shell prompt. */
const ALIASES = {
  order: ORDER_NUMBER_KEY,
  'order-number': ORDER_NUMBER_KEY,
  no: ORDER_NUMBER_KEY,
  discount: DISCOUNT_KEY,
  code: DISCOUNT_KEY,
  id: 'orderId',
  item: 'items',
  product: 'name',
};

const DEFAULT_FIELD = 'name';

export const FIELD_NAMES = Object.keys(FIELDS);

/** Map a user-supplied key (or alias) to a canonical field name, else null. */
export function resolveField(key) {
  if (key in FIELDS) return key;
  const alias = ALIASES[String(key).toLowerCase()];
  return alias ?? null;
}

/**
 * Split CLI arguments into a field and a query. The field is optional: the
 * first argument is only treated as one when it actually names a field, so
 * `find Complete Set` searches item names for "Complete Set".
 */
export function parseArgs(args) {
  if (!args.length) return { field: DEFAULT_FIELD, query: '' };
  const field = resolveField(args[0]);
  if (field && args.length > 1) return { field, query: args.slice(1).join(' ') };
  return { field: DEFAULT_FIELD, query: args.join(' ') };
}

const contains = (value, q) => String(value ?? '').toLowerCase().includes(q);

/**
 * Find orders matching `query` in `field`. Returns one entry per matching
 * order, carrying the items responsible for the match — for order-level
 * fields that is every item on the order.
 */
export function findOrders(orders, field, query) {
  const spec = FIELDS[field];
  if (!spec) throw new Error(`Unknown field: ${field}`);
  const q = query.toLowerCase();
  const results = [];

  for (const order of orders) {
    const items = order.items ?? [];
    if (spec.level === 'order') {
      if (spec.values(order).some((v) => contains(v, q))) results.push({ order, items });
    } else {
      const matched = items.filter((item) => spec.values(item).some((v) => contains(v, q)));
      if (matched.length) results.push({ order, items: matched });
    }
  }

  return results;
}

function formatBaht(value) {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function run() {
  const args = process.argv.slice(3);
  const { field, query } = parseArgs(args);

  if (!query) {
    console.error('Usage: npm run find [key] <value>');
    console.error(`Keys : ${FIELD_NAMES.join(', ')}`);
    console.error(`       aliases: ${Object.keys(ALIASES).join(', ')}`);
    console.error(`Default key is "${DEFAULT_FIELD}" (searches item names).`);
    process.exit(1);
  }

  const filePath = process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json';
  let orders;
  try {
    orders = JSON.parse(await readFile(resolve(filePath), 'utf-8'));
  } catch {
    throw new Error(`${filePath} not found — run: npm run order-details`);
  }

  const results = findOrders(orders, field, query);

  if (!results.length) {
    console.log(`No orders found where ${field} contains "${query}".`);
    return;
  }

  let total = 0;
  let matchedItems = 0;

  for (const { order, items } of results) {
    const price = parsePrice(order[PRICE_KEY]);
    if (price !== null) total += price;
    matchedItems += items.length;

    const discount = order[DISCOUNT_KEY] ? `  ${order[DISCOUNT_KEY]}` : '';
    console.log(
      `\n${order[ORDER_NUMBER_KEY]}  ${order[DATE_KEY]}  ${order[STATUS_KEY]}  ${order[PRICE_KEY]}${discount}`
    );
    for (const item of items) {
      console.log(`   • ${item.name}  [${item.sku}]  ×${item.quantity}  ${item.subtotal}`);
    }
  }

  console.log(
    `\n${results.length} order(s), ${matchedItems} item(s) matching ${field}="${query}"`
  );
  console.log(`Total ${PRICE_KEY} of matched orders: ${formatBaht(total)}`);
}
