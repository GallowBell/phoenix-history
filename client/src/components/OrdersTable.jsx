import { useDataTable } from '../hooks/useDataTable.js';
import DataTableControls from './DataTableControls.jsx';

const HIDDEN_COLS = new Set(['ที่อยู่จัดส่ง', 'สั่งซื้ออีกครั้ง']);

export default function OrdersTable({ orders }) {
  const dt = useDataTable(orders, { defaultPageSize: 20 });

  if (!orders.length) {
    return (
      <p className="status">
        No orders found. Run <code>npm run orders</code> first.
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
                    {k === 'ดูรายละเอียด' && order[k] ? (
                      <a href={order[k]} target="_blank" rel="noreferrer">View ↗</a>
                    ) : (
                      order[k]
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
