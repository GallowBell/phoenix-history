const COMMANDS = {
  orders: () => import('./fetch-orders.js'),
  'order-details': () => import('./fetch-order-details.js'),
  sum: () => import('./sum-orders.js'),
};

const command = process.argv[2];

if (!command || !COMMANDS[command]) {
  console.error(`Usage: node src/index.js <command>`);
  console.error(`Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

const { run } = await COMMANDS[command]();

run().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
