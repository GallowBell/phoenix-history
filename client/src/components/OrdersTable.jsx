import { useState, useMemo } from 'react';
import { useDataTable } from '../hooks/useDataTable.js';
import DataTableControls from './DataTableControls.jsx';
import Highlight from './Highlight.jsx';
import { isCancelled } from '../../../src/orders-total.js';

const HIDDEN_COLS = new Set(['ที่อยู่จัดส่ง', 'สั่งซื้ออีกครั้ง']);

/** Only allow http/https URLs to prevent javascript: XSS */
export function safeHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export default function OrdersTable({ orders }) {
  const [hideCancelled, setHideCancelled] = useState(false);

  // Same rule the header total and `npm run sum` use: a cancelled order is not
  // money spent, so it is often just noise when reading the list back.
  const cancelledCount = useMemo(() => orders.filter(isCancelled).length, [orders]);
  const visible = useMemo(
    () => (hideCancelled ? orders.filter((o) => !isCancelled(o)) : orders),
    [orders, hideCancelled]);

  const dt = useDataTable(visible, { defaultPageSize: 20 });

  const toggles = cancelledCount
    ? [{
        name: 'hideCancelled',
        label: 'Exclude cancelled',
        count: cancelledCount,
        checked: hideCancelled,
        onChange: (v) => { setHideCancelled(v); dt.setPage(1); },
      }]
    : [];

  if (!orders.length) {
    return (
      <p className="status">
        No orders yet. Press <strong>Sync</strong> above, or run <code>npm run orders</code>.
      </p>
    );
  }

  const keys = Object.keys(orders[0]).filter((k) => !HIDDEN_COLS.has(k));

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
        toggles={toggles}
        onResetFilters={() => { setHideCancelled(false); dt.setPage(1); }}
      />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {keys.map((k) => (
                <th
                  key={k}
                  onClick={() => dt.toggleSort(k)}
                  className={dt.sortKey === k ? 'sorted' : ''}
                >
                  {k}
                  {dt.sortKey === k ? (dt.sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dt.rows.map((order, i) => (
              <tr key={i}>
                {keys.map((k) => (
                  <td key={k}>
                    {k === 'ดูรายละเอียด' && safeHref(order[k]) ? (
                      <a href={safeHref(order[k])} target="_blank" rel="noreferrer">View ↗</a>
                    ) : (
                      <Highlight text={order[k]} query={dt.search} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {dt.rows.length === 0 && (
              <tr><td colSpan={keys.length} className="dt-empty">No results</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
