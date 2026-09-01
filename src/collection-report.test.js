import { describe, it, expect } from 'vitest';
import {
  collectSeries,
  seriesWithGaps,
  collectionSummary,
  volumeRun,
} from './collection-report.js';
import { CANCELLED_STATUS, DELIVERED_STATUS, STATUS_KEY } from './orders-total.js';

const item = (name) => ({ name, sku: 'S1', price: '฿100.00', quantity: '1', subtotal: '฿100.00' });

const order = (names, status = DELIVERED_STATUS) => ({
  'หมายเลขคำสั่งซื้อ': '000100001',
  [STATUS_KEY]: status,
  items: names.map(item),
});

/** A series named `title` owning exactly `vols`. */
const owning = (title, vols) => order(vols.map((v) => `(LN) ${title} เล่ม ${v}`));

describe('collectSeries', () => {
  it('groups volumes of one series and reports the interior gaps', () => {
    const [series] = collectSeries([owning('ชายแปด', [1, 2, 3, 5])]);
    expect(series.label).toBe('ชายแปด');
    expect(series.volumes).toEqual([1, 2, 3, 5]);
    expect(series.missing).toEqual([4]);
    expect(series.complete).toBe(false);
  });

  it('reports every hole in a sparse run, not just the first', () => {
    const [series] = collectSeries([owning('ชายแปด', [1, 7, 9])]);
    expect(series.missing).toEqual([2, 3, 4, 5, 6, 8]);
  });

  it('never counts volumes below the lowest one owned as missing', () => {
    // Starting at 3 almost always means bought elsewhere, not skipped, so it
    // is reported as `startsAbove` and left out of `missing` entirely.
    const [series] = collectSeries([owning('หลานจอมปราชญ์', [3, 4, 6])]);
    expect(series.startsAbove).toBe(3);
    expect(series.missing).toEqual([5]);
  });

  it('leaves startsAbove null for a series that begins at volume 1', () => {
    expect(collectSeries([owning('ชายแปด', [1, 2])])[0].startsAbove).toBeNull();
  });

  it('treats a half volume as owned without inventing a gap around it', () => {
    // `เล่ม 12.5` is a real side-story. It must not make 13 look missing,
    // and must not itself be reported as a hole between 12 and 13.
    const [series] = collectSeries([owning('ห้องเรียน', [11, 12, 12.5, 13])]);
    expect(series.volumes).toEqual([11, 12, 12.5, 13]);
    expect(series.missing).toEqual([]);
    expect(series.complete).toBe(true);
  });

  it('needs two whole volumes before claiming anything is missing', () => {
    // Owning เล่ม 1 and a เล่ม 2.5 side story establishes no run: there is one
    // whole volume, so there is nothing to have a hole between.
    const [series] = collectSeries([owning('ห้องเรียน', [1, 2.5])]);
    expect(series.volumes).toEqual([1, 2.5]);
    expect(series.missing).toEqual([]);
  });

  it('does not claim a gap from a single volume', () => {
    const [series] = collectSeries([owning('ชายแปด', [5])]);
    expect(series.missing).toEqual([]);
    expect(series.count).toBe(1);
  });

  it('counts a volume once however many times it was ordered', () => {
    const series = collectSeries([owning('ชายแปด', [1, 2]), owning('ชายแปด', [2, 3])]);
    expect(series).toHaveLength(1);
    expect(series[0].volumes).toEqual([1, 2, 3]);
  });

  it('excludes cancelled orders, the same rule as the header total', () => {
    // A cancelled order is not a book you have, so it must not fill a gap.
    const series = collectSeries([
      owning('ชายแปด', [1, 3]),
      order(['(LN) ชายแปด เล่ม 2'], CANCELLED_STATUS),
    ]);
    expect(series[0].missing).toEqual([2]);
  });

  it('excludes free gifts and spend-threshold goods, which are not a series', () => {
    const series = collectSeries([
      order(['Free Gift - Mini Clear Bookmark Set', 'ครบ 1,000 บาท - Acrylic Stand']),
    ]);
    expect(series).toEqual([]);
  });

  it('folds the spellings of one series together', () => {
    // seriesKey() folds ★/☆ and stray spaces; without it this would be two
    // series of one volume each and no gap would ever be found.
    const series = collectSeries([
      order(['(LN) แมจิคัล★เอกซ์ เล่ม 1', '(LN) แมจิคัล☆เอกซ์ เล่ม 3']),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].missing).toEqual([2]);
  });

  it('sorts the series with the most missing first', () => {
    const series = collectSeries([
      owning('หนึ่ง', [1, 3]),
      owning('สอง', [1, 5]),
      owning('สาม', [1, 2]),
    ]);
    expect(series.map((s) => s.missing.length)).toEqual([3, 1, 0]);
  });

  it('returns nothing for items with no volume number', () => {
    expect(collectSeries([order(['(LN) เรื่องสั้นเล่มเดียวจบ'])])).toEqual([]);
  });
});

