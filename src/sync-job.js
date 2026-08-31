/**
 * Runs a scrape command for the web UI, one at a time.
 *
 * **Why a child process and not a direct import.** `orders-config.js` calls
 * `process.exit(1)` at import time when `ORDERS_COOKIE` is missing, and
 * `npm start` is deliberately usable without a cookie so existing data stays
 * browsable. Importing the fetchers into `server.js` would inherit that exit
 * and take the API down for exactly those users. Spawning the same CLI that
 * `npm run orders` runs also inherits every guard already in the pipeline —
 * the empty-overwrite refusal, the merge shrink check, the details cache —
 * rather than reimplementing them behind an HTTP route.
 *
 * Cancelling is safe by construction: both fetchers build their whole result
 * in memory and call `writeFile` once at the end, so a signal before that
 * point leaves the JSON on disk untouched.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The only commands this may run. Never interpolated into a shell. */
export const SYNC_COMMANDS = new Set(['orders', 'order-details']);

export class JobBusyError extends Error {
  constructor(running) {
    super(`A sync is already running: ${running}`);
    this.name = 'JobBusyError';
    this.running = running;
  }
}

export class UnknownCommandError extends Error {
  constructor(command) {
    super(`Not a sync command: ${command}`);
    this.name = 'UnknownCommandError';
  }
}

/** `src/index.js` exits 2 for an expired session — see its catch block. */
const EXPIRED_EXIT = 2;

export function createSyncJob({
  spawnFn = spawn,
  node = process.execPath,
  script = 'src/index.js',
  envFile = '.env',
  cwd = ROOT,
  commands = SYNC_COMMANDS,
  maxLines = 500,
  // A full re-scrape of ~100 orders takes about 90s. Ten minutes is generous
  // for the slowest real run and still bounded: without a ceiling, one child
  // that never returns leaves the job 'running' and answers 409 to every
  // later sync until the server is restarted.
  timeoutMs = 10 * 60 * 1000,
} = {}) {
  let state = { id: 0, command: null, status: 'idle', startedAt: null, endedAt: null, exitCode: null, lines: [] };
  let child = null;
  let cancelled = false;
  let settle = null;
  let pending = null;
  let settled = true;
  let timer = null;
  const listeners = new Set();

  const emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };

  const snapshot = () => ({ ...state, lines: [...state.lines] });

  const pushLine = (text) => {
    state.lines.push(text);
    // Keep the tail: a progress view wants the newest lines, and an unbounded
    // buffer would grow with every order on a long run.
    if (state.lines.length > maxLines) state.lines.splice(0, state.lines.length - maxLines);
    emit({ type: 'line', text });
  };

  /** Split a chunked stream into whole lines; stdout arrives mid-line. */
  const lineReader = () => {
    let buffer = '';
    return {
      push(chunk) {
        buffer += chunk;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) if (line.trim()) pushLine(line);
      },
      flush() {
        if (buffer.trim()) pushLine(buffer);
        buffer = '';
      },
    };
  };

  const finish = (status, exitCode) => {
    // A failed spawn emits 'error' *and* 'close'; without this a single run
    // would report a terminal status twice.
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    timer = null;
    state.status = status;
    state.exitCode = exitCode;
    state.endedAt = Date.now();
    child = null;
    emit({ type: 'status', status, exitCode, id: state.id });
    const done = settle;
    settle = null;
    pending = null;
    done?.(snapshot());
  };

  return {
    getStatus: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Resolves with the final snapshot; resolves immediately when idle. */
    finished() {
      return pending ?? Promise.resolve(snapshot());
    },

    start(command, { force = false } = {}) {
      if (!commands.has(command)) throw new UnknownCommandError(command);
      if (state.status === 'running') throw new JobBusyError(state.command);

      cancelled = false;
      settled = false;
      state = {
        id: state.id + 1,
        command,
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        exitCode: null,
        lines: [],
      };
      pending = new Promise((resolve) => { settle = resolve; });

      const args = [
        ...(envFile ? [`--env-file=${envFile}`] : []),
        script,
        command,
        ...(force ? ['--force'] : []),
      ];
      child = spawnFn(node, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

      const out = lineReader();
      const err = lineReader();
      child.stdout?.setEncoding('utf-8');
      child.stderr?.setEncoding('utf-8');
      child.stdout?.on('data', (c) => out.push(c));
      child.stderr?.on('data', (c) => err.push(c));

      child.on('error', (e) => {
        pushLine(`Could not start the sync: ${e.message}`);
        finish('failed', null);
      });

      child.on('close', (code) => {
        out.flush();
        err.flush();
        if (cancelled) return finish('cancelled', code);
        if (code === 0) return finish('done', code);
        if (code === EXPIRED_EXIT) return finish('expired', code);
        finish('failed', code);
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          pushLine(`Sync timed out after ${Math.round(timeoutMs / 1000)}s — stopping it.`);
          child?.kill('SIGTERM');
          finish('failed', null);
        }, timeoutMs);
        timer.unref?.();
      }

      emit({ type: 'status', status: 'running', command, id: state.id });
      return snapshot();
    },

    cancel() {
      if (state.status !== 'running' || !child) return false;
      cancelled = true;
      // Signal the child itself, not the process group: under `npm start` this
      // runs as a grandchild of concurrently, and killing the group would take
      // the dev server down with it.
      child.kill('SIGTERM');
      return true;
    },
  };
}

export const syncJob = createSyncJob();
