import { describe, it, expect } from 'vitest';
import {
  SessionExpiredError,
  exitCodeFor,
  EXIT_SESSION_EXPIRED,
  isRedirect,
  isLoginRedirect,
  redirectTarget,
  assertSession,
  NO_REDIRECT,
} from './session.js';

// The real header, captured from the live site with an invalid PHPSESSID.
const LOGIN = 'https://www.phoenixnext.com/customer/account/login/referer/aHR0cHM6Ly8=/';
const res = (status, location) => ({ status, headers: location ? { location } : {} });

describe('isRedirect', () => {
  it('is true across the 3xx range', () => {
    expect(isRedirect(301)).toBe(true);
    expect(isRedirect(302)).toBe(true);
    expect(isRedirect(399)).toBe(true);
  });

  it('is false for success and error statuses', () => {
    expect(isRedirect(200)).toBe(false);
    expect(isRedirect(299)).toBe(false);
    expect(isRedirect(400)).toBe(false);
    expect(isRedirect(500)).toBe(false);
  });
});

describe('redirectTarget', () => {
  it('reads a plain axios headers object', () => {
    expect(redirectTarget(res(302, LOGIN))).toBe(LOGIN);
  });

  it('reads a fetch-style Headers object', () => {
    const response = { status: 302, headers: { get: (k) => (k === 'location' ? LOGIN : null) } };
    expect(redirectTarget(response)).toBe(LOGIN);
  });

  it('returns null when there is no location', () => {
    expect(redirectTarget(res(302))).toBe(null);
    expect(redirectTarget(undefined)).toBe(null);
  });
});

describe('isLoginRedirect', () => {
  it('recognises the sign-in bounce', () => {
    expect(isLoginRedirect(res(302, LOGIN))).toBe(true);
  });

  it('ignores a 3xx pointing anywhere else', () => {
    // An order that is not viewable redirects to the history page, not login.
    expect(isLoginRedirect(res(302, 'https://www.phoenixnext.com/sales/order/history/'))).toBe(false);
  });

  it('ignores a 3xx with no location header', () => {
    expect(isLoginRedirect(res(302))).toBe(false);
  });

  it('ignores a 200, even one whose body is the login page', () => {
    expect(isLoginRedirect(res(200, LOGIN))).toBe(false);
  });
});

describe('assertSession', () => {
  it('throws SessionExpiredError on the login redirect', () => {
    expect(() => assertSession(res(302, LOGIN), 'https://x/1')).toThrow(SessionExpiredError);
  });

  it('does NOT throw for a redirect elsewhere — one odd order is not a dead session', () => {
    expect(() => assertSession(res(302, 'https://x/sales/order/history/'), 'https://x/1')).not.toThrow();
  });

  it('passes a 200 straight through', () => {
    const r = res(200);
    expect(assertSession(r, 'https://x')).toBe(r);
  });

  it('records the URL that redirected', () => {
    try {
      assertSession(res(302, LOGIN), 'https://x/order/1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.url).toBe('https://x/order/1');
    }
  });

  it('explains how to refresh the cookie', () => {
    const err = new SessionExpiredError('https://x');
    expect(err.message).toMatch(/PHPSESSID/);
    expect(err.message).toMatch(/ORDERS_COOKIE/);
    expect(err.message).toMatch(/No files were written/);
  });
});

describe('NO_REDIRECT', () => {
  it('stops axios from following the login redirect', () => {
    expect(NO_REDIRECT.maxRedirects).toBe(0);
  });

  it('keeps 3xx out of axios’s error path so it can be inspected', () => {
    expect(NO_REDIRECT.validateStatus(302)).toBe(true);
    expect(NO_REDIRECT.validateStatus(200)).toBe(true);
  });

  it('still lets genuine 4xx/5xx failures throw', () => {
    expect(NO_REDIRECT.validateStatus(404)).toBe(false);
    expect(NO_REDIRECT.validateStatus(500)).toBe(false);
  });
});

describe('exitCodeFor', () => {
  it('reserves 2 for an expired session so a non-TTY caller can tell them apart', () => {
    expect(exitCodeFor(new SessionExpiredError('https://example.com'))).toBe(EXIT_SESSION_EXPIRED);
    expect(EXIT_SESSION_EXPIRED).toBe(2);
  });

  it('uses 1 for every other failure', () => {
    expect(exitCodeFor(new Error('network down'))).toBe(1);
    expect(exitCodeFor(new TypeError('bad selector'))).toBe(1);
  });
});
