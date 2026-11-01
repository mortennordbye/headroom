// Market data through the real server and the real MCP protocol, against a
// throwaway DATA_DIR (never live data): the opt-in switch hides and shows the
// tools, imports are validated by the server, and the valuation reads them.
// The SSB m² cache is seeded before the server starts, so nothing here reaches
// SSB and the expected numbers are exact.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fullFixture } from './fixture';
import { freePort } from './freePort';

let PORT: number;
let BASE: string;
const MARKET_TOOLS = ['import_listings', 'import_sales', 'get_home_valuation'];

let proc: ChildProcess;
let mcp: Client;
let syncOptIn: () => Promise<void>;

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('throwaway server did not become healthy');
}

const setEnabled = (enabled: boolean, wipe?: boolean) =>
  fetch(`${BASE}/api/market/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-headroom-source': 'ui' },
    body: JSON.stringify({ enabled, wipe }),
  });

/**
 * A flat SSB series (100 000 kr/m²) for the test home's kommune (postnr 0570 →
 * 0301, type '00'), fetched "now" so the server treats it as fresh. Same table
 * shape server/index.js creates; its CREATE IF NOT EXISTS keeps these rows.
 */
function seedSsbCache(file: string) {
  const req = createRequire(join(import.meta.dirname, '..', 'server', 'package.json'));
  type Db = { exec(sql: string): void; prepare(sql: string): { run(...params: unknown[]): void }; close(): void };
  const Database = req('better-sqlite3') as new (file: string) => Db;
  const db = new Database(file);
  db.exec(`CREATE TABLE IF NOT EXISTS kvmpris_cache (
    region TEXT NOT NULL, boligtype TEXT NOT NULL, quarter TEXT NOT NULL,
    price REAL, sales REAL, fetched_at TEXT NOT NULL, PRIMARY KEY (region, boligtype, quarter))`);
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT INTO kvmpris_cache VALUES (?, ?, ?, ?, ?, ?)');
  for (const q of ['2025K4', '2026K1', '2026K2', '2026K3']) ins.run('0301', '00', q, 100_000, 1000, now);
  db.close();
}

async function toolNames(): Promise<string[]> {
  return (await mcp.listTools()).tools.map((t) => t.name);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: !!r.isError, text: r.content[0].text, json: <T = unknown>() => JSON.parse(r.content[0].text) as T };
}

beforeAll(async () => {
  PORT = await freePort();
  BASE = `http://localhost:${PORT}`;
  process.env.HEADROOM_URL = BASE;
  const dir = mkdtempSync(join(tmpdir(), 'hr-market-'));
  seedSsbCache(join(dir, 'database.sqlite'));
  proc = spawn('node', ['server/index.js'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForHealth();
  const blob = fullFixture();
  blob.residences = [{ id: 'r1', address: 'Testveien 3D', postalCode: '0570', sizeSqm: 40, moveInDate: '2020-01', moveOutDate: null }];
  await fetch(`${BASE}/api/data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-data-rev': '0' },
    body: JSON.stringify(blob),
  });

  const { createServer } = await import('./createServer'); // after HEADROOM_URL is set
  const built = createServer();
  syncOptIn = built.syncOptIn;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await built.server.connect(serverSide);
  mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(clientSide);
}, 30000);

afterAll(async () => {
  await mcp?.close();
  proc?.kill();
});

describe('market data opt-in', () => {
  it('is off by default: the tools are hidden and the routes 404', async () => {
    await syncOptIn();
    expect(await toolNames()).not.toEqual(expect.arrayContaining([MARKET_TOOLS[0]]));
    expect((await fetch(`${BASE}/api/market/sales?postnr=0570`)).status).toBe(404);
    expect(await (await fetch(`${BASE}/api/market/status`)).json()).toMatchObject({ enabled: false });
  });

  it('config needs the app header', async () => {
    const res = await fetch(`${BASE}/api/market/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  it('turning it on shows the tools', async () => {
    expect((await setEnabled(true)).ok).toBe(true);
    await syncOptIn();
    expect(await toolNames()).toEqual(expect.arrayContaining(MARKET_TOOLS));
  });

  it('with no comparables the valuation falls back to the SSB m² price', async () => {
    const r = await call('get_home_valuation');
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({ method: 'ssb', estimate: 4_000_000, perSqm: 100_000, currentValueInApp: 4_000_000 });
  });

  it('imports sold homes and values the home from them', async () => {
    const sales = [3_800_000, 4_000_000, 4_200_000, 4_400_000].map((soldPrice, i) => ({
      address: `Testveien 3${'ABCE'[i]}`, postnr: '0570', bra: 40, soldPrice, soldOn: '2026-03-01',
    }));
    expect((await call('import_sales', { sales })).json()).toEqual({ added: 4, duplicates: 0 });
    expect((await call('import_sales', { sales })).json()).toEqual({ added: 0, duplicates: 4 });
    const v = (await call('get_home_valuation')).json<{ confidence: { level: string } }>();
    // Flat index (no adjustment), same date and size (equal weights): the
    // weighted 25/50/75 of 95–110k/m² × 40 m².
    expect(v).toMatchObject({
      method: 'comparables', scope: 'street', count: 4, sameRooms: false, timeAdjusted: true,
      low: 3_900_000, mid: 4_100_000, high: 4_300_000,
    });
    expect(v.confidence.level).toBe('medium'); // 4 sales (not fewer than 4), newest 8 months old
  });

  it('imports listings and reports asking-price changes between snapshots', async () => {
    const ad = { url: 'https://example.com/ad/1', address: 'Annengata 2', postnr: '0570', bra: 60, askingPrice: 5_000_000 };
    expect((await call('import_listings', { listings: [ad], seenOn: '2026-09-28' })).json()).toMatchObject({ added: 1 });
    const second = (await call('import_listings', { listings: [{ ...ad, askingPrice: 4_800_000 }], seenOn: '2026-10-25' })).json<{ priceChanges: unknown }>();
    expect(second.priceChanges).toEqual([{ url: ad.url, from: 5_000_000, to: 4_800_000 }]);
  });

  it('rejects fields outside the allowlist', async () => {
    const r = await call('import_listings', { listings: [{ url: 'https://example.com/ad/2', description: 'Lys og fin' }] });
    expect(r.isError).toBe(true);
    const res = await fetch(`${BASE}/api/market/listings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-headroom-source': 'test' },
      body: JSON.stringify({ listings: [{ url: 'https://example.com/ad/2', description: 'Lys og fin' }] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details).toEqual(['row 0: unknown field "description"']);
  });

  it('rejects a snapshot date in the future', async () => {
    const res = await fetch(`${BASE}/api/market/listings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-headroom-source': 'test' },
      body: JSON.stringify({ seenOn: '2099-01-01', listings: [{ url: 'https://example.com/ad/3' }] }),
    });
    expect(res.status).toBe(400);
    expect((await call('import_listings', { seenOn: '2099-01-01', listings: [{ url: 'https://example.com/ad/3' }] })).isError).toBe(true);
  });

  it('turning it off with wipe deletes the data and hides the tools again', async () => {
    const status = await (await setEnabled(false, true)).json();
    expect(status).toMatchObject({ enabled: false, listings: 0, sales: 0 });
    await syncOptIn();
    expect(await toolNames()).not.toEqual(expect.arrayContaining([MARKET_TOOLS[0]]));
  });
});
