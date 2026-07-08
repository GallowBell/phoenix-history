import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import ordersFixture from './tests/fixtures/orders-sample.json' with { type: 'json' };
import detailsFixture from './tests/fixtures/orders-details-sample.json' with { type: 'json' };

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('./src/export-excel.js', () => ({
  generateBuffer: vi.fn(),
}));

const { readFile } = await import('fs/promises');
const { generateBuffer } = await import('./src/export-excel.js');
const { default: app } = await import('./server.js');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/orders', () => {
  it('returns orders JSON when the file exists', async () => {
    readFile.mockResolvedValue(JSON.stringify(ordersFixture));

    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(ordersFixture);
  });

  it('returns 404 when the file is missing', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'));

    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/order-details', () => {
  it('returns order details JSON when the file exists', async () => {
    readFile.mockResolvedValue(JSON.stringify(detailsFixture));

    const res = await request(app).get('/api/order-details');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(detailsFixture);
  });

  it('returns 404 when the file is missing', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'));

    const res = await request(app).get('/api/order-details');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/excel/download', () => {
  it('returns an xlsx buffer with the correct headers', async () => {
    generateBuffer.mockResolvedValue(Buffer.from('fake-excel-content'));

    const res = await request(app).get('/api/excel/download');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers['content-disposition']).toContain('orders.xlsx');
  });

  it('returns 500 when generation fails', async () => {
    generateBuffer.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/excel/download');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
