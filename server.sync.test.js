import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./src/sync-job.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    syncJob: {
      getStatus: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      finished: vi.fn(),
    },
  };
});

vi.mock('./src/ensure-cookie.js', () => ({
  extractSessionId: vi.fn(),
  validate: vi.fn(),
  saveSessionId: vi.fn(),
  historyUrl: vi.fn(async () => 'https://example.com/sales/order/history/'),
}));

const request = (await import('supertest')).default;
const { syncJob, JobBusyError, UnknownCommandError } = await import('./src/sync-job.js');
const { extractSessionId, validate, saveSessionId, historyUrl } = await import('./src/ensure-cookie.js');
const { default: app } = await import('./server.js');

const idle = { id: 0, command: null, status: 'idle', lines: [], exitCode: null };

beforeEach(() => {
  vi.clearAllMocks();
  syncJob.getStatus.mockReturnValue(idle);
  historyUrl.mockResolvedValue('https://example.com/sales/order/history/');
});

describe('POST /api/sync/:command', () => {
  it('starts a known command', async () => {
    syncJob.start.mockReturnValue({ ...idle, status: 'running', command: 'orders' });

    const res = await request(app).post('/api/sync/orders');

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('running');
    expect(syncJob.start).toHaveBeenCalledWith('orders', { force: false });
  });

  it('forwards --force when asked for', async () => {
    syncJob.start.mockReturnValue({ ...idle, status: 'running' });
    await request(app).post('/api/sync/orders?force=1');
    expect(syncJob.start).toHaveBeenCalledWith('orders', { force: true });
  });

  it('rejects a command that is not on the allowlist', async () => {
    syncJob.start.mockImplementation(() => { throw new UnknownCommandError('sum'); });

    const res = await request(app).post('/api/sync/sum');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('answers 409 while another sync is running', async () => {
    syncJob.start.mockImplementation(() => { throw new JobBusyError('orders'); });

    const res = await request(app).post('/api/sync/order-details');

    expect(res.status).toBe(409);
    expect(res.body.running).toBe('orders');
  });
});

describe('GET /api/sync/status', () => {
  it('returns the current snapshot', async () => {
    syncJob.getStatus.mockReturnValue({ ...idle, status: 'running', command: 'orders', lines: ['Fetching page 1…'] });

    const res = await request(app).get('/api/sync/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'running', command: 'orders' });
  });
});

describe('POST /api/sync/cancel', () => {
  it('reports whether a job was actually signalled', async () => {
    syncJob.cancel.mockReturnValue(true);
    expect((await request(app).post('/api/sync/cancel')).body).toEqual({ cancelled: true });

    syncJob.cancel.mockReturnValue(false);
    expect((await request(app).post('/api/sync/cancel')).body).toEqual({ cancelled: false });
  });
});

describe('POST /api/session', () => {
  it('validates the pasted id and saves it', async () => {
    extractSessionId.mockReturnValue('abc123');
    validate.mockResolvedValue({ ok: true, rows: 50 });

    const res = await request(app).post('/api/session').send({ sessionId: 'abc123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, rows: 50 });
    expect(saveSessionId).toHaveBeenCalledWith('abc123');
  });

  it('rejects an unusable value without touching .env', async () => {
    extractSessionId.mockReturnValue(null);

    const res = await request(app).post('/api/session').send({ sessionId: 'nope' });

    expect(res.status).toBe(400);
    expect(saveSessionId).not.toHaveBeenCalled();
  });

  it('does not save an id the site rejects', async () => {
    extractSessionId.mockReturnValue('abc123');
    validate.mockResolvedValue({ ok: false, reason: 'HTTP 302 (redirected to login)' });

    const res = await request(app).post('/api/session').send({ sessionId: 'abc123' });

    expect(res.status).toBe(400);
    expect(res.body.reason).toMatch(/302/);
    expect(saveSessionId).not.toHaveBeenCalled();
  });

  it('never echoes the session id back', async () => {
    extractSessionId.mockReturnValue('supersecretvalue');
    validate.mockResolvedValue({ ok: true, rows: 50 });

    const res = await request(app).post('/api/session').send({ sessionId: 'supersecretvalue' });

    expect(JSON.stringify(res.body)).not.toContain('supersecretvalue');
  });
});

describe('GET /api/data-status', () => {
  it('reports what is on disk so the UI can say how stale it is', async () => {
    const res = await request(app).get('/api/data-status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('orders');
    expect(res.body).toHaveProperty('details');
    expect(res.body.orders).toHaveProperty('exists');
  });
});
