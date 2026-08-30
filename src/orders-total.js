/**
 * The one place that decides what an order is worth and what "total" means.
 *
 * These four sites used to disagree: `npm run sum` excluded cancelled orders
 * while the Excel total row and the UI header included them — on 103 real
 * orders that is ฿157,191.00 against ฿166,003.50, with nothing on screen
 * saying which rule either number used. Cancelled orders were never paid, so
 * `spent` excludes them everywhere; `cancelled` is reported alongside rather
 * than hidden, and `gross` is there when the older figure is wanted.
 *
 * Kept free of Node imports so the browser bundle can use it too — this file
 * is imported by src/ and by client/src/ alike.
 */

export const PRICE_KEY = 'ราคาสุทธิ';
export const STATUS_KEY = 'สถานะ';
export const CANCELLED_STATUS = 'ออร์เดอร์ยกเลิก';

/** Parse `"฿1,234.56"` to 1234.56. Returns null for a missing or unparsable price. */
export function parsePrice(raw) {
  if (raw === 0) return 0;
  if (!raw || raw === '-') return null;
  const value = parseFloat(String(raw).replace(/[฿,]/g, ''));
  return isNaN(value) ? null : value;
}

export function isCancelled(order) {
  return order?.[STATUS_KEY] === CANCELLED_STATUS;
}

/**
 * Break a list of orders into the figures every caller needs:
 *   spent     — what actually left your pocket (cancelled excluded)
 *   cancelled — count and value of the cancelled ones
 *   gross     — spent + cancelled
 *   noPrice   — orders whose price could not be read, counted so a silent
 *               parse failure cannot quietly shrink the total
 */
export function summarise(orders = []) {
  let spent = 0;
  let cancelledAmount = 0;
  let cancelledCount = 0;
  let noPrice = 0;

  for (const order of orders) {
    const value = parsePrice(order?.[PRICE_KEY]);
    if (value === null) {
      noPrice++;
      continue;
    }
    if (isCancelled(order)) {
      cancelledCount++;
      cancelledAmount += value;
    } else {
      spent += value;
    }
  }

  return {
    count: orders.length,
    spent,
    cancelledCount,
    cancelledAmount,
    gross: spent + cancelledAmount,
    noPrice,
  };
}

/** `1234.56` -> `"฿1,234.56"`, the same shape the site uses. */
export function formatBaht(value) {
  return `฿${Number(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
