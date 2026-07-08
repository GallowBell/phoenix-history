import { readFile } from 'fs/promises';
import { resolve } from 'path';

export function parsePrice(raw) {
  if (!raw || raw === '-') return null;
  const value = parseFloat(raw.replace(/[฿,]/g, ''));
  return isNaN(value) ? null : value;
}

export async function run() {
  const filePath = process.env.ORDERS_OUTPUT_FILE ?? 'orders.json';
  const absPath = resolve(filePath);

  const orders = JSON.parse(await readFile(absPath, 'utf-8'));

  const KEY = 'ราคาสุทธิ';
  const STATUS_KEY = 'สถานะ';
  const CANCELLED_STATUS = 'ออร์เดอร์ยกเลิก';

  let total = 0;
  let skipped = 0;
  let cancelled = 0;

  for (const order of orders) {
    if (order[STATUS_KEY] === CANCELLED_STATUS) { cancelled++; continue; }
    const value = parsePrice(order[KEY]);
    if (value === null) { skipped++; continue; }
    total += value;
  }

  const formatted = total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  console.log(`Orders : ${orders.length}`);
  if (cancelled > 0) console.log(`Excluded: ${cancelled} (cancelled)`);
  if (skipped > 0) console.log(`Skipped: ${skipped} (no price)`);
  console.log(`Total  : ฿${formatted}`);
}
