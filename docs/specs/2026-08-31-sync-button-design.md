# Sync button — run the scrapers from the web UI

**Status:** implemented (`feat/sync-button`)

One deviation from the plan below: the empty states on the tabs point at the
Sync button in the header rather than each rendering their own button. Giving
three components a real trigger would mean lifting SyncButton's whole run state
into App, which is not worth the coupling when the button is visible above.
**Date:** 2026-08-31

## Goal

Refresh `orders.json` and `orders-details.json` from the browser, instead of
dropping to a terminal for `npm run orders` && `npm run order-details`. Cover
the two cases that send you back to the terminal today:

1. the data is stale, or the files do not exist yet (both tabs currently just
   print "run: npm run orders");
2. **the `PHPSESSID` has expired** — which, given it dies in about a day, is the
   case you hit most mornings.

## The constraint that shapes everything

**`server.js` must not import the scrapers.** `src/orders-config.js` calls
`process.exit(1)` at *import* time when `ORDERS_COOKIE` is missing, and CLAUDE.md
records that `npm start` deliberately needs no cookie so existing data stays
browsable in Docker or CI. An in-process sync would inherit that exit and take
the API server down for exactly those users.

So the button spawns the existing CLI as a child process. That also buys:

- every guard already in the pipeline (empty-overwrite refusal, the merge
  shrink check, the details cache) with no reimplementation;
- progress lines on stdout, already ordered by `createOrderedLog`;
- a killable job, and a `cwd` and env we control.

## Design

### 1. `src/sync-job.js` — one job at a time

A module-level singleton:

```js
{ id, command, status, startedAt, endedAt, lines: [], exitCode }
// status: 'idle' | 'running' | 'done' | 'failed' | 'expired' | 'cancelled'
```

- `start(command)` → `spawn(process.execPath, ['--env-file=.env', 'src/index.js', command], { cwd: ROOT })`.
  **No shell**, argv array, and `command` is checked against a hardcoded
  `Set(['orders', 'order-details'])` before it is used.
- A second `start()` while `running` throws `JobBusyError` → the route answers
  409. This also enforces the documented rule that `fetch-order-details` cannot
  run concurrently with `fetch-orders`, since it consumes its output file.
- stdout/stderr are split into lines and appended to a capped ring buffer
  (~500 lines) so a long run cannot grow without bound.
- `cancel()` sends SIGTERM. **This is safe by construction:** both fetchers
  build their whole result in memory and call `writeFile` once at the very end,
  so a cancel before that point leaves the existing JSON untouched.

### 2. `src/index.js` — a distinct exit code for expiry

```js
await runWithCookieRetry().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(err instanceof SessionExpiredError ? 2 : 1);
});
```

The child has no TTY, so `runWithCookieRetry` already skips the prompt and
rethrows. Exit 2 lets the server tell "expired" from "broke" without matching on
message text.

### 3. Routes

| Route | Behaviour |
|---|---|
| `POST /api/sync/:command` | start `orders` or `order-details`; 409 when busy; 400 otherwise |
| `POST /api/sync/cancel` | SIGTERM the running job |
| `GET /api/sync/stream` | SSE — one event per progress line, then a terminal status event |
| `GET /api/sync/status` | one-shot snapshot, for a page opened mid-run |
| `POST /api/session` | `{ sessionId }` → `extractSessionId` → `validate` → `upsertCookie` → write `.env` |
| `GET /api/data-status` | mtime + record count for both JSON files, for a "last synced" line |

`express.json()` is mounted **only** on `/api/session`, leaving every existing
route byte-for-byte as it is.

`/api/session` must never log its body, and returns only `{ ok, rows }` or
`{ ok: false, reason }` — `validate()` already reports a reason without echoing
the value.

### 4. UI

- `SyncButton` in the header, beside Download Excel.
  - idle → `Sync`; running → progress + the latest line + `Cancel`.
- **`orders` then `order-details`, sequentially** — one press does the full
  refresh, because they cannot run concurrently and the second consumes the
  first's output.
- A `Force full re-scrape` checkbox passes `--force` to both.
- On `expired`: an inline `<input type="password">` with the DevTools steps,
  and `Save & retry` → `POST /api/session` → on success, resume the sync
  automatically.
- On `done`: re-fetch `/api/orders` and `/api/order-details` and update state.
  No page reload, so the active tab, filters and search survive.
- The 404 empty states on both tabs get a Sync button instead of the current
  "run: npm run orders" text.

### 5. Testing

- `sync-job.test.js` — spawn a trivial child (`node -e`); assert the busy 409,
  line capture, cancel, and the exit-code → status mapping. No network.
- Route tests via supertest with `sync-job.js` mocked, matching how the existing
  server tests mock `fs/promises`.
- `SyncButton.test.jsx` (jsdom) — idle → running → expired → prompt → done, with
  a stubbed EventSource.
- Manual, against the live site: one run with a valid cookie, one with a
  deliberately corrupted `PHPSESSID` to exercise the prompt path end to end.

## Risks and open points

- **A credential now crosses HTTP.** Localhost-only, and the value already sits
  in `.env` as plain text — but it will appear in browser devtools. Accepted
  deliberately (see the decision above); worth revisiting if the server is ever
  bound to anything but `127.0.0.1`.
- `.env` could be written by the UI while a CLI run is in flight. Single-user
  tool; not guarded.
- SSE holds a connection open; the client must close it on unmount or a
  long-lived tab will leak one per remount.
- `npm start` runs the API and Vite together, so the child is a grandchild of
  `concurrently`. Cancel must signal the child directly, not the process group.

## Out of scope

- Scheduling or auto-sync on load. The button is manual.
- Any write path to the site. Everything stays read-only GETs.
