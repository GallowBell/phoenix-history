if (!process.env.ORDERS_COOKIE) {
  console.error('Error: ORDERS_COOKIE is not set. Copy .env.example to .env and fill in your cookie.');
  process.exit(1);
}

const config = {
  url: process.env.ORDERS_URL ?? 'https://www.phoenixnext.com/sales/order/history/?limit=50',
  cookie: process.env.ORDERS_COOKIE,
  outputFile: process.env.ORDERS_OUTPUT_FILE ?? null,
};

export default config;
