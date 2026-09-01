/**
 * Which volumes of a series you own, and which ones are missing between them —
 * the computation half of `npm run collection`.
 *
 * Deliberately **free of Node imports**, like `orders-total.js`,
 * `product-name.js` and `stats-report.js`, so the browser bundle can import
 * it: the Collection tab and the CLI report read the same figures from here.
 * `collection-orders.js` keeps the file reading and the terminal rendering.
 *
 * Volume numbers come from `parseProductName`, which already reads `เล่ม N`
 * off the item name, and series are folded with `seriesKey` so one series
 * written two ways stays one series.
 */
import { isCancelled } from './orders-total.js';
import { parseProductName, seriesKey } from './product-name.js';

/**
 * A gap is only claimed *between* two volumes you own.
 *
 * Anything below the lowest volume owned is reported separately as
 * `startsAbove` and never counted as missing: a series you own from volume 3
 * up is far more likely to be one you started collecting late, or own the
 * first two of in another format, than one with a hole at the front. Above
 * the highest is not a gap either — that is simply the series continuing.
 *
 * Half volumes (`เล่ม 12.5`, a real and common side-story) are kept as owned
 * but never generate an expectation: only whole numbers are ever reported
 * missing.
 */
function gapsBetween(volumes) {
  const whole = volumes.filter((v) => Number.isInteger(v));
  if (whole.length < 2) return { missing: [], first: whole[0] ?? null, last: whole[0] ?? null };

  const owned = new Set(whole);
  const first = Math.min(...whole);
  const last = Math.max(...whole);
  const missing = [];
  for (let v = first + 1; v < last; v++) if (!owned.has(v)) missing.push(v);
  return { missing, first, last };
}

/**
 * Every series you own at least one numbered volume of.
 *
 * Cancelled orders are excluded — the same rule as `npm run sum` and the
 * header total: an order that was cancelled is not a book you have. Free
 * gifts and spend-threshold goods are excluded too; they are not a series.
 *
 * @returns {Array<{key: string, label: string, volumes: number[], count: number,
 *   first: number|null, last: number|null, missing: number[],
 *   startsAbove: number|null, complete: boolean}>}
 */
export function collectSeries(details = []) {
  const groups = new Map();

  for (const order of details) {
    if (isCancelled(order)) continue;
    for (const item of order?.items ?? []) {
      const parsed = parseProductName(item?.name);
      // A giveaway never reaches the volume check anyway — parseProductName
      // returns freebies with `volume: null` — but saying so here keeps the
      // rule visible instead of resting on that.
      if (!parsed?.series || parsed.isFreebie) continue;
      if (parsed.volume == null) continue;

      const key = seriesKey(parsed.series);

      const entry = groups.get(key) ?? { key, labels: new Map(), volumes: new Set() };
      // The site spells one series several ways; show whichever spelling is
      // most common, as the facet selects do.
      entry.labels.set(parsed.series, (entry.labels.get(parsed.series) ?? 0) + 1);
      entry.volumes.add(parsed.volume);
      groups.set(key, entry);
    }
  }

  const out = [];
  for (const entry of groups.values()) {
    const volumes = [...entry.volumes].sort((a, b) => a - b);
    const { missing, first, last } = gapsBetween(volumes);
    const label = [...entry.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    out.push({
      key: entry.key,
      label,
      volumes,
      count: volumes.length,
      first,
      last,
      missing,
      startsAbove: first != null && first > 1 ? first : null,
      complete: missing.length === 0,
    });
  }

  // Most missing first — that is the list worth acting on. Ties fall back to
  // the larger collection, then the name, so the order is stable.
  return out.sort(
    (a, b) => b.missing.length - a.missing.length || b.count - a.count || a.label.localeCompare(b.label, 'th')
  );
}

/** Just the series with a hole in them. */
export function seriesWithGaps(details = []) {
  return collectSeries(details).filter((s) => s.missing.length > 0);
}

/**
 * Headline figures, including the two caveats that belong on screen next to
 * them: items with no volume number at all (a one-shot, a box set, an artbook)
 * are outside this report entirely, and a series that starts above volume 1 is
 * reported but not counted as missing anything.
 */
export function collectionSummary(details = []) {
  const series = collectSeries(details);
  let unnumbered = 0;
  let itemsCounted = 0;

  for (const order of details) {
    if (isCancelled(order)) continue;
    for (const item of order?.items ?? []) {
      const parsed = parseProductName(item?.name);
      if (!parsed?.series || parsed.isFreebie) continue;
      if (parsed.volume == null) unnumbered++;
      else itemsCounted++;
    }
  }

  const withGaps = series.filter((s) => s.missing.length > 0);
  return {
    series: series.length,
    volumes: series.reduce((n, s) => n + s.count, 0),
    itemsCounted,
    unnumbered,
    seriesWithGaps: withGaps.length,
    volumesMissing: withGaps.reduce((n, s) => n + s.missing.length, 0),
    startingAbove: series.filter((s) => s.startsAbove != null).length,
  };
}

/**
 * The whole run from the first volume owned to the last, each marked owned or
 * missing — what both renderers draw a strip from.
 *
 * Half volumes are folded onto the whole number below them rather than given a
 * slot of their own, so a series with a `12.5` does not render a half-width
 * gap between 12 and 13.
 */
export function volumeRun(series) {
  if (series?.first == null || series?.last == null) return [];
  const owned = new Set(series.volumes.filter((v) => Number.isInteger(v)));
  const extras = new Map();
  for (const v of series.volumes) {
    if (Number.isInteger(v)) continue;
    const base = Math.floor(v);
    extras.set(base, [...(extras.get(base) ?? []), v]);
  }

  const run = [];
  for (let v = series.first; v <= series.last; v++) {
    run.push({ volume: v, owned: owned.has(v), extras: extras.get(v) ?? [] });
  }
  return run;
}
