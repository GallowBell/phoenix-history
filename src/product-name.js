/**
 * Parses a scraped product name into its parts.
 *
 * Item names on phoenixnext.com follow a positional convention:
 *
 *   (PRE/MAY)(LN) Complete Set  <series title>  เล่ม 10 (ฉบับจบ)
 *   \__________/\__/ \________/ \____________/  \____/ \______/
 *    pre-order   kind    set        series       volume  note
 *
 * Everything except the series title is boilerplate, so a filter built on the
 * raw string ends up with one option per volume. Stripping the boilerplate
 * collapses those into one option per series and turns the stripped pieces
 * into facets of their own.
 *
 * Deliberately free of Node imports so the browser bundle can import it,
 * the same way `orders-total.js` is.
 */

/** Type tags, as they appear in the leading `(...)` run. */
export const KIND_LABELS = {
  LN: 'Light Novel',
  MG: 'Manga',
  AB: 'Art Book',
  GOODS: 'Free gift / goods',
};

/**
 * Set editions, longest first — `Short Story Set` must be tested before
 * `Story Set` would ever match, and `Collection Box Set` before `Box Set`.
 */
export const SET_TYPES = [
  'Collection Box Set',
  'Short Story Set',
  'Complete Set',
  'Special Set',
  'Ultimate Set',
];

/** Single bucket for promotional freebies, which have no series. */
export const GOODS_SERIES = 'Free gift / goods';

const LEADING_TAG = /^\s*\(([^()]*)\)\s*/;
const PREORDER_TAG = /^pre(?:[-\s]?order)?$/i;
const PREORDER_MONTH_TAG = /^pre\s*\/\s*(.+)$/i;
const VOLUME = /เล่ม\s*(\d+(?:\.\d+)?)/g;
// "Free Gift - …" and "ครบ 1,800 บาท - …" are both spend-threshold giveaways.
const FREEBIE = /^\s*(?:free\s*gift\s*-|ครบ\s*[\d,]+\s*บาท)/i;

/** Strips every leading `(...)` group, recognised or not. */
function withoutLeadingTags(name) {
  let rest = String(name ?? '');
  let m;
  while ((m = LEADING_TAG.exec(rest))) rest = rest.slice(m[0].length);
  return rest;
}

/**
 * Grouping key: the same series is written inconsistently across orders —
 * `แมจิคัล★…` vs `แมจิคัล☆…`, and `คุณอาเรียโต๊ะข้างๆพูด…` vs
 * `คุณอาเรียโต๊ะข้างๆ พูด…`. Folding whitespace and star glyphs keeps those
 * from becoming two options.
 */
