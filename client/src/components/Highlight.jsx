/**
 * Renders text with every case-insensitive occurrence of `query` marked,
 * matching what `npm run find` does in the terminal.
 */

/** Escape a user query so it can be used as a literal in a RegExp. */
export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` into alternating plain and matching segments. Always returns at
 * least one segment so callers can map over it unconditionally; empty segments
 * are dropped so a match at either end does not render a stray node.
 */
export function splitMatches(text, query) {
  const s = text == null ? '' : String(text);
  const q = query == null ? '' : String(query);
  // Mirror useDataTable exactly: it skips filtering when the query is blank
  // but otherwise matches on the raw string, spaces included. Trimming here
  // would mark "set" while the rows were actually filtered on "set ".
  if (!q.trim()) return [{ text: s, match: false }];

  const parts = [];
  const re = new RegExp(escapeRegExp(q), 'gi');
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    // A zero-length match cannot happen with a non-empty literal, but guard
    // anyway: lastIndex would not advance and this would spin forever.
    if (m[0] === '') break;
    if (m.index > last) parts.push({ text: s.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last), match: false });

  return parts.length ? parts : [{ text: s, match: false }];
}

export default function Highlight({ text, query }) {
  return (
    <>
      {splitMatches(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="hl">{part.text}</mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
