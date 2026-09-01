import { SessionExpiredError, exitCodeFor } from './session.js';

const COMMANDS = {
  orders: () => import('./fetch-orders.js'),
  'order-details': () => import('./fetch-order-details.js'),
  sum: () => import('./sum-orders.js'),
  excel: () => import('./export-excel.js'),
  find: () => import('./find-orders.js'),
  stats: () => import('./stats-orders.js'),
  collection: () => import('./collection-orders.js'),
};

const command = process.argv[2];

if (!command || !COMMANDS[command]) {
  console.error(`Usage: node src/index.js <command> [args]`);
  console.error(`Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

const { run } = await COMMANDS[command]();

/**
 * Run the command, and if it stops because the session expired, offer to
 * refresh the cookie right here and run it again.
 *
 * The pre-command hook only catches a *missing* cookie — an expired one looks
 * perfectly well-formed, so it gets through and only fails once the site
 * redirects. Prompting at that point turns the most common failure of this
 * tool into one paste instead of a failed run, a manual .env edit and a
 * re-invocation. Retried once: a second expiry straight after a validated
 * cookie is a different problem, and looping on it would just hide it.
 */
async function runWithCookieRetry() {
  try {
    await run();
    return;
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;

    // Nobody to ask when piped or in CI — the error already says what to do,
    // and prompting would only print those instructions a second time.
    if (!process.stdin.isTTY) throw err;

    const { promptForCookie } = await import('./ensure-cookie.js');
    const sessionId = await promptForCookie({
      heading: 'Your session cookie has expired.',
    });

    // No TTY, or the user gave up: report the original failure, not a new one.
    if (!sessionId) throw err;

    // config.cookie reads process.env on every request, so this is what the
    // retry below picks up — .env has been written for the next run too.
    process.env.ORDERS_COOKIE = `PHPSESSID=${sessionId}`;
    console.log(`Retrying: ${command}\n`);
  }

  await run();
}

await runWithCookieRetry().catch((err) => {
  console.error(`Error: ${err.message}`);
  // Exit 2 for an expired session, so `sync-job.js` can offer the cookie
  // prompt in the UI instead of reporting a generic failure.
  process.exit(exitCodeFor(err));
});
