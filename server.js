import express from 'express';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const app = express();
const PORT = process.env.SERVER_PORT ?? 3001;

app.get('/api/orders', async (req, res) => {
  try {
    const data = await readFile(resolve(process.env.ORDERS_OUTPUT_FILE ?? 'orders.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: 'orders.json not found — run: npm run orders' });
  }
});

app.get('/api/order-details', async (req, res) => {
  try {
    const data = await readFile(resolve(process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: `${process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json'} not found — run: npm run order-details` });
  }
});

app.get('/api/excel/download', async (req, res) => {
  try {
    const { generateBuffer } = await import('./src/export-excel.js');
    const buffer = await generateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'Failed to generate Excel export' });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`API server: http://localhost:${PORT}`);
});
