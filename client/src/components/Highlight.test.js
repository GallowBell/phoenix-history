import { describe, it, expect } from 'vitest';
import { splitMatches, escapeRegExp } from './Highlight.jsx';

const plain = (parts) => parts.map((p) => p.text).join('');
const marked = (parts) => parts.filter((p) => p.match).map((p) => p.text);

describe('splitMatches', () => {
  it('marks a match in the middle and keeps the surrounding text', () => {
    const parts = splitMatches('Phoenix Complete Set', 'complete');
    expect(parts).toEqual([
      { text: 'Phoenix ', match: false },
      { text: 'Complete', match: true },
      { text: ' Set', match: false },
    ]);
  });

  it('matches case-insensitively but renders the original casing', () => {
    expect(marked(splitMatches('SKU-ABC', 'abc'))).toEqual(['ABC']);
  });

  it('marks every occurrence, not just the first', () => {
    expect(marked(splitMatches('aXaXa', 'a'))).toEqual(['a', 'a', 'a']);
  });

  it('emits no empty segment when the match is at the start or end', () => {
    expect(splitMatches('abc', 'abc')).toEqual([{ text: 'abc', match: true }]);
    expect(splitMatches('abc', 'a')[0]).toEqual({ text: 'a', match: true });
  });

  it('never loses or reorders characters', () => {
    const text = 'Complete Set (2024) — 3x';
    for (const q of ['e', 'set', '(2024)', '—', 'x']) {
      expect(plain(splitMatches(text, q))).toBe(text);
    }
  });

  it('treats regex metacharacters in the query as literals', () => {
    expect(marked(splitMatches('a.c and abc', '.'))).toEqual(['.']);
    expect(marked(splitMatches('price (2)', '(2)'))).toEqual(['(2)']);
    expect(() => splitMatches('anything', '[')).not.toThrow();
  });

  it('highlights Thai text', () => {
    expect(marked(splitMatches('ออร์เดอร์ยกเลิก', 'ยกเลิก'))).toEqual(['ยกเลิก']);
  });

  it('returns the whole string unmarked for an empty or whitespace query', () => {
    expect(splitMatches('abc', '')).toEqual([{ text: 'abc', match: false }]);
    expect(splitMatches('abc', '   ')).toEqual([{ text: 'abc', match: false }]);
    expect(splitMatches('abc', null)).toEqual([{ text: 'abc', match: false }]);
  });

  it('coerces non-string input rather than throwing', () => {
    expect(splitMatches(1234, '23')).toEqual([
      { text: '1', match: false },
      { text: '23', match: true },
      { text: '4', match: false },
    ]);
    expect(splitMatches(null, 'a')).toEqual([{ text: '', match: false }]);
    expect(splitMatches(undefined, '')).toEqual([{ text: '', match: false }]);
  });
});

describe('escapeRegExp', () => {
  it('escapes every metacharacter so the query matches literally', () => {
    const meta = '.*+?^${}()|[]\\';
    expect(new RegExp(escapeRegExp(meta)).test(meta)).toBe(true);
  });
});

describe('splitMatches query normalization', () => {
  // useDataTable filters on the raw query and only skips a blank one, so the
  // mark must cover exactly the text that caused the row to be kept.
  it('honours a trailing space rather than trimming it away', () => {
    expect(marked(splitMatches('a set of', 'set '))).toEqual(['set ']);
    expect(marked(splitMatches('a settlement', 'set '))).toEqual([]);
  });

  it('honours a leading space', () => {
    expect(marked(splitMatches('a set', ' set'))).toEqual([' set']);
  });

  it('still marks nothing for a whitespace-only query, matching the filter’s early-out', () => {
    expect(splitMatches('a b', '  ')).toEqual([{ text: 'a b', match: false }]);
  });
});
