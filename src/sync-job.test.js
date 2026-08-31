import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { createSyncJob, JobBusyError, UnknownCommandError } from './sync-job.js';

const SCRIPT = fileURLToPath(new URL('../tests/fixtures/fake-scrape.mjs', import.meta.url));

// envFile: null keeps `--env-file` off the argv, so these never depend on .env.
const makeJob = (over = {}) => createSyncJob({
  script: SCRIPT,
  envFile: null,
  commands: new Set(['ok', 'expired', 'fail', 'noisy', 'slow']),
  ...over,
});

describe('createSyncJob', () => {
  it('starts idle', () => {
    expect(makeJob().getStatus().status).toBe('idle');
  });

  it('captures the child output line by line', async () => {
    const job = makeJob();
    job.start('ok');
    const final = await job.finished();
    expect(final.status).toBe('done');
    expect(final.lines).toEqual([
      'Fetching page 1…',
      'Page 1: 50 orders',
      'Wrote 103 orders to orders.json',
    ]);
  });

  it('reports an expired session distinctly from any other failure', async () => {
    const expired = makeJob();
    expired.start('expired');
    expect((await expired.finished()).status).toBe('expired');

    const broke = makeJob();
    broke.start('fail');
    const final = await broke.finished();
    expect(final.status).toBe('failed');
    expect(final.exitCode).toBe(1);
  });

  it('refuses a second job while one is running', async () => {
    // fetch-order-details consumes the output of fetch-orders, so the two must
    // never overlap; one job at a time is what enforces that.
    const job = makeJob();
    job.start('slow');
    expect(() => job.start('ok')).toThrow(JobBusyError);
    job.cancel();
    await job.finished();
  });

  it('refuses a command that is not on the allowlist, without spawning', () => {
    const job = makeJob({ spawnFn: () => { throw new Error('must not spawn'); } });
    expect(() => job.start('rm -rf /')).toThrow(UnknownCommandError);
    expect(job.getStatus().status).toBe('idle');
  });

  it('passes --force through when asked', async () => {
    const job = makeJob();
    job.start('ok', { force: true });
    const final = await job.finished();
    expect(final.lines).toContain('Page 1: 50 orders (forced)');
  });

  it('cancels a running job', async () => {
    const job = makeJob();
    job.start('slow');
    job.cancel();
    const final = await job.finished();
    expect(final.status).toBe('cancelled');
  });

  it('caps the line buffer so a long run cannot grow without bound', async () => {
    const job = makeJob({ maxLines: 10 });
    job.start('noisy');
    const final = await job.finished();
    expect(final.lines).toHaveLength(10);
    // The cap keeps the newest lines: the tail is what a progress view wants.
    expect(final.lines.at(-1)).toBe('[40/40] order 1040 → 2 item(s)');
  });

  it('notifies subscribers of each line and of the terminal status', async () => {
    const job = makeJob();
    const seen = [];
    const off = job.subscribe((e) => seen.push(e));
    job.start('ok');
    await job.finished();
    off();

    expect(seen.filter((e) => e.type === 'line').map((e) => e.text)).toContain('Fetching page 1…');
    const last = seen.at(-1);
    expect(last).toMatchObject({ type: 'status', status: 'done' });
  });

  it('stops notifying after unsubscribe', async () => {
    const job = makeJob();
    const seen = [];
    job.subscribe((e) => seen.push(e))();
    job.start('ok');
    await job.finished();
    expect(seen).toEqual([]);
  });

  it('can run again after finishing', async () => {
    const job = makeJob();
    job.start('ok');
    await job.finished();
    job.start('ok');
    expect((await job.finished()).status).toBe('done');
  });
});
