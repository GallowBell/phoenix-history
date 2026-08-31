import express from 'express';
import { syncJob, JobBusyError, UnknownCommandError } from './src/sync-job.js';
import { readFile, stat } from 'fs/promises';
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

/* ── Sync ─────────────────────────────────────────
   Runs the same CLI `npm run orders` runs, as a child process. server.js must
   not import the fetchers: orders-config.js exits at import time when the
   cookie is missing, and `npm start` is deliberately usable without one.
   See src/sync-job.js. */

const ordersPath = () => resolve(process.env.ORDERS_OUTPUT_FILE ?? 'orders.json');
const detailsPath = () => resolve(process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json');

// Declared before /api/sync/:command so "cancel" is not read as a command.
app.post('/api/sync/cancel', (req, res) => {
  res.json({ cancelled: syncJob.cancel() });
});

app.get('/api/sync/status', (req, res) => {
  res.json(syncJob.getStatus());
});

/**
 * Progress as it happens. The scrapers already print one ordered line per
 * order, so the UI just replays them.
 */
app.get('/api/sync/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  // A page opened mid-run needs the lines it missed before the live ones.
  send({ type: 'snapshot', ...syncJob.getStatus() });
  const off = syncJob.subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
});

app.post('/api/sync/:command', (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    res.status(202).json(syncJob.start(req.params.command, { force }));
  } catch (err) {
    if (err instanceof JobBusyError) {
      return res.status(409).json({ error: err.message, running: err.running });
    }
    if (err instanceof UnknownCommandError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Sync start error:', err);
    res.status(500).json({ error: 'Could not start the sync' });
  }
});

/**
 * Accept a pasted PHPSESSID, check it against the site, and write it to .env.
 *
 * express.json() is mounted on this route alone so every other route stays
 * exactly as it was. The value is never logged and never echoed back — a
 * failure reports `reason` from validate(), which describes the response, not
 * the id.
 */
app.post('/api/session', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const { extractSessionId, validate, saveSessionId, historyUrl } =
      await import('./src/ensure-cookie.js');

    const sessionId = extractSessionId(req.body?.sessionId);
    if (!sessionId) {
      return res.status(400).json({ ok: false, reason: 'That does not look like a PHPSESSID value.' });
    }

    const result = await validate(sessionId, await historyUrl());
    if (!result.ok) return res.status(400).json({ ok: false, reason: result.reason });

    await saveSessionId(sessionId);
    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error('Session save error:', err.message);
    res.status(500).json({ ok: false, reason: 'Could not save the session cookie.' });
  }
});

/** What is on disk and when it was last written, for a "last synced" line. */
app.get('/api/data-status', async (req, res) => {
  const describe = async (path) => {
    try {
      const [info, text] = await Promise.all([stat(path), readFile(path, 'utf-8')]);
      const parsed = JSON.parse(text);
      return {
        exists: true,
        count: Array.isArray(parsed) ? parsed.length : 0,
        modified: info.mtime.toISOString(),
      };
    } catch {
      return { exists: false, count: 0, modified: null };
    }
  };
  res.json({
    orders: await describe(ordersPath()),
    details: await describe(detailsPath()),
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`API server: http://localhost:${PORT}`);
  });
}

export default app;