describe('seriesWithGaps', () => {
  it('keeps only the series that have a hole', () => {
    const gaps = seriesWithGaps([owning('หนึ่ง', [1, 3]), owning('สอง', [1, 2])]);
    expect(gaps.map((s) => s.label)).toEqual(['หนึ่ง']);
  });
});

describe('collectionSummary', () => {
  it('totals series, volumes and what is missing', () => {
    const summary = collectionSummary([owning('หนึ่ง', [1, 3]), owning('สอง', [1, 2, 3])]);
    expect(summary).toMatchObject({
      series: 2,
      volumes: 5,
      seriesWithGaps: 1,
      volumesMissing: 1,
    });
  });

  it('counts items with no volume separately rather than dropping them silently', () => {
    // These are one-shots and box sets. They are outside the report, and the
    // renderers say so rather than letting the volume count look short.
    const summary = collectionSummary([order(['(LN) ชายแปด เล่ม 1', '(LN) เล่มเดียวจบ'])]);
    expect(summary.unnumbered).toBe(1);
    expect(summary.itemsCounted).toBe(1);
  });

  it('does not count giveaways among the items with no volume number', () => {
    // 37 of the real items are `Free Gift -` / `ครบ N บาท -` promos and carry
    // no เล่ม. Counted as unnumbered they would report 43 untracked items
    // where the honest figure is 6, turning a caveat into a wrong number.
    const summary = collectionSummary([
      order(['(LN) ชายแปด เล่ม 1', 'Free Gift - Mini Clear Bookmark Set', 'ครบ 1,000 บาท - Acrylic Stand']),
    ]);
    expect(summary.unnumbered).toBe(0);
    expect(summary.itemsCounted).toBe(1);
  });

  it('reports how many series start above volume 1', () => {
    expect(collectionSummary([owning('หลาน', [3, 4])]).startingAbove).toBe(1);
  });

  it('handles no details at all', () => {
    expect(collectionSummary([])).toMatchObject({ series: 0, volumes: 0, volumesMissing: 0 });
  });
});

describe('volumeRun', () => {
  it('returns every slot from first to last, marked owned or not', () => {
    const [series] = collectSeries([owning('ชายแปด', [1, 2, 4])]);
    expect(volumeRun(series)).toEqual([
      { volume: 1, owned: true, extras: [] },
      { volume: 2, owned: true, extras: [] },
      { volume: 3, owned: false, extras: [] },
      { volume: 4, owned: true, extras: [] },
    ]);
  });

  it('hangs a half volume off the whole number below it rather than giving it a slot', () => {
    const [series] = collectSeries([owning('ห้องเรียน', [1, 1.5, 2])]);
    expect(volumeRun(series).map((v) => v.volume)).toEqual([1, 2]);
    expect(volumeRun(series)[0].extras).toEqual([1.5]);
  });

  it('returns nothing for a series with no numbered range', () => {
    expect(volumeRun({ first: null, last: null, volumes: [] })).toEqual([]);
    expect(volumeRun(undefined)).toEqual([]);
  });
});
