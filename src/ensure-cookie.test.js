import { describe, it, expect, vi } from 'vitest';
import {
  readCookie,
  hasUsableCookie,
  extractSessionId,
  upsertCookie,
  resolveSessionId,
  askOnce,
} from './ensure-cookie.js';
import { createInterface } from 'readline/promises';
import { Readable, Writable } from 'stream';

const SID = 'abcdef0123456789abcdef0123';
const silent = { error: () => {}, log: () => {} };

describe('ensure-cookie readCookie', () => {
  it('reads a quoted value', () => {
    expect(readCookie(`ORDERS_COOKIE="PHPSESSID=${SID}"`)).toBe(`PHPSESSID=${SID}`);
  });

  it('returns null when the key is absent', () => {
    expect(readCookie('ORDERS_URL="https://example.test"')).toBeNull();
  });

  it('ignores a commented-out assignment', () => {
    expect(readCookie(`#ORDERS_COOKIE="PHPSESSID=${SID}"`)).toBeNull();
  });
});

describe('ensure-cookie hasUsableCookie', () => {
  it('accepts a real-looking cookie', () => {
    expect(hasUsableCookie(`ORDERS_COOKIE="PHPSESSID=${SID}"`)).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(hasUsableCookie('')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(hasUsableCookie('ORDERS_COOKIE=""')).toBe(false);
  });

  it('rejects the .env.example placeholder', () => {
    expect(hasUsableCookie('ORDERS_COOKIE="PHPSESSID=your_session_id_here"')).toBe(false);
  });

  it('rejects a value with no PHPSESSID in it', () => {
    expect(hasUsableCookie('ORDERS_COOKIE="_ga=GA1.2.3; _hjSession=xyz"')).toBe(false);
  });

  it('accepts PHPSESSID buried in a full cookie header', () => {
    expect(hasUsableCookie(`ORDERS_COOKIE="_ga=GA1.2.3; PHPSESSID=${SID}; _gcl_au=1"`)).toBe(true);
  });
});

describe('ensure-cookie extractSessionId', () => {
  it('takes a bare session id', () => {
    expect(extractSessionId(SID)).toBe(SID);
  });

  it('takes a PHPSESSID=... pair', () => {
    expect(extractSessionId(`PHPSESSID=${SID}`)).toBe(SID);
  });

  it('pulls it out of a whole cookie header', () => {
    expect(extractSessionId(`_ga=GA1.2.3; PHPSESSID=${SID}; _gcl_au=1.2`)).toBe(SID);
  });

  it('strips a leading "cookie:" prefix copied from DevTools', () => {
    expect(extractSessionId(`cookie: PHPSESSID=${SID}; _ga=1`)).toBe(SID);
  });

  it('trims surrounding whitespace', () => {
    expect(extractSessionId(`  ${SID}  `)).toBe(SID);
  });

  it('rejects text with no session id', () => {
    expect(extractSessionId('hello world')).toBeNull();
    expect(extractSessionId('')).toBeNull();
    expect(extractSessionId(null)).toBeNull();
  });

  it('rejects a value too short to be a session id', () => {
    expect(extractSessionId('abc123')).toBeNull();
  });
});

describe('ensure-cookie upsertCookie', () => {
  it('replaces an existing assignment in place', () => {
    const env = 'ORDERS_URL="u"\nORDERS_COOKIE="PHPSESSID=old"\nSERVER_PORT=3001\n';
    const out = upsertCookie(env, SID);
    expect(out).toContain(`ORDERS_COOKIE="PHPSESSID=${SID}"`);
    expect(out).not.toContain('old');
    expect(out).toContain('SERVER_PORT=3001');
  });

  it('appends when the key is missing', () => {
    const out = upsertCookie('ORDERS_URL="u"\n', SID);
    expect(out).toBe(`ORDERS_URL="u"\nORDERS_COOKIE="PHPSESSID=${SID}"\n`);
  });

  it('leaves a commented-out old cookie alone', () => {
    const env = '#ORDERS_COOKIE="PHPSESSID=stale"\nORDERS_COOKIE="PHPSESSID=old"\n';
    const out = upsertCookie(env, SID);
    expect(out).toContain('#ORDERS_COOKIE="PHPSESSID=stale"');
    expect(out).not.toContain('"PHPSESSID=old"');
  });

  it('preserves CRLF line endings', () => {
    const out = upsertCookie('ORDERS_URL="u"\r\nORDERS_COOKIE="PHPSESSID=old"\r\n', SID);
    expect(out).toContain('\r\n');
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it('writes into an empty file', () => {
    expect(upsertCookie('', SID)).toBe(`ORDERS_COOKIE="PHPSESSID=${SID}"\n`);
  });
});

describe('ensure-cookie resolveSessionId', () => {
  it('returns the id on a first-try success', async () => {
    const ask = vi.fn().mockResolvedValue(SID);
    const check = vi.fn().mockResolvedValue({ ok: true, rows: 50 });

    await expect(resolveSessionId({ ask, check, out: silent })).resolves.toEqual({
      sessionId: SID,
      rows: 50,
    });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('re-asks without validating when the paste has no session id', async () => {
    const ask = vi.fn().mockResolvedValueOnce('garbage').mockResolvedValueOnce(SID);
    const check = vi.fn().mockResolvedValue({ ok: true, rows: 1 });

    await resolveSessionId({ ask, check, out: silent });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('re-asks when validation rejects the cookie', async () => {
    const ask = vi.fn().mockResolvedValue(SID);
    const check = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'HTTP 302' })
      .mockResolvedValueOnce({ ok: true, rows: 3 });

    const result = await resolveSessionId({ ask, check, out: silent });
    expect(result.rows).toBe(3);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt limit', async () => {
    const ask = vi.fn().mockResolvedValue(SID);
    const check = vi.fn().mockResolvedValue({ ok: false, reason: 'HTTP 302' });

    await expect(resolveSessionId({ ask, check, attempts: 3, out: silent })).resolves.toBeNull();
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('treats a thrown network error as a failed attempt', async () => {
    const ask = vi.fn().mockResolvedValue(SID);
    const check = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(resolveSessionId({ ask, check, attempts: 2, out: silent })).resolves.toBeNull();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('bails out instead of looping when the input stream closes', async () => {
    const ask = vi.fn().mockResolvedValue(null);
    const check = vi.fn();

    await expect(resolveSessionId({ ask, check, out: silent })).resolves.toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
  });
});

// --- Regressions from code review ---

describe('ensure-cookie readCookie (review regressions)', () => {
  it('stops at the closing quote instead of running to end of line', () => {
    expect(readCookie(`ORDERS_COOKIE="PHPSESSID=${SID}" # a note`)).toBe(`PHPSESSID=${SID}`);
  });

  it('drops a trailing comment on an unquoted value', () => {
    expect(readCookie(`ORDERS_COOKIE=PHPSESSID=${SID} # a note`)).toBe(`PHPSESSID=${SID}`);
  });

  it('treats a value that is only a comment as empty', () => {
    expect(readCookie('ORDERS_COOKIE= # paste PHPSESSID=here')).toBe('');
  });
});

describe('ensure-cookie hasUsableCookie (review regressions)', () => {
  // The README tells users to blank ORDERS_COOKIE to re-trigger the prompt.
  // A leftover note mentioning PHPSESSID must not read as a real cookie.
  it('rejects a blanked value whose comment mentions PHPSESSID', () => {
    expect(hasUsableCookie('ORDERS_COOKIE="" # was PHPSESSID=oldvalue123456789')).toBe(false);
  });

  it('rejects an empty value followed by an instructional comment', () => {
    expect(hasUsableCookie('ORDERS_COOKIE= # paste PHPSESSID=here')).toBe(false);
  });
});

describe('ensure-cookie upsertCookie (review regressions)', () => {
  it('writes a session id containing replacement patterns literally', () => {
    const weird = 'aaa$&bbb$1ccc$`ddd';
    const out = upsertCookie('ORDERS_URL="u"\nORDERS_COOKIE="PHPSESSID=old"\n', weird);
    expect(out).toContain(`ORDERS_COOKIE="PHPSESSID=${weird}"`);
    expect(out).not.toContain('old');
    expect(readCookie(out)).toBe(`PHPSESSID=${weird}`);
  });
});

describe('ensure-cookie askOnce', () => {
  const makeRl = () => {
    const input = new Readable({ read() { this.push(null); } });
    const output = new Writable({ write(c, e, cb) { cb(); } });
    return createInterface({ input, output });
  };

  // readline/promises leaves question() pending forever on EOF; without the
  // close listener this hangs the process instead of reaching the give-up path.
  it('resolves null when the input stream closes (Ctrl-D)', async () => {
    const rl = makeRl();
    const answer = await Promise.race([
      askOnce(rl, 'q: '),
      new Promise((r) => setTimeout(() => r('TIMED-OUT'), 2000)),
    ]);
    rl.close();
    expect(answer).toBeNull();
  });
});
