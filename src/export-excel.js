import ExcelJS from 'exceljs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { summarise, isCancelled, parsePrice, PRICE_KEY } from './orders-total.js';

// Imported above for use here, and re-exported because this module used to own
// the copy; the canonical one now lives in orders-total.js.
export { parsePrice };

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

async function buildWorkbook() {
  const ordersPath = resolve(process.env.ORDERS_OUTPUT_FILE ?? 'orders.json');
  const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'phoenix-history';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Orders', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const keys = Object.keys(orders[0]);
  sheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: COLUMN_WIDTHS[key] ?? 20,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A9F' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  for (const order of orders) {
    const row = sheet.addRow(order);
    row.alignment = { vertical: 'middle' };

    const priceCell = row.getCell(PRICE_KEY);
    const numeric = parsePrice(order[PRICE_KEY]);
    if (numeric !== null) {
      priceCell.value = numeric;
      priceCell.numFmt = '฿#,##0.00';
      // Cancelled orders stay visible in the sheet but are struck through, so
      // the rows and the total below tell the same story.
      if (isCancelled(order)) row.font = { strike: true, color: { argb: 'FF999999' } };
    }
  }

  const { spent, cancelledCount, cancelledAmount, gross } = summarise(orders);
  const labelKey = keys[0];

  sheet.addRow({});
  const addTotal = (label, value, highlight) => {
    const row = sheet.addRow({ [labelKey]: label, [PRICE_KEY]: value });
    row.font = { bold: true };
    row.getCell(PRICE_KEY).numFmt = '฿#,##0.00';
    if (highlight) {
      row.getCell(PRICE_KEY).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' },
      };
    }
    return row;
  };

  // Labelled, because an unlabelled bold number was the whole problem: it
  // silently included cancelled orders while `npm run sum` excluded them.
  addTotal('Spent (excl. cancelled)', spent, true);
  if (cancelledCount > 0) {
    addTotal(`Cancelled (${cancelledCount})`, cancelledAmount, false);
    addTotal('Gross (incl. cancelled)', gross, false);
  }
  const total = spent;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: keys.length },
  };

  return { workbook, orders, total };
}

export async function run() {
  const { workbook, orders, total } = await buildWorkbook();
  const outputPath = resolve(process.env.ORDERS_EXCEL_FILE ?? 'orders.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote ${orders.length} orders to ${outputPath}`);
  console.log(`Total ราคาสุทธิ: ฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`);
}

export async function generateBuffer() {
  const { workbook } = await buildWorkbook();
  return workbook.xlsx.writeBuffer();
}
