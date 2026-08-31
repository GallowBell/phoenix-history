import { useState } from 'react';
import { summarise, formatBaht } from '../../../src/orders-total.js';
import { GOODS_SERIES } from '../../../src/product-name.js';
import {
  discountCodes,
  fillMonths,
  formatMonth,
  groupSpend,
  monthKey,
  priceGap,
  seriesSpend,
} from '../../../src/stats-report.js';

const TOP = 10;
const MONTHS_SHOWN = 12;

/**
 * The Stats tab — the same figures as `npm run stats`, rendered rather than
 * printed. Both read `stats-report.js`, so the two cannot drift apart the way
 * sum, Excel and the UI once did over what a total means.
 */
export default function StatsPanel({ orders = [], details = [] }) {
  if (!orders.length) {
    return (
      <p className="status">
        No orders on disk — run <code>npm run orders</code> first.
      </p>
    );
  }

  const { count, spent, cancelledCount, cancelledAmount } = summarise(orders);
  const byYear = groupSpend(orders, (d) => (d ? String(d.year) : null));
  const byMonth = fillMonths(groupSpend(orders, monthKey));
  const series = details.length
    ? seriesSpend(details).filter((s) => s.label !== GOODS_SERIES)
    : [];
  const gap = details.length ? priceGap(details) : null;
  const codes = discountCodes(orders);

  return (
    <div className="stats">
      <Section id="stats-overall" title="Overall" wide>
        <div className="stats-tiles">
          <Tile label="Orders" value={String(count)} />
          <Tile label="Spent" value={formatBaht(spent)} tone="money" />
          {cancelledCount > 0 && (
            <Tile
              label={`Cancelled (${cancelledCount})`}
              value={formatBaht(cancelledAmount)}
              tone="muted"
              note="not counted in spent"
            />
          )}
        </div>
      </Section>

      {byYear.length > 0 && (
        <Section id="stats-year" title="Spend by year" wide>
          <PeriodTable rows={byYear} heading="Year" label={(r) => r.key} />
        </Section>
      )}

      {byMonth.length > 0 && (
        <MonthSection months={byMonth} />
      )}

      {details.length === 0 ? (
        <p className="stats-empty">
          No order details on disk — run <code>npm run order-details</code> for series and
          discount figures.
        </p>
      ) : (
        <>
          {series.length > 0 && <SeriesSection series={series} />}
          {gap && <GapSection gap={gap} />}
        </>
      )}

      {codes.length > 0 && <CodesSection codes={codes} />}
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

function Tile({ label, value, tone, note }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile-label">{label}</span>
      <span className={`stats-tile-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
      {note && <span className="stats-tile-note">{note}</span>}
    </div>
  );
}

/** A proportional bar — the rendered counterpart of `bar()` in the CLI. */
function Bar({ value, max }) {
  const pct = max > 0 && value > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="stats-bar">
      <div className="stats-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Reveals the rows a cap is hiding, rather than making the CLI strictly richer. */
function ShowAll({ shown, total, open, onToggle }) {
  if (total <= shown) return null;
  return (
    <button type="button" className="stats-more" onClick={onToggle}>
      {open ? `Show top ${shown}` : `Show all ${total}`}
    </button>
  );
}

function PeriodTable({ rows, heading, label }) {
  const max = Math.max(...rows.map((r) => r.spent), 0);
  return (
    <div className="table-wrapper">
      <table className="stats-table">
        <thead>
          <tr>
            <th>{heading}</th>
            <th className="num">Spent</th>
            <th className="num">Orders</th>
            <th className="bar-col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.orders ? undefined : 'is-quiet'}>
              <td>{label(r)}</td>
              <td className="num money">{formatBaht(r.spent)}</td>
              <td className="num">{r.orders || '—'}</td>
              <td className="bar-col"><Bar value={r.spent} max={max} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Sections ─────────────────────────────────────── */

function MonthSection({ months }) {
  const [open, setOpen] = useState(false);
  const shown = open ? months : months.slice(-MONTHS_SHOWN);

  return (
    <Section
      id="stats-month"
      title="Spend by month"
      count={open ? null : `last ${shown.length} of ${months.length}`}
      wide
    >
      <Timeline months={months} />
      <PeriodTable rows={shown} heading="Month" label={(r) => formatMonth(r.key)} />
      <ShowAll shown={MONTHS_SHOWN} total={months.length} open={open} onToggle={() => setOpen(!open)} />
    </Section>
  );
}

/**
 * Every month since the first order, as one strip.
 *
 * `fillMonths` already inserts the quiet months as zeroes because a gap is a
 * fact about the spending; drawn end to end, those gaps are the shape of the
 * history in a way a 12-row table cannot show.
 */
function Timeline({ months }) {
  if (months.length < 2) return null;
  const max = Math.max(...months.map((m) => m.spent), 0);
  const peak = months.reduce((a, b) => (b.spent > a.spent ? b : a), months[0]);

  const years = [];
  for (const m of months) {
    const year = m.key.slice(0, 4);
    const last = years.at(-1);
    if (last && last.year === year) last.count += 1;
    else years.push({ year, count: 1 });
  }

  const summary = `Spend for every month from ${formatMonth(months[0].key)} to `
    + `${formatMonth(months.at(-1).key)}. Highest: ${formatBaht(peak.spent)} in ${formatMonth(peak.key)}.`;

  return (
    <div className="stats-timeline">
      <div className="stats-timeline-bars" role="img" aria-label={summary}>
        {months.map((m) => (
          <div
            key={m.key}
            className="stats-tl-slot"
            title={`${formatMonth(m.key)} — ${formatBaht(m.spent)}${m.orders ? ` · ${m.orders} order(s)` : ''}`}
          >
            <div
              className="stats-tl-bar"
              style={{ height: max > 0 && m.spent > 0 ? `${Math.max(4, (m.spent / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="stats-timeline-years" aria-hidden="true">
        {years.map((y) => (
          <span key={y.year} className="stats-tl-year" style={{ flexGrow: y.count }}>{y.year}</span>
        ))}
      </div>
    </div>
  );
}

function SeriesSection({ series }) {
  const [open, setOpen] = useState(false);
  const shown = open ? series : series.slice(0, TOP);
  const max = Math.max(...series.map((s) => s.listed), 0);

  return (
    <Section id="stats-series" title="Top series by list price" count={open ? null : `${shown.length} of ${series.length}`} wide>
      <div className="table-wrapper">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="rank-col">#</th>
              <th className="num">List price</th>
              <th className="num">Items</th>
              <th>Series</th>
              <th className="bar-col" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s, i) => (
              <tr key={s.key}>
                <td className="rank-col">{i + 1}</td>
                <td className="num money">{formatBaht(s.listed)}</td>
                <td className="num">{s.items}</td>
                <td className="series-name" title={s.label}>{s.label}</td>
                <td className="bar-col"><Bar value={s.listed} max={max} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowAll shown={TOP} total={series.length} open={open} onToggle={() => setOpen(!open)} />
      <p className="stats-note">
        Item prices are list prices — an order discount belongs to the order, not one item.
      </p>
    </Section>
  );
}

/**
 * The site publishes no discount line, so the gap between item prices and the
 * order total is derived — and it runs both ways. Netting the two off would
 * hide both, so they stay on separate lines.
 */
function GapSection({ gap }) {
  return (
    <Section id="stats-gap" title="List price vs paid">
      <dl className="stats-gap">
        <div className="stats-gap-row">
          <dt>Items list to</dt>
          <dd className="money">{formatBaht(gap.listed)}</dd>
        </div>
        <div className="stats-gap-row">
          <dt>Paid</dt>
          <dd className="money">{formatBaht(gap.paid)}</dd>
        </div>
        <div className="stats-gap-row">
          <dt>Discounts</dt>
          <dd className="is-good">
            <span className="stats-gap-amount">{`-${formatBaht(gap.discount)}`}</span>
            <span className="stats-gap-note">across {gap.discountOrders} order(s)</span>
          </dd>
        </div>
        <div className="stats-gap-row">
          <dt>Delivery/fees</dt>
          <dd className="is-fee">
            <span className="stats-gap-amount">{`+${formatBaht(gap.surcharge)}`}</span>
            <span className="stats-gap-note">across {gap.surchargeOrders} order(s)</span>
          </dd>
        </div>
      </dl>
      {gap.skipped > 0 && (
        <p className="stats-note">{gap.skipped} order(s) had no priced items and were left out.</p>
      )}
      <p className="stats-note">
        Derived: the site shows no discount line, only the item prices and the total.
      </p>
    </Section>
  );
}

function CodesSection({ codes }) {
  const [open, setOpen] = useState(false);
  const shown = open ? codes : codes.slice(0, TOP);

  return (
    <Section id="stats-codes" title="Discount codes used" count={open ? null : `${shown.length} of ${codes.length}`}>
      <div className="table-wrapper">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Code</th>
              <th className="num">Orders</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.code}>
                <td className="code-name">{c.code}</td>
                <td className="num">{c.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowAll shown={TOP} total={codes.length} open={open} onToggle={() => setOpen(!open)} />
    </Section>
  );
}
