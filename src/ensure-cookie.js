import { readFile, writeFile } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';

// This module runs *before* the commands that need a cookie, so it must not
// import orders-config.js — that exits the process when ORDERS_COOKIE is
// missing, which is precisely the case this is here to fix.

const ENV_PATH = resolve('.env');
const EXAMPLE_PATH = resolve('.env.example');
const DEFAULT_URL = 'https://www.phoenixnext.com/sales/order/history/?limit=50';
const MAX_ATTEMPTS = 3;

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

/**
 * Pull the session id out of whatever the user pasted — a bare id, a
 * `PHPSESSID=…` pair, or a whole `cookie:` header copied from DevTools.
 */
export function extractSessionId(input) {
  const text = String(input ?? '').trim().replace(/^cookie:\s*/i, '');
  if (!text) return null;

  const pair = text.match(/PHPSESSID=([^;\s"']+)/i);
  if (pair) return pair[1];

  // A bare value: no separators, and shaped like a session id.
  if (/^[A-Za-z0-9_-]{16,128}$/.test(text)) return text;

  return null;
}

/** Insert or replace the ORDERS_COOKIE line, leaving the rest of .env intact. */
export function upsertCookie(envText, sessionId) {
  const line = `ORDERS_COOKIE="PHPSESSID=${sessionId}"`;
  const crlf = envText.includes('\r\n');
  let text = envText.replace(/\r\n/g, '\n');

  if (/^ORDERS_COOKIE[ \t]*=/m.test(text)) {
    // Function form: a session id containing a replacement pattern such as
    // dollar-ampersand would otherwise be expanded and corrupt the file.
    text = text.replace(/^ORDERS_COOKIE[ \t]*=.*$/m, () => line);
  } else {
    // Keep exactly one trailing newline before appending — and none at all
    // when the file is empty, so we don't open with a blank line.
    const base = text.trim() ? text.replace(/\n*$/, '\n') : '';
    text = base + line + '\n';
  }

  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

async function readEnv() {
  try {
    return await readFile(ENV_PATH, 'utf-8');
  } catch (err) {
    // Only a missing file means "not set up yet". A permissions or locking
    // error must not silently fall back to the example and then overwrite the
    // user's real .env with it.
    if (err.code !== 'ENOENT') throw err;
    try {
      return await readFile(EXAMPLE_PATH, 'utf-8');
    } catch {
      return '';
    }
  }
}

function urlFrom(envText) {
  const match = envText.match(/^ORDERS_URL\s*=\s*"?(.*?)"?\s*$/m);
  return match?.[1] || DEFAULT_URL;
}

/** One real request: does this session id actually reach the order history? */
export async function validate(sessionId, url) {
  const response = await axios.get(url, {
    maxRedirects: 0,
    validateStatus: () => true,
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en,th-TH;q=0.9,th;q=0.8',
      cookie: `PHPSESSID=${sessionId}`,
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    },
  });

  if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status} (redirected to login)` };

  const $ = cheerio.load(response.data);
  const rows = $('#my-orders-table tbody tr').length;
  if (!$('#my-orders-table').length) return { ok: false, reason: 'no order table on the page' };

  return { ok: true, rows };
}

function printInstructions(heading) {
  console.log(`\n${heading}\n`);
  console.log('  1. Log in at https://www.phoenixnext.com');
  console.log('  2. Open Chrome DevTools (F12) → Application tab');
  console.log('  3. Storage → Cookies → https://www.phoenixnext.com');
  console.log('  4. Copy the Value of PHPSESSID\n');
  console.log('You can paste the bare value, PHPSESSID=..., or the whole cookie header.\n');
}

/**
 * Ask until a pasted session id validates, or the attempts run out.
 * `ask` returns the pasted text, or null once the input stream closes;
 * `check` validates one id. Both are injected so this loop is testable.
 */
export async function resolveSessionId({ ask, check, attempts = MAX_ATTEMPTS, out = console }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const answer = await ask();

    if (answer === null || answer === undefined) {
      out.error('\nInput closed before a cookie was provided.');
      return null;
    }

    const sessionId = extractSessionId(answer);
    if (!sessionId) {
      out.error("  ✗ Couldn't find a session id in that. Try again.\n");
      continue;
    }

    let result;
    try {
      result = await check(sessionId);
    } catch (err) {
      result = { ok: false, reason: err.message };
    }

    if (result.ok) return { sessionId, rows: result.rows };

    out.error(`  ✗ ${result.reason}`);
    if (attempt < attempts) out.error('  That cookie did not work. Try again.\n');
  }

  out.error(`\nGave up after ${attempts} attempts.\n`);
  return null;
}

/**
 * Ask once, resolving null if the user closes the input (Ctrl-D).
 * readline/promises leaves `question()` pending forever on EOF, which would
 * otherwise hang the process instead of reaching the give-up path.
 */
export function askOnce(rl, prompt) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    rl.once('close', () => finish(null));
    rl.question(prompt).then(finish, () => finish(null));
  });
}

/**
 * Prompt for a session id, check it against the live site, and save it to
 * .env. Returns the saved id, or null when there is no one to ask (not a TTY)
 * or the user gave up — callers decide what that means for them.
 *
 * Shared by the pre-command hook (no cookie yet) and by the retry that runs
 * when a command stops on an expired one, so both paths look identical to the
 * user and there is one place that writes the file.
 */
export async function promptForCookie({
  heading = 'No session cookie found in .env.',
} = {}) {
  const envText = await readEnv();

  if (!process.stdin.isTTY) {
    console.error(`\n${heading}`);
    console.error('This is not an interactive terminal, so it cannot be entered here.');
    console.error('Set ORDERS_COOKIE — see "How to get your cookie" in README.md.\n');
    return null;
  }

  printInstructions(heading);

  const url = urlFrom(envText);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let resolved;

  try {
    resolved = await resolveSessionId({
      ask: () => askOnce(rl, 'Paste PHPSESSID: '),
      check: async (sessionId) => {
        process.stdout.write('  Checking… ');
        return validate(sessionId, url);
      },
    });
  } finally {
    rl.close();
  }

  if (!resolved) return null;

  await writeFile(ENV_PATH, upsertCookie(envText, resolved.sessionId), 'utf-8');
  console.log(`ok — ${resolved.rows} orders visible`);
  console.log(`  Saved to ${ENV_PATH}\n`);
  return resolved.sessionId;
}

export async function run() {
  // An explicitly exported ORDERS_COOKIE wins: Node's --env-file does not
  // override an already-set variable, so `ORDERS_COOKIE=… npm run orders`
  // and `docker -e ORDERS_COOKIE=…` are working setups we must not disturb.
  if (process.env.ORDERS_COOKIE?.trim()) return;

  if (hasUsableCookie(await readEnv())) return;

  await promptForCookie();
}

// Invoked directly by the npm pre* scripts, not through src/index.js. Guarded so
// the helpers above can be imported by tests without prompting for a cookie.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run().catch((err) => {
    // An unreadable .env is a real problem the user has to fix, so this one is
    // worth failing on — but with a sentence, not a stack trace.
    console.error(`\nCould not check for a session cookie: ${err.message}\n`);
    process.exit(1);
  });
}
