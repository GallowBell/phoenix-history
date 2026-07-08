// Ensures modules that read process.env at import time (e.g. orders-config.js,
// which calls process.exit(1) if ORDERS_COOKIE is missing) don't crash the test run.
process.env.ORDERS_COOKIE ??= 'test-cookie';
process.env.ORDERS_URL ??= 'https://example.test/sales/order/history/?limit=50';
