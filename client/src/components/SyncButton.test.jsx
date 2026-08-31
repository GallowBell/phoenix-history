// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import SyncButton from './SyncButton.jsx';

// jsdom has no EventSource; this stand-in lets a test push server events.
let sockets = [];
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.closed = false;
    sockets.push(this);
  }
  close() { this.closed = true; }
  emit(event) { act(() => this.onmessage?.({ data: JSON.stringify(event) })); }
}

const lastSocket = () => sockets[sockets.length - 1];
// Count only sync starts: the component also polls /api/data-status.
const syncCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/sync/'));
const syncBtn = () => screen.getByRole('button', { name: /^sync$/i });

beforeEach(() => {
  sockets = [];
  global.EventSource = FakeEventSource;
  global.fetch = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ status: 'running' }) }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SyncButton', () => {
  it('offers a sync when idle', () => {
    render(<SyncButton />);
    expect(syncBtn()).toBeTruthy();
  });

  it('runs orders first, then order-details — they cannot overlap', async () => {
    const onSynced = vi.fn();
    render(<SyncButton onSynced={onSynced} />);
    fireEvent.click(syncBtn());

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sync/orders', { method: 'POST' }));
    expect(syncCalls()).toHaveLength(1);

    lastSocket().emit({ type: 'status', status: 'done' });
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/sync/order-details', { method: 'POST' }));

    lastSocket().emit({ type: 'status', status: 'done' });
    await waitFor(() => expect(onSynced).toHaveBeenCalled());
  });

  it('stops the sequence when the first command fails', async () => {
    const onSynced = vi.fn();
    render(<SyncButton onSynced={onSynced} />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(syncCalls()).toHaveLength(1));

    lastSocket().emit({ type: 'status', status: 'failed' });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(syncCalls()).toHaveLength(1);
    expect(onSynced).not.toHaveBeenCalled();
  });

  it('shows progress lines as they arrive', async () => {
    render(<SyncButton />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    lastSocket().emit({ type: 'line', text: '[12/103] order 457973 → 3 item(s)' });
    await waitFor(() => expect(screen.getByText(/\[12\/103\]/)).toBeTruthy());
  });

  it('asks for a new cookie when the session expired, instead of just failing', async () => {
    render(<SyncButton />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    lastSocket().emit({ type: 'status', status: 'expired' });

    await waitFor(() => expect(screen.getByLabelText(/phpsessid/i)).toBeTruthy());
    expect(screen.getByLabelText(/phpsessid/i).type).toBe('password');
  });

  it('saves a validated cookie and resumes the sync', async () => {
    render(<SyncButton />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    lastSocket().emit({ type: 'status', status: 'expired' });
    await waitFor(() => expect(screen.getByLabelText(/phpsessid/i)).toBeTruthy());

    global.fetch.mockClear();
    global.fetch.mockImplementation(async (url) => url === '/api/session'
      ? { ok: true, status: 200, json: async () => ({ ok: true, rows: 50 }) }
      : { ok: true, status: 202, json: async () => ({ status: 'running' }) });

    fireEvent.change(screen.getByLabelText(/phpsessid/i), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })));
    // The sync picks up from the command that was interrupted, not from scratch.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sync/orders', { method: 'POST' }));
  });

  it('keeps the cookie form open and reports why when the site rejects the id', async () => {
    render(<SyncButton />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    lastSocket().emit({ type: 'status', status: 'expired' });
    await waitFor(() => expect(screen.getByLabelText(/phpsessid/i)).toBeTruthy());

    global.fetch.mockImplementation(async () => ({
      ok: false, status: 400, json: async () => ({ ok: false, reason: 'HTTP 302 (redirected to login)' }),
    }));
    fireEvent.change(screen.getByLabelText(/phpsessid/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/302/)).toBeTruthy());
    expect(screen.getByLabelText(/phpsessid/i)).toBeTruthy();
  });

  it('reports a sync already running rather than starting a second', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ error: 'busy', running: 'orders' }),
    }));
    render(<SyncButton />);
    fireEvent.click(syncBtn());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already running/i));
  });

  it('passes --force only when the box is ticked', async () => {
    render(<SyncButton />);
    fireEvent.click(screen.getByLabelText(/full re-scrape/i));
    fireEvent.click(syncBtn());
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/sync/orders?force=1', { method: 'POST' }));
  });

  it('says how old the data on disk is', async () => {
    global.fetch = vi.fn(async (url) => url === '/api/data-status'
      ? { ok: true, status: 200, json: async () => ({
          orders: { exists: true, count: 103, modified: new Date().toISOString() },
          details: { exists: true, count: 103, modified: new Date().toISOString() },
        }) }
      : { ok: true, status: 202, json: async () => ({ status: 'running' }) });

    render(<SyncButton />);
    await waitFor(() => expect(screen.getByText(/103 orders/)).toBeTruthy());
  });

  it('closes the event stream when unmounted', () => {
    const { unmount } = render(<SyncButton />);
    const socket = lastSocket();
    expect(socket.closed).toBe(false);
    unmount();
    expect(socket.closed).toBe(true);
  });
});
