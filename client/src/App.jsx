import { useState, useEffect, useCallback } from 'react';
import OrdersTable from './components/OrdersTable.jsx';
import OrderDetailsTable from './components/OrderDetailsTable.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import CollectionPanel from './components/CollectionPanel.jsx';
import SyncButton from './components/SyncButton.jsx';
import { summarise, formatBaht } from '../../src/orders-total.js';

export default function App() {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Named and reusable so the Sync button can pull the new data in place
  // rather than forcing a reload, which would drop the tab and its filters.
  const loadData = useCallback(async () => {
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
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Same rule as `npm run sum` and the Excel export: cancelled orders are
  // not money spent. They are shown beside the total rather than folded in.
  const { spent, cancelledCount, cancelledAmount } = summarise(orders);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Phoenix Order History</h1>
        <div className="header-actions">
          {spent > 0 && (
            <span className="total">
              Total: {formatBaht(spent)}
              {cancelledCount > 0 && (
                <span
                  className="total-note"
                  title={`${cancelledCount} cancelled order(s), not included`}
                >
                  +{formatBaht(cancelledAmount)} cancelled
                </span>
              )}
            </span>
          )}
          <SyncButton onSynced={loadData} />
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
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button
          className={tab === 'collection' ? 'active' : ''}
          onClick={() => setTab('collection')}
        >
          Collection
        </button>
      </nav>

      <main>
        {loading && <p className="status">Loading…</p>}
        {error && <p className="status error">{error}</p>}
        {!loading && tab === 'orders' && <OrdersTable orders={orders} />}
        {!loading && tab === 'details' && <OrderDetailsTable details={details} />}
        {!loading && tab === 'stats' && <StatsPanel orders={orders} details={details} />}
        {!loading && tab === 'collection' && <CollectionPanel details={details} />}
      </main>
    </div>
  );
}
