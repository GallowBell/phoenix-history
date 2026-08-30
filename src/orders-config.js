if (!process.env.ORDERS_COOKIE) {
  console.error('Error: ORDERS_COOKIE is not set. Copy .env.example to .env and fill in your cookie.');
  process.exit(1);
}

const config = {
  url: process.env.ORDERS_URL ?? 'https://www.phoenixnext.com/sales/order/history/?limit=50',
  // A getter, not a snapshot: when a run stops on an expired session and the
  // user pastes a fresh cookie, the retry has to pick up the new value. A
  // captured string would silently retry with the dead one.
  get cookie() {
    return process.env.ORDERS_COOKIE;
  },
  outputFile: process.env.ORDERS_OUTPUT_FILE ?? null,
};

export default config;
