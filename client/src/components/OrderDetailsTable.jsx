import { useState, useMemo } from 'react';
import { useDataTable } from '../hooks/useDataTable.js';
import DataTableControls from './DataTableControls.jsx';
import Highlight from './Highlight.jsx';
import { collectFacets, matchesFacets, parseProductName } from '../../../src/product-name.js';
import { isCancelled } from '../../../src/orders-total.js';

export default function OrderDetailsTable({ details }) {
  const [series, setSeries] = useState('');
  const [kind, setKind] = useState('');
  const [set, setSet] = useState('');
  const [hideCancelled, setHideCancelled] = useState(false);

  // Options come from the whole dataset, so the selects stay stable while
  // choices are made instead of shrinking to whatever is currently on screen.
  const facets = useMemo(() => collectFacets(details), [details]);

  const active = Boolean(series || kind || set);

  // A filtered order keeps only the items that matched, so the reason a card
  // is on screen is visible in the card — the same rule `npm run find` uses
  // for item-level fields.
  const filtered = useMemo(() => {
    const rows = hideCancelled ? details.filter((o) => !isCancelled(o)) : details;
    if (!active) return rows;
    const out = [];
    for (const order of rows) {
      const items = (order.items ?? []).filter((item) =>
        matchesFacets(parseProductName(item?.name), { series, kind, set }));
      if (items.length) out.push({ ...order, items });
    }
    return out;
  }, [details, hideCancelled, active, series, kind, set]);

  const cancelledCount = useMemo(() => details.filter(isCancelled).length, [details]);

  const dt = useDataTable(filtered, { defaultPageSize: 20 });

  const filters = [
    { name: 'series', label: 'Series', value: series, options: facets.series,
      allLabel: 'All series', onChange: (v) => { setSeries(v); dt.setPage(1); } },
    { name: 'kind', label: 'Type', value: kind, options: facets.kinds,
      allLabel: 'All types', onChange: (v) => { setKind(v); dt.setPage(1); } },
    { name: 'set', label: 'Set', value: set, options: facets.sets,
      allLabel: 'All sets', onChange: (v) => { setSet(v); dt.setPage(1); } },
  ];

  const toggles = cancelledCount
    ? [{
        name: 'hideCancelled',
        label: 'Exclude cancelled',
        count: cancelledCount,
        checked: hideCancelled,
        onChange: (v) => { setHideCancelled(v); dt.setPage(1); },
      }]
    : [];

  function resetFilters() {
    setSeries('');
    setKind('');
    setSet('');
    setHideCancelled(false);
    dt.setPage(1);
  }

  if (!details.length) {
    return (
      <p className="status">
        No order details yet. Press <strong>Sync</strong> above, or run <code>npm run order-details</code>.
      </p>
    );
  }

  return (
    <div className="datatable">
      <DataTableControls
        search={dt.search}
        onSearch={dt.setSearch}
        totalRows={dt.totalRows}
        page={dt.page}
        totalPages={dt.totalPages}
        pageSize={dt.pageSize}
        onPage={dt.setPage}
        onPageSize={dt.setPageSize}
        filters={filters}
        toggles={toggles}
        onResetFilters={resetFilters}
      />
      <div className="details-list">
      {dt.rows.length === 0 && <p className="status">No results</p>}
      {dt.rows.map((order, i) => (
        <div key={i} className="order-card">
          <div className="order-card-header">
            <span className="order-number">
              <Highlight text={order['หมายเลขคำสั่งซื้อ']} query={dt.search} />
            </span>
            <span className="order-date">{order['วันที่ซื้อ']}</span>
            <span className="order-price">{order['ราคาสุทธิ']}</span>
            {order['โค้ดส่วนลด'] && order['โค้ดส่วนลด'] !== '-' && (
              <code><Highlight text={order['โค้ดส่วนลด']} query={dt.search} /></code>
            )}
            <span className={`status-badge status-${order['สถานะ']}`}>{order['สถานะ']}</span>
          </div>

          {order.items?.length > 0 ? (
            <table className="items-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, j) => (
                  <tr key={j}>
                    <td><Highlight text={item.name} query={dt.search} /></td>
                    <td><Highlight text={item.sku} query={dt.search} /></td>
                    <td>{item.quantity}</td>
                    <td>{item.price}</td>
                    <td>{item.subtotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-items">
              {active
                ? 'No matching items in this order.'
                : 'No item details — run npm run order-details to fetch.'}
            </p>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
