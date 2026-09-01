/**
 * `npm run collection` — which volumes of each series you own, and which ones
 * are missing in between.
 *
 * Read-only and offline like `find-orders.js` and `stats-orders.js`, and for
 * the same reason deliberately free of `orders-config.js`: it never talks to
 * the site, so it must work without a cookie.
 *
 * The figures live in `collection-report.js`, which is free of Node imports so
 * the Collection tab computes the same numbers from the same code. This module
 * is the CLI half: read the JSON, lay it out as text.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { collectSeries, collectionSummary, volumeRun } from './collection-report.js';

export { collectSeries, collectionSummary, seriesWithGaps, volumeRun } from './collection-report.js';

/** Beyond this many volumes the strip stops being readable, so it is dropped. */
const STRIP_MAX = 40;

/**
 * A run of volumes as filled and hollow blocks — the terminal counterpart of
 * the strip the UI draws, and the thing that makes a hole visible at a glance
 * rather than as a number to look up.
 */
export function strip(series) {
  const run = volumeRun(series);
  if (!run.length || run.length > STRIP_MAX) return '';
  return run.map((v) => (v.owned ? '▪' : '▫')).join('');
}

async function readJson(path) {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

/** Parse `--top N` and `--all`, defaulting when absent or not a number. */
export function parseArgs(argv) {
  const opts = { top: 10, all: false };
  const i = argv.indexOf('--top');
  if (i !== -1) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) opts.top = Math.floor(n);
  }
  if (argv.includes('--all')) {
    opts.all = true;
    opts.top = Infinity;
  }
  return opts;
}

export function report(details, opts = {}) {
  const { top = 10, all = false } = opts;
  const lines = [];

  const summary = collectionSummary(details);
  const series = collectSeries(details);
  const gaps = series.filter((s) => s.missing.length > 0);

  // Series names are Thai and their width in a terminal does not follow
  // `.length`, so nothing is ever padded *after* a name — each name sits on
  // its own line with the figures indented beneath it.
  lines.push('Collection');
  lines.push(`  Series             ${String(summary.series).padStart(4)}`);
  lines.push(`  Volumes owned      ${String(summary.volumes).padStart(4)}`);
  lines.push(
    `  Series with gaps   ${String(summary.seriesWithGaps).padStart(4)}` +
      (summary.volumesMissing ? `  (${summary.volumesMissing} volume(s) missing)` : '')
  );

  if (gaps.length) {
    const shown = Number.isFinite(top) ? gaps.slice(0, top) : gaps;
    lines.push(
      '',
      `Missing volumes${shown.length < gaps.length ? ` (${shown.length} of ${gaps.length})` : ''}`
    );
    for (const s of shown) {
      const bar = strip(s);
      lines.push('', `  ${s.label}`);
      lines.push(
        `    owned ${s.count} of ${s.last - s.first + 1}` +
          `   vol ${s.first}-${s.last}` +
          `   missing: ${s.missing.join(', ')}`
      );
      if (bar) lines.push(`    ${bar}`);
    }
  } else if (summary.series) {
    lines.push('', 'No gaps — every series runs unbroken from its first volume to its last.');
  }

  const above = series.filter((s) => s.startsAbove != null);
  if (above.length) {
    lines.push('', `Starts above volume 1 (${above.length})`);
    lines.push('  Not counted as missing — more likely bought elsewhere than skipped.');
    const shown = Number.isFinite(top) ? above.slice(0, top) : above;
    for (const s of shown) {
      lines.push(`    from vol ${String(s.startsAbove).padEnd(3)} ${s.label}`);
    }
    if (shown.length < above.length) lines.push(`    …and ${above.length - shown.length} more (--all)`);
  }

  if (all) {
    const complete = series.filter((s) => s.complete && s.count > 1);
    if (complete.length) {
      lines.push('', `Complete series (${complete.length})`);
      for (const s of complete) {
        lines.push(`    ${String(s.count).padStart(3)} vol  ${s.label}`);
      }
    }
  }

  if (summary.unnumbered) {
    lines.push(
      '',
      `${summary.unnumbered} item(s) carry no เล่ม number — a one-shot or a box set — and are not tracked here.`
    );
  }
  lines.push('A gap can also mean a volume bought elsewhere; this only sees what you ordered here.');

  return lines.join('\n');
}

export async function run() {
  const opts = parseArgs(process.argv.slice(3));
  const detailsPath = process.env.ORDERS_DETAILS_FILE ?? 'orders-details.json';

  const details = await readJson(detailsPath);
  if (details === null) {
    console.error(`Could not read ${detailsPath}. Run \`npm run order-details\` first.`);
    process.exitCode = 1;
    return;
  }
  if (!details.length) {
    console.error(`${detailsPath} holds no orders. Run \`npm run order-details\` first.`);
    process.exitCode = 1;
    return;
  }

  console.log(report(details, opts));
}
