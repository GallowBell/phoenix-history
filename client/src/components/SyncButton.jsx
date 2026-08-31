import { useCallback, useEffect, useRef, useState } from 'react';

/** How long ago the file was written, in the coarsest useful unit. */
function ago(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** orders first: fetch-order-details consumes what fetch-orders writes. */
const SEQUENCE = ['orders', 'order-details'];
const MAX_LINES = 6;

const LABELS = {
  orders: 'order list',
  'order-details': 'order details',
};

/**
 * Runs the scrape from the browser.
 *
 * The server spawns the same CLI `npm run orders` runs, so this is a remote
 * control for it rather than a second implementation. Progress arrives over
 * SSE; the sequence is driven here because the two commands cannot overlap.
 *
 * An expired PHPSESSID is the common case — it dies in about a day — so it is
 * a first-class state with a form, not an error message.
 */
export default function SyncButton({ onSynced }) {
  const [status, setStatus] = useState('idle');
  const [command, setCommand] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [force, setForce] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [disk, setDisk] = useState(null);

  // Which command was interrupted, so a cookie refresh can resume from it
  // rather than re-running the ones that already succeeded.
  const resumeAt = useRef(0);
  const endWaiter = useRef(null);

  const refreshDisk = useCallback(async () => {
    try {
      const response = await fetch('/api/data-status');
      if (response.ok) setDisk(await response.json());
    } catch {
      // A freshness line is not worth surfacing an error for.
    }
  }, []);

  useEffect(() => { refreshDisk(); }, [refreshDisk]);

  useEffect(() => {
    const source = new EventSource('/api/sync/stream');
    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === 'line') {
        setLines((prev) => [...prev, event.text].slice(-MAX_LINES));
        return;
      }
      if (event.type === 'snapshot') {
        setStatus(event.status);
        setCommand(event.command ?? null);
        setLines((event.lines ?? []).slice(-MAX_LINES));
        return;
      }
      if (event.type === 'status') {
        setStatus(event.status);
        if (event.command) setCommand(event.command);
        if (event.status !== 'running') {
          const done = endWaiter.current;
          endWaiter.current = null;
          done?.(event.status);
        }
      }
    };
    return () => source.close();
  }, []);

  const runFrom = useCallback(async (startIndex) => {
    setError(null);
    for (let i = startIndex; i < SEQUENCE.length; i++) {
      const name = SEQUENCE[i];
      resumeAt.current = i;
      setCommand(name);
      setLines([]);

      // Registered before the POST: a command that fails instantly would
      // otherwise emit its terminal status before anything was listening.
      const ended = new Promise((resolve) => { endWaiter.current = resolve; });

      const response = await fetch(`/api/sync/${name}${force ? '?force=1' : ''}`, { method: 'POST' });
      if (!response.ok) {
        endWaiter.current = null;
        const body = await response.json().catch(() => ({}));
        setStatus('idle');
        setError(response.status === 409
          ? `A sync is already running (${body.running ?? 'unknown'}).`
          : body.error ?? 'Could not start the sync.');
        return;
      }

      setStatus('running');
      const outcome = await ended;
      // expired / failed / cancelled all stop here: the next command reads the
      // file this one was supposed to write.
      if (outcome !== 'done') return;
    }
    await onSynced?.();
    await refreshDisk();
  }, [force, onSynced, refreshDisk]);

  const saveCookie = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        setError(body.reason ?? 'That cookie was not accepted.');
        return;
      }
      setSessionId('');
      setStatus('idle');
      await runFrom(resumeAt.current);
    } finally {
      setSaving(false);
    }
  };

  const running = status === 'running';

  return (
    <div className="sync">
      {status === 'expired' ? (
        <form
          className="sync-cookie"
          onSubmit={(e) => { e.preventDefault(); saveCookie(); }}
        >
          <label className="sync-cookie-label" htmlFor="sync-session">
            Session expired — paste PHPSESSID
          </label>
          <input
            id="sync-session"
            type="password"
            className="sync-cookie-input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="DevTools → Application → Cookies"
            autoComplete="off"
          />
          <button type="submit" className="btn-sync" disabled={!sessionId || saving}>
            {saving ? 'Checking…' : 'Save & retry'}
          </button>
          <button type="button" className="sync-cancel" onClick={() => setStatus('idle')}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <label className="sync-force" title="Ignore the cache and re-scrape everything">
            <input
              type="checkbox"
              checked={force}
              disabled={running}
              onChange={(e) => setForce(e.target.checked)}
            />
            Full re-scrape
          </label>
          <button
            type="button"
            className="btn-sync"
            onClick={() => runFrom(0)}
            disabled={running}
          >
            {running ? `Syncing ${LABELS[command] ?? ''}…` : 'Sync'}
          </button>
          {running && (
            <button
              type="button"
              className="sync-cancel"
              onClick={() => fetch('/api/sync/cancel', { method: 'POST' })}
            >
              Cancel
            </button>
          )}
        </>
      )}

      {!running && status !== 'expired' && disk?.orders?.exists && (
        <span className="sync-age" title={`Last written ${new Date(disk.orders.modified).toLocaleString()}`}>
          {disk.orders.count} orders · {ago(disk.orders.modified)}
        </span>
      )}
      {running && lines.length > 0 && (
        <span className="sync-line" title={lines.join('\n')}>{lines.at(-1)}</span>
      )}
      {error && <span className="sync-error" role="alert">{error}</span>}
      {status === 'failed' && !error && (
        <span className="sync-error" role="alert">
          The sync failed — see the terminal running the server for details.
        </span>
      )}
    </div>
  );
}
