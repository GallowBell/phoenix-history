/**
 * Reading the cookie out of `.env` text — split from `ensure-cookie.js`, which
 * re-exports both, because that module imports axios and cheerio: loading
 * those off /mnt/c takes ~8s, and `sync-job.js` (imported by `server.js` and
 * the MCP server at startup) needs only these two pure functions.
 */

// Values shipped in .env.example — present, but not a real cookie.
const PLACEHOLDERS = ['your_session_id_here', 'your_cookie_string_here'];

/**
 * Read the active (uncommented) ORDERS_COOKIE assignment from .env text.
 * Stops at the closing quote, and drops a trailing `# comment` on an unquoted
 * value — otherwise `ORDERS_COOKIE="" # was PHPSESSID=old` reads as a cookie.
 */
export function readCookie(envText) {
  const line = envText.match(/^ORDERS_COOKIE[ \t]*=[ \t]*(.*)$/m);
  if (!line) return null;

  const value = line[1].trim();
  for (const quote of ['"', "'"]) {
    if (value.startsWith(quote)) {
      const end = value.indexOf(quote, 1);
      return end === -1 ? value.slice(1) : value.slice(1, end);
    }
  }

  return value.replace(/(^|\s)#.*$/, '').trim();
}

/** True when .env already holds a cookie worth trying. */
export function hasUsableCookie(envText) {
  const value = readCookie(envText);
  if (!value || !value.trim()) return false;
  if (PLACEHOLDERS.some((p) => value.includes(p))) return false;
  return /PHPSESSID=[^;\s]+/.test(value);
}
