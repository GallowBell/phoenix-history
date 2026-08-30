import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { summarise, formatBaht } from './orders-total.js';

// Re-exported because this used to be the canonical copy; the logic now lives
// in orders-total.js alongside the rule about what counts toward a total.
export { parsePrice } from './orders-total.js';

export async function run() {
  const filePath = process.env.ORDERS_OUTPUT_FILE ?? 'orders.json';
  const orders = JSON.parse(await readFile(resolve(filePath), 'utf-8'));
  const { count, spent, cancelledCount, cancelledAmount, gross, noPrice } = summarise(orders);

  console.log(`Orders   : ${count}`);
  if (noPrice > 0) console.log(`Skipped  : ${noPrice} (no price)`);
  console.log(`Spent    : ${formatBaht(spent)}`);

  // Show the cancelled money rather than silently dropping it — the Excel
  // export and the UI used to include it, and the gap looked like a bug.
  if (cancelledCount > 0) {
    console.log(`Cancelled: ${formatBaht(cancelledAmount)} (${cancelledCount} order(s), not counted above)`);
    console.log(`Gross    : ${formatBaht(gross)} (spent + cancelled)`);
  }
}