export function seriesKey(series) {
  return String(series ?? '')
    .replace(/[★☆✩✭✮]/g, '*')
    .replace(/[-\u2010\u2013\u2014\u2015]/g, '-')
    .replace(/[!?\uFF01\uFF1F]/g, '')
    .replace(/ปีสอง/g, 'ปี2')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * @param {string} name raw scraped product name
 * @returns {{raw: string, kind: string|null, preorder: boolean,
 *   preorderMonth: string|null, set: string|null, series: string,
 *   volume: number|null, volumeLabel: string|null, note: string|null,
 *   isFreebie: boolean, key: string}}
 */
export function parseProductName(name) {
  const raw = String(name ?? '');
  const parsed = {
    raw,
    kind: null,
    preorder: false,
    preorderMonth: null,
    set: null,
    series: '',
    volume: null,
    volumeLabel: null,
    note: null,
    isFreebie: false,
    key: '',
  };

  // A giveaway is classified by its whole name, so it never reaches the
  // series parse below — otherwise every promo line becomes its own option.
  if (FREEBIE.test(withoutLeadingTags(raw))) {
    parsed.kind = 'GOODS';
    parsed.isFreebie = true;
    parsed.series = GOODS_SERIES;
    parsed.key = seriesKey(GOODS_SERIES);
    return parsed;
  }

  // 1. Leading tag run. Stop at the first tag we don't recognise rather than
  //    guessing — an unknown `(...)` is more likely title text than metadata.
  let rest = raw;
  let m;
  while ((m = LEADING_TAG.exec(rest))) {
    const tag = m[1].trim();
    const month = PREORDER_MONTH_TAG.exec(tag);
    if (month) {
      parsed.preorder = true;
      parsed.preorderMonth = month[1].trim();
    } else if (PREORDER_TAG.test(tag)) {
      parsed.preorder = true;
    } else if (Object.hasOwn(KIND_LABELS, tag.toUpperCase()) && tag.toUpperCase() !== 'GOODS') {
      parsed.kind = tag.toUpperCase();
    } else {
      break;
    }
    rest = rest.slice(m[0].length);
  }

  // 2. Set edition, only where the convention puts it: directly after the tags.
  for (const set of SET_TYPES) {
    if (rest.toLowerCase().startsWith(set.toLowerCase())) {
      parsed.set = set;
      rest = rest.slice(set.length).trimStart();
      // A couple of titles carry an edition letter on the set ("Special Set B").
      rest = rest.replace(/^[A-Z](?=\s)\s*/, '');
      break;
    }
  }

  // 3. Volume. Match the *last* `เล่ม N` — a few titles carry a per-volume
  //    subtitle after it ("เล่ม 1 จอมมารผู้ไม่ยอมให้เคลียร์เกม"), and one
  //    series name contains a number of its own.
  VOLUME.lastIndex = 0;
  let last = null;
  let hit;
  while ((hit = VOLUME.exec(rest))) last = hit;
  if (last) {
    parsed.volume = Number(last[1]);
    parsed.volumeLabel = `เล่ม ${last[1]}`;
    const after = rest.slice(last.index + last[0].length).trim();
    if (after) parsed.note = after;
    rest = rest.slice(0, last.index);
  }

  // 4. Whatever is left is the series, minus any trailing bracketed extras.
  parsed.series = rest
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // One record repeats its type tag as a bare word before the volume.
    .replace(/\s+(LN|MG|AB)$/i, '')
    .trim();
  parsed.key = seriesKey(parsed.series);
  return parsed;
}

/** Sentinel for "parsed, but this facet is absent" — a plain volume, say. */
export const NONE = 'NONE';

const KIND_ORDER = ['LN', 'MG', 'AB', 'GOODS', NONE];

/**
 * Tallies the facet options present in a set of detail records.
 *
 * Options come from the whole dataset rather than the current filter, so the
 * selects keep a stable list instead of shrinking as choices are made.
 *
 * @param {object[]} details order records carrying `items[]`
 */
export function collectFacets(details) {
  const series = new Map();
  const kinds = new Map();
  const sets = new Map();

  const bump = (map, key, label) => {
    const entry = map.get(key) ?? { value: key, label, count: 0, labels: new Map() };
    entry.count++;
    entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
    map.set(key, entry);
  };

  for (const order of details ?? []) {
    for (const item of order?.items ?? []) {
      const p = parseProductName(item?.name);
      if (p.key) bump(series, p.key, p.series);
      bump(kinds, p.kind ?? NONE, KIND_LABELS[p.kind] ?? 'Untagged');
      bump(sets, p.set ?? NONE, p.set ?? 'No set');
    }
  }

  // The same series is spelled several ways; show whichever spelling is most
  // common, and break ties by first appearance so the label never flickers.
  const settle = (map) =>
    [...map.values()].map((e) => {
      let best = e.label;
      let bestCount = -1;
      for (const [label, count] of e.labels) {
        if (count > bestCount) {
          best = label;
          bestCount = count;
        }
      }
      return { value: e.value, label: best, count: e.count };
    });

  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th');
  const goodsKey = seriesKey(GOODS_SERIES);

  return {
    // Giveaways are pinned last: it is one bucket of promo lines, not a series.
    series: settle(series).sort((a, b) =>
      (a.value === goodsKey) - (b.value === goodsKey) || byCount(a, b)),
    kinds: settle(kinds).sort(
      (a, b) => KIND_ORDER.indexOf(a.value) - KIND_ORDER.indexOf(b.value)),
    sets: settle(sets).sort((a, b) => {
      const rank = (v) => (v === NONE ? SET_TYPES.length : SET_TYPES.indexOf(v));
      return rank(a.value) - rank(b.value);
    }),
  };
}

/**
 * @param {object} parsed result of `parseProductName`
 * @param {{series?: string, kind?: string, set?: string}} filters
 *   empty string means "no filter on this facet"
 */
export function matchesFacets(parsed, { series = '', kind = '', set = '' } = {}) {
  if (series && parsed.key !== series) return false;
  if (kind && (parsed.kind ?? NONE) !== kind) return false;
  if (set && (parsed.set ?? NONE) !== set) return false;
  return true;
}
