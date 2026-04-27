import { useDataTable } from '../hooks/useDataTable.js';
import DataTableControls from './DataTableControls.jsx';

export default function OrderDetailsTable({ details }) {
  const dt = useDataTable(details, { defaultPageSize: 20 });

  if (!details.length) {
    return (
      <p className="status">
        No order details found. Run <code>npm run order-details</code> first.
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
      />
      <div className="details-list">
      {dt.rows.length === 0 && <p className="status">No results</p>}
      {dt.rows.map((order, i) => (
        <div key={i} className="order-card">
          <div className="order-card-header">
            <span className="order-number">{order['หมายเลขคำสั่งซื้อ']}</span>
            <span className="order-date">{order['วันที่ซื้อ']}</span>
            <span className="order-price">{order['ราคาสุทธิ']}</span>
            {order['โค้ดส่วนลด'] && order['โค้ดส่วนลด'] !== '-' && (
              <code>{order['โค้ดส่วนลด']}</code>
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
                    <td>{item.name}</td>
                    <td>{item.sku}</td>
                    <td>{item.quantity}</td>
                    <td>{item.price}</td>
                    <td>{item.subtotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-items">No item details — run npm run order-details to fetch.</p>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
