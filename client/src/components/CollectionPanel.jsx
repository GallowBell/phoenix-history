import { useState } from 'react';
import {
  collectSeries,
  collectionSummary,
  volumeRun,
} from '../../../src/collection-report.js';

const TOP = 10;

/**
 * The Collection tab — the same figures as `npm run collection`, rendered
 * rather than printed. Both read `collection-report.js`, so the two cannot
 * drift apart the way sum, Excel and the UI once did over what a total means.
 *
 * The point of the tab is the strip: a hole in a run of volumes is a shape,
 * and seeing it is quicker than reading "missing: 18" off a line of text.
 */
export default function CollectionPanel({ details = [] }) {
  if (!details.length) {
    return (
      <p className="status">
        No order details on disk. Press <strong>Sync</strong> above, or run{' '}
        <code>npm run order-details</code>.
      </p>
    );
  }

  const summary = collectionSummary(details);
  const series = collectSeries(details);
  const gaps = series.filter((s) => s.missing.length > 0);
  const above = series.filter((s) => s.startsAbove != null);
  const complete = series.filter((s) => s.complete && s.count > 1);

  if (!series.length) {
    return (
      <p className="status">
        None of the scraped items carry a <code>เล่ม</code> volume number, so there is no
        series to track.
      </p>
    );
  }

  return (
    <div className="stats collection">
      <Section id="collection-overall" title="Collection" wide>
        <div className="stats-tiles">
          <Tile label="Series" value={String(summary.series)} />
          <Tile label="Volumes owned" value={String(summary.volumes)} />
          <Tile
            label="Series with gaps"
            value={String(summary.seriesWithGaps)}
            tone={summary.seriesWithGaps ? 'bad' : 'good'}
          />
          <Tile
            label="Volumes missing"
            value={String(summary.volumesMissing)}
            tone={summary.volumesMissing ? 'bad' : 'good'}
          />
        </div>
      </Section>

      {gaps.length > 0 ? (
        <GapSection gaps={gaps} />
      ) : (
        <Section id="collection-gaps" title="Missing volumes" wide>
          <p className="collection-none">
            No gaps — every series runs unbroken from its first volume to its last.
          </p>
        </Section>
      )}

      {above.length > 0 && <AboveSection series={above} />}
      {complete.length > 0 && <CompleteSection series={complete} />}

      <p className="collection-caveat">
        A gap can also mean a volume bought elsewhere — this only sees what you ordered
        here.
        {summary.unnumbered > 0 && (
          <>
            {' '}
            {summary.unnumbered} item(s) carry no <code>เล่ม</code> number — a one-shot or
            a box set — and are not tracked.
          </>
        )}
      </p>
    </div>
  );
}

/* ── Building blocks ──────────────────────────────── */

function Section({ id, title, count, wide, children }) {
  return (
    <section className={`stats-card${wide ? ' is-wide' : ''}`} role="region" aria-labelledby={id}>
      <h2 className="stats-card-title" id={id}>
        {title}
        {count && <span className="stats-card-count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile-label">{label}</span>
      <span className={`stats-tile-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function ShowAll({ shown, total, open, onToggle }) {
  if (total <= shown) return null;
  return (
    <button type="button" className="stats-more" onClick={onToggle}>
      {open ? `Show top ${shown}` : `Show all ${total}`}
    </button>
  );
}

/**
 * One series as a run of volume slots, filled where owned and hollow where not.
 *
 * The whole run is drawn rather than only the holes, because "22 of 23" says
 * nothing about *where* the hole is, and a long unbroken stretch either side of
 * one gap is the thing that makes it obvious the volume was simply never
 * ordered. Half volumes hang off the whole number below them (see `volumeRun`),
 * marked with a dot, so a side story never renders as a gap.
 */
function VolumeStrip({ series }) {
  const run = volumeRun(series);
  if (!run.length) return null;

  const label =
    `${series.label}: owns ${series.count} of ${series.last - series.first + 1} volumes, ` +
    (series.missing.length
      ? `missing ${series.missing.join(', ')}.`
      : 'none missing.');

  return (
    <ol className="vol-strip" aria-label={label}>
      {run.map((slot) => (
        <li
          key={slot.volume}
          className={`vol-slot${slot.owned ? '' : ' is-missing'}`}
          title={
            slot.owned
              ? `เล่ม ${slot.volume}${slot.extras.length ? ` (+ ${slot.extras.join(', ')})` : ''}`
              : `เล่ม ${slot.volume} — not in your orders`
          }
        >
          <span className="vol-num">{slot.volume}</span>
          {slot.extras.length > 0 && <span className="vol-extra" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function SeriesRow({ series }) {
  return (
    <div className="collection-series">
      <div className="collection-series-head">
        <span className="collection-series-name" title={series.label}>
          {series.label}
        </span>
        <span className="collection-series-count">
          {series.count} of {series.last - series.first + 1}
        </span>
      </div>
      <VolumeStrip series={series} />
      {series.missing.length > 0 && (
        <p className="collection-missing">
          Missing <strong>{series.missing.join(', ')}</strong>
          {series.startsAbove != null && (
            <span className="collection-note"> · starts at volume {series.startsAbove}</span>
          )}
        </p>
      )}
    </div>
  );
}

/* ── Sections ─────────────────────────────────────── */

function GapSection({ gaps }) {
  const [open, setOpen] = useState(false);
  const shown = open ? gaps : gaps.slice(0, TOP);

  return (
    <Section
      id="collection-gaps"
      title="Missing volumes"
      count={open || gaps.length <= TOP ? `${gaps.length} series` : `top ${TOP} of ${gaps.length}`}
      wide
    >
      {shown.map((s) => (
        <SeriesRow key={s.key} series={s} />
      ))}
      <ShowAll shown={TOP} total={gaps.length} open={open} onToggle={() => setOpen(!open)} />
    </Section>
  );
}

/**
 * Series whose lowest volume is not 1. Deliberately a separate section and not
 * counted as missing: owning from volume 3 up nearly always means the earlier
 * volumes came from somewhere else, and listing them as holes would bury the
 * real gaps under noise.
 */
function AboveSection({ series }) {
  const [open, setOpen] = useState(false);
  const shown = open ? series : series.slice(0, TOP);

  return (
    <Section id="collection-above" title="Starts above volume 1" count={`${series.length}`}>
      <p className="collection-hint">
        Not counted as missing — more likely bought elsewhere than skipped.
      </p>
      <ul className="collection-list">
        {shown.map((s) => (
          <li key={s.key}>
            <span className="collection-from">from {s.startsAbove}</span>
            <span className="collection-list-name" title={s.label}>{s.label}</span>
          </li>
        ))}
      </ul>
      <ShowAll shown={TOP} total={series.length} open={open} onToggle={() => setOpen(!open)} />
    </Section>
  );
}

function CompleteSection({ series }) {
  const [open, setOpen] = useState(false);
  const shown = open ? series : series.slice(0, TOP);

  return (
    <Section id="collection-complete" title="Complete series" count={`${series.length}`}>
      <ul className="collection-list">
        {shown.map((s) => (
          <li key={s.key}>
            <span className="collection-from is-good">{s.count} vol</span>
            <span className="collection-list-name" title={s.label}>{s.label}</span>
          </li>
        ))}
      </ul>
      <ShowAll shown={TOP} total={series.length} open={open} onToggle={() => setOpen(!open)} />
    </Section>
  );
}
