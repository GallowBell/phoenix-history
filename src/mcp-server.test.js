import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = fileURLToPath(new URL('./mcp-server.js', import.meta.url));

/**
 * Drives the real server over stdio, the way Claude Desktop does. Launched from
 * the temp dir with *relative* data paths, so the files are only found if the
 * server resolves them against the repo root rather than its cwd.
 */
async function connect(env) {
  const errors = [];
  const client = new Client({ name: 'mcp-server-test', version: '1.0.0' });
  // A stray stdout line from the server is not JSON-RPC; the client reports it
  // here and carries on, so this is the only place it would ever show.
  client.onerror = (e) => errors.push(e);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: tmpdir(),
    env: { ...getDefaultEnvironment(), ...env },
    stderr: 'pipe',
  }));
  return { client, errors };
}

const text = (result) => JSON.parse(result.content[0].text);

describe('mcp-server over stdio', () => {
  let ok;
  let missing;

  beforeAll(async () => {
    ok = await connect({
      ORDERS_OUTPUT_FILE: 'tests/fixtures/mcp-orders.json',
      ORDERS_DETAILS_FILE: 'tests/fixtures/mcp-orders-details.json',
    });
    missing = await connect({
      ORDERS_OUTPUT_FILE: 'tests/fixtures/does-not-exist.json',
      ORDERS_DETAILS_FILE: 'tests/fixtures/does-not-exist-details.json',
    });
  }, 30000);

  afterAll(async () => {
    await ok?.client.close();
    await missing?.client.close();
  });

  it('lists exactly the four tools', async () => {
    const { tools } = await ok.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['collection', 'refresh', 'search', 'spend']);
  });

  it('answers from the data files even when launched outside the repo', async () => {
    const spend = text(await ok.client.callTool({ name: 'spend', arguments: { by: 'month', year: 2025 } }));
    expect(spend.periods).toHaveLength(12);
    expect(spend.totals).toMatchObject({ spent: 1350, orders: 2, books: 3 });

    const search = text(await ok.client.callTool({ name: 'search', arguments: { query: 'เล่ม 3' } }));
    expect(search.total).toBe(1);

    const collection = await ok.client.callTool({ name: 'collection', arguments: { series: 'test series' } });
    expect(collection.isError).toBeFalsy();
    expect(text(collection).series[0]).toMatchObject({ volumes: [1, 3, 4], missing: [2] });
  });

  it('reports missing data files as a tool error and keeps serving', async () => {
    const r = await missing.client.callTool({ name: 'spend', arguments: { by: 'year' } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('refresh');
    expect((await missing.client.listTools()).tools).toHaveLength(4);
  });

  it('never writes anything but protocol messages to stdout', () => {
    expect(ok.errors).toEqual([]);
    expect(missing.errors).toEqual([]);
  });
});
