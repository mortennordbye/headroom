import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

// GET /api/wage-stats/occupation on the real app (throwaway DATA_DIR, ephemeral
// loopback port) with SSB replaced by a stubbed global fetch: no network. The
// test's own requests use node:http, so the stub only sees the app's SSB calls.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
let server;
let dataDir;
let base;

// One year of json-stat2 for one occupation: median, lower and upper quartile (monthly kr).
const ssbBody = (year, [median, p25, p75]) => ({
  id: ['MaaleMetode', 'Yrke', 'Sektor', 'Kjonn', 'AvtaltVanlig', 'ContentsCode', 'Tid'],
  size: [3, 1, 1, 1, 1, 1, 1],
  dimension: {
    MaaleMetode: { category: { index: { '01': 0, '051': 1, '061': 2 } } },
    Tid: { category: { index: { [year]: 0 } } },
  },
  value: [median, p25, p75],
});
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const get = (q) => new Promise((resolve, reject) => {
  http.get(`${base}/api/wage-stats/occupation${q}`, (r) => {
    let s = '';
    r.on('data', (c) => { s += c; });
    r.on('end', () => resolve({ status: r.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

async function boot() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-occwage-'));
  process.env.DATA_DIR = dataDir;
  delete process.env.DEMO_MODE;
  delete require.cache[require.resolve('./index.js')];
  const app = require('./index.js');
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
  delete process.env.DATA_DIR;
});

describe('GET /api/wage-stats/occupation', () => {
  it('refuses a code outside the allowlist without calling SSB', async () => {
    await boot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const q of ['', '?code=2523', '?code=9999', '?code=2512%26x%3D1', '?code[]=2512']) {
      expect((await get(q)).status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns annual median and quartiles, then serves the cache', async () => {
    await boot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(ssbBody('2025', [76_060, 62_660, 90_770])));
    const first = await get('?code=2512');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      code: '2512', label: 'Programvareutviklere', year: 2025,
      median: 912_720, p25: 751_920, p75: 1_089_240,
      measure: 'AvtaltManedslonn', source: 'ssb-live', stale: false,
    });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('valueCodes[Yrke]=2512');
    const second = await get('?code=2512');
    expect(second.body.median).toBe(912_720);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves out a missing quartile', async () => {
    await boot();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(ssbBody('2025', [76_060, null, null])));
    const res = await get('?code=2511');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('p25');
    expect(res.body).not.toHaveProperty('p75');
  });

  it('gives 502 when SSB fails and nothing is cached, and waits before the next attempt', async () => {
    await boot();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('down', { status: 503 }));
    expect((await get('?code=2513')).status).toBe(502);
    const calls = fetchSpy.mock.calls.length; // v2, then the v1 fallback
    expect((await get('?code=2513')).status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(calls);
  });

  it('serves an old cache as stale when SSB fails', async () => {
    await boot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(ssbBody('2024', [73_000, 60_000, 88_000])));
    expect((await get('?code=2514')).status).toBe(200);
    // Age the cache past the TTL, then let SSB fail.
    const db = new Database(path.join(dataDir, 'database.sqlite'));
    db.prepare("UPDATE occupation_wage_cache SET fetched_at = '2000-01-01T00:00:00.000Z'").run();
    db.close();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockImplementation(async () => { throw new Error('network'); });
    // The first attempt was this hour, so the cooldown keeps SSB untouched: stale cache.
    const res = await get('?code=2514');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: 2024, median: 876_000, source: 'ssb-cache', stale: true });
  });

  it('reads the cache only with cached=1: 404 before the page loaded it, the value after', async () => {
    await boot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(ssbBody('2025', [76_060, 62_660, 90_770])));
    expect((await get('?code=2521&cached=1')).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await get('?code=2521')).status).toBe(200);
    const res = await get('?code=2521&cached=1');
    expect(res.body).toMatchObject({ code: '2521', median: 912_720 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('logs only the code, not the query or the response', async () => {
    await boot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('network'); });
    await get('?code=2519');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('2519');
    expect(logged).not.toContain('valueCodes');
  });
});
