/**
 * Shared detection for an expired `PHPSESSID`.
 *
 * The site never returns an error for a dead session — it 302s to the login
 * page. axios follows redirects by default, so the login HTML arrives as a
 * perfectly ordinary 200 and cheerio simply finds none of the selectors it
 * wants. That renders as "0 item(s)" on every order, or as an empty order
 * list, and the run then writes those empty results over good data.
 *
 * Both fetchers therefore disable redirect-following and inspect the redirect
 * themselves. Measured against the live site:
 *
 *   - no/invalid PHPSESSID -> 302 to /customer/account/login/referer/<base64>
 *   - a page past the last -> 200 that silently re-serves page 1, never a 3xx
 *
 * So a redirect to the login path is the *only* thing that means "expired",
 * and it means that on any page. Anything else 3xx is left to the caller,
 * which is what keeps one unviewable order from being read as a dead session.
 */

const LOGIN_PATH = '/customer/account/login';

export class SessionExpiredError extends Error {
  constructor(url) {
    super(
      'Session expired — the site redirected to the login page.\n' +
        '\n' +
        '  Your PHPSESSID is no longer valid. To refresh it:\n' +
        '    1. Open https://www.phoenixnext.com in your browser and sign in\n' +
        '    2. DevTools → Application → Cookies → https://www.phoenixnext.com\n' +
        '    3. Copy the PHPSESSID value\n' +
        '    4. Set ORDERS_COOKIE="PHPSESSID=<value>" in .env\n' +
        '\n' +
        '  No files were written, so your existing data is untouched.'
    );
    this.name = 'SessionExpiredError';
    this.url = url;
  }
}

/** True for any 3xx. */
export function isRedirect(status) {
  return status >= 300 && status < 400;
}

/** Where a redirect points, whatever case the header arrived in. */
export function redirectTarget(response) {
  const headers = response?.headers ?? {};
  const value = typeof headers.get === 'function' ? headers.get('location') : headers.location;
  return value ?? null;
}

/**
 * True only for the bounce to the sign-in page. A 3xx to anywhere else is
 * some other condition and must not be reported as an expired cookie.
 */
export function isLoginRedirect(response) {
  if (!isRedirect(response?.status)) return false;
  return String(redirectTarget(response) ?? '').includes(LOGIN_PATH);
}

/**
 * Axios options that surface a redirect instead of transparently following it.
 * `validateStatus` keeps 3xx out of axios's own error path so the caller can
 * tell "session expired" apart from a genuine network or 4xx/5xx failure.
 */
export const NO_REDIRECT = {
  maxRedirects: 0,
  validateStatus: (status) => status < 400,
};

/**
 * Process exit code for a failed command.
 *
 * `2` is reserved for an expired session so a caller that is not a terminal —
 * `sync-job.js`, spawning this CLI for the web UI — can tell "your cookie
 * died, here is a prompt" apart from "something broke" without matching on
 * message text.
 */
export const EXIT_SESSION_EXPIRED = 2;

export function exitCodeFor(err) {
  return err instanceof SessionExpiredError ? EXIT_SESSION_EXPIRED : 1;
}

/** Throw if `response` is the login redirect. Any other status passes through. */
export function assertSession(response, url) {
  if (isLoginRedirect(response)) throw new SessionExpiredError(url);
  return response;
}
