import { useState, useEffect } from 'react';
import OrdersTable from './components/OrdersTable.jsx';
import OrderDetailsTable from './components/OrderDetailsTable.jsx';

export default function App() {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ordersRes, detailsRes] = await Promise.allSettled([
          fetch('/api/orders').then((r) => r.json()),
          fetch('/api/order-details').then((r) => r.json()),
        ]);
        if (ordersRes.status === 'fulfilled' && Array.isArray(ordersRes.value)) {
          setOrders(ordersRes.value);
        }
        if (detailsRes.status === 'fulfilled' && Array.isArray(detailsRes.value)) {
          setDetails(detailsRes.value);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const total = orders.reduce((sum, o) => {
    const v = parseFloat((o['ราคาสุทธิ'] ?? '').replace(/[฿,]/g, ''));
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Phoenix Order History</h1>
        <div className="header-actions">
          {total > 0 && (
            <span className="total">
              Total: 
              ฿{total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          )}
          <a href="/api/excel/download" className="btn-excel" download>
            ⬇ Download Excel
          </a>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          Orders {orders.length > 0 && <span className="badge">{orders.length}</span>}
        </button>
        <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>
          Order Details {details.length > 0 && <span className="badge">{details.length}</span>}
        </button>
      </nav>

      <main>
        {loading && <p className="status">Loading…</p>}
        {error && <p className="status error">{error}</p>}
        {!loading && tab === 'orders' && <OrdersTable orders={orders} />}
        {!loading && tab === 'details' && <OrderDetailsTable details={details} />}
      </main>
    </div>
  );
}
