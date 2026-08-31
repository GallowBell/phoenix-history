/**
 * Stands in for `src/index.js` in sync-job tests: real spawn, real streams,
 * real exit codes, no network. The first argument picks the behaviour.
 */
const mode = process.argv[2];
const force = process.argv.includes('--force');

if (mode === 'ok') {
  console.log('Fetching page 1…');
  console.log(`Page 1: 50 orders${force ? ' (forced)' : ''}`);
  console.log('Wrote 103 orders to orders.json');
  process.exit(0);
}

if (mode === 'expired') {
  console.error('Error: Session expired — the site redirected to the login page.');
  process.exit(2);
}

if (mode === 'fail') {
  console.error('Error: something else broke');
  process.exit(1);
}

if (mode === 'noisy') {
  for (let i = 1; i <= 40; i++) console.log(`[${i}/40] order ${1000 + i} → 2 item(s)`);
  process.exit(0);
}

if (mode === 'slow') {
  console.log('started');
  setInterval(() => {}, 1000); // hang until signalled
}
