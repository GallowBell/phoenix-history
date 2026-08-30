import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, rm } from 'fs/promises';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import { parsePrice, generateBuffer } from './export-excel.js';
import { summarise } from './orders-total.js';

describe('export-excel parsePrice', () => {
  it('parses a comma-separated Thai baht price', () => {
    expect(parsePrice('฿1,234.56')).toBe(1234.56);
  });

  it('parses a simple price without commas', () => {
    expect(parsePrice('฿500.00')).toBe(500);
  });

  it('returns null for a dash placeholder', () => {
    expect(parsePrice('-')).toBeNull();
  });

  it('returns null for empty/falsy input', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(parsePrice('not-a-price')).toBeNull();
  });
});

// The parsePrice tests above pass whether or not the workbook can actually be
// built — a re-export without a local binding broke `npm run excel` while they
// stayed green. These drive the real exceljs path against a fixture.
describe('generateBuffer', () => {
  const FIXTURE = resolve('tests/fixtures/orders-total-sample.json');
  const ORDERS = [
    { 'หมายเลขคำสั่งซื้อ': 'A1', 'ราคาสุทธิ': '฿100.00', 'สถานะ': 'จัดส่งแล้ว' },
    { 'หมายเลขคำสั่งซื้อ': 'A2', 'ราคาสุทธิ': '฿30.50', 'สถานะ': 'ออร์เดอร์ยกเลิก' },
    { 'หมายเลขคำสั่งซื้อ': 'A3', 'ราคาสุทธิ': '฿20.00', 'สถานะ': 'จัดส่งแล้ว' },
  ];

  let sheet;

  beforeAll(async () => {
    await writeFile(FIXTURE, JSON.stringify(ORDERS), 'utf-8');
    const previous = process.env.ORDERS_OUTPUT_FILE;
    process.env.ORDERS_OUTPUT_FILE = FIXTURE;
    try {
      const buffer = await generateBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      sheet = workbook.getWorksheet('Orders');
    } finally {
      if (previous === undefined) delete process.env.ORDERS_OUTPUT_FILE;
      else process.env.ORDERS_OUTPUT_FILE = previous;
      await rm(FIXTURE, { force: true });
    }
  });

  const rowLabelled = (label) => {
    let found = null;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === label) found = row;
    });
    return found;
  };
  const priceCol = () => sheet.getRow(1).values.indexOf('ราคาสุทธิ');

  it('produces a readable workbook with a row per order', () => {
    expect(sheet).toBeTruthy();
    expect(sheet.rowCount).toBeGreaterThanOrEqual(ORDERS.length + 1);
  });

  it('totals only what was spent, excluding the cancelled order', () => {
    expect(rowLabelled('Spent (excl. cancelled)').getCell(priceCol()).value).toBe(120);
  });

  it('reports the cancelled money on its own labelled row', () => {
    expect(rowLabelled('Cancelled (1)').getCell(priceCol()).value).toBe(30.5);
  });

  it('reports gross, matching what the header used to show', () => {
    expect(rowLabelled('Gross (incl. cancelled)').getCell(priceCol()).value).toBe(150.5);
  });

  it('agrees with summarise, so the sheet cannot drift from npm run sum', () => {
    const s = summarise(ORDERS);
    expect(rowLabelled('Spent (excl. cancelled)').getCell(priceCol()).value).toBe(s.spent);
    expect(rowLabelled('Gross (incl. cancelled)').getCell(priceCol()).value).toBe(s.gross);
  });

  it('strikes through the cancelled order row', () => {
    let struck = null;
    const statusCol = sheet.getRow(1).values.indexOf('สถานะ');
    sheet.eachRow((row, i) => {
      if (i > 1 && row.getCell(statusCol).value === 'ออร์เดอร์ยกเลิก') struck = row.font?.strike;
    });
    expect(struck).toBe(true);
  });
});
