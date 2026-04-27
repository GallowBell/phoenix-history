import { readFile } from 'fs/promises';
import { resolve } from 'path';

export async function run() {
  const filePath = process.env.ORDERS_OUTPUT_FILE ?? 'orders.json';
  const absPath = resolve(filePath);

  const orders = JSON.parse(await readFile(absPath, 'utf-8'));

  const KEY = 'ราคาสุทธิ';

  let total = 0;
  let skipped = 0;

  for (const order of orders) {
    const raw = order[KEY];
    if (!raw || raw === '-') { skipped++; continue; }
    const value = parseFloat(raw.replace(/[฿,]/g, ''));
    if (isNaN(value)) { skipped++; continue; }
    total += value;
  }

  const formatted = total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  console.log(`Orders : ${orders.length}`);
  if (skipped > 0) console.log(`Skipped: ${skipped} (no price)`);
  console.log(`Total  : ฿${formatted}`);
}
