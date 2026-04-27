import ExcelJS from 'exceljs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const PRICE_KEY = 'ราคาสุทธิ';

const COLUMN_WIDTHS = {
  'หมายเลขคำสั่งซื้อ': 18,
  'วันที่ซื้อ': 28,
  'ที่อยู่จัดส่ง': 30,
  'ราคาสุทธิ': 14,
  'โค้ดส่วนลด': 16,
  'สถานะ': 20,
  'ดูรายละเอียด': 60,
  'สั่งซื้ออีกครั้ง': 20,
};

function parsePrice(raw) {
  if (!raw || raw === '-') return null;
  const value = parseFloat(raw.replace(/[฿,]/g, ''));
  return isNaN(value) ? null : value;
}

export async function run() {
  const ordersPath = resolve(process.env.ORDERS_OUTPUT_FILE ?? 'orders.json');
  const outputPath = resolve(process.env.ORDERS_EXCEL_FILE ?? 'orders.xlsx');

  const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));
  if (!orders.length) {
    console.error('No orders found in', ordersPath);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'phoenix-history';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Orders', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Columns from the first order's keys
  const keys = Object.keys(orders[0]);
  sheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: COLUMN_WIDTHS[key] ?? 20,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A9F' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Add data rows
  let total = 0;
  for (const order of orders) {
    const row = sheet.addRow(order);
    row.alignment = { vertical: 'middle' };

    // Format price cell as number with Thai baht symbol
    const priceCell = row.getCell(PRICE_KEY);
    const numeric = parsePrice(order[PRICE_KEY]);
    if (numeric !== null) {
      priceCell.value = numeric;
      priceCell.numFmt = '฿#,##0.00';
      total += numeric;
    }
  }

  // Total row
  sheet.addRow({});
  const totalRow = sheet.addRow({ [PRICE_KEY]: total });
  totalRow.font = { bold: true };
  totalRow.getCell(PRICE_KEY).numFmt = '฿#,##0.00';
  totalRow.getCell(PRICE_KEY).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' },
  };

  // Add auto-filter on header
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: keys.length },
  };

  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote ${orders.length} orders to ${outputPath}`);
  console.log(`Total ราคาสุทธิ: ฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`);
}
