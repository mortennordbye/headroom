import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

// server/brreg.js and GET /api/brreg/:orgnr on the real app (throwaway
// DATA_DIR, ephemeral loopback port) with Brreg replaced by a stubbed global
// fetch: no network. Made-up company and numbers. The test's own requests use
// node:http, so the stub only sees the app's Brreg calls.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { parseAccounts, parseEntity, fetchBrreg, buildUrl, MAX_BODY_BYTES } = require('./brreg.js');

const ORG = '999900003';
const ORG2 = '999900011';

const entity = (patch = {}) => ({
  organisasjonsnummer: ORG,
  navn: 'Eksempel Konsulent AS',
  organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
  naeringskode1: { kode: '62.020', beskrivelse: 'Konsulentvirksomhet tilknyttet IT' },
  antallAnsatte: 52,
  forretningsadresse: { adresse: ['Gate 1'], postnummer: '0001' },
  hjemmeside: 'example.invalid',
  ...patch,
});
const account = (type, year, revenue, operatingResult, patch = {}) => ({
  id: 1,
  regnskapstype: type,
  regnskapsperiode: { fraDato: `${year}-01-01`, tilDato: `${year}-12-31` },
  valuta: 'NOK',
  resultatregnskapResultat: {
    aarsresultat: 1,
    driftsresultat: {
      driftsresultat: operatingResult,
      driftsinntekter: { sumDriftsinntekter: revenue },
      driftskostnad: { sumDriftskostnad: revenue - operatingResult },
    },
  },
  egenkapitalGjeld: { sumEgenkapitalGjeld: 5 },
  ...patch,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch stub: entity and accounts answers by URL. */
function stubBrreg({ ent = () => json(entity()), acc = () => json([account('SELSKAP', 2025, 80_000_000, 9_000_000)]) } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/enhetsregisteret/api/enheter/')) return ent(u);
    if (u.includes('/regnskapsregisteret/regnskap/')) return acc(u);
    throw new Error('unexpected url');
  });
}

describe('parseAccounts', () => {
  it('takes the newest year and the company\'s own accounts over the group\'s', () => {
    const rows = [
      account('KONSERN', 2025, 200, 20),
      account('SELSKAP', 2024, 90, 9),
      account('SELSKAP', 2025, 100, 10),
    ];
    expect(parseAccounts(rows)).toEqual({ year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 100, operatingResult: 10 });
  });

  it('uses KONSERN when that is all there is, and keeps the currency', () => {
    expect(parseAccounts([account('KONSERN', 2025, 200, 20, { valuta: 'USD' })]))
      .toEqual({ year: 2025, type: 'KONSERN', currency: 'USD', revenue: 200, operatingResult: 20 });
  });

  it('skips rows with non-finite or missing numbers, a bad period or type, and returns only allowlisted fields', () => {
    const bad = [
      account('SELSKAP', 2026, Infinity, 1),
      account('SELSKAP', 2026, 1, Number.NaN),
      account('SELSKAP', 2026, '100', 1),
      { ...account('SELSKAP', 2026, 1, 1), regnskapsperiode: { tilDato: 'soon' } },
      account('ANNET', 2026, 1, 1),
      account('SELSKAP', 2026, 1, 1, { valuta: 'kroner' }),
    ];
    expect(parseAccounts(bad)).toBeNull();
    const ok = parseAccounts([...bad, account('SELSKAP', 2023, 5, 1)]);
    expect(Object.keys(ok).sort()).toEqual(['currency', 'operatingResult', 'revenue', 'type', 'year']);
    expect(ok.year).toBe(2023);
    expect(parseAccounts(null)).toBeNull();
    expect(parseAccounts({})).toBeNull();
    expect(parseAccounts([])).toBeNull();
  });
});

describe('parseEntity', () => {
  it('keeps only name, form, NACE, employees, parent and group flags', () => {
    expect(parseEntity(entity({ overordnetEnhet: '999900011', erIKonsern: true }))).toEqual({
      name: 'Eksempel Konsulent AS', formCode: 'AS', naceCode: '62.020', employees: 52, hasParent: true, inGroup: true,
    });
  });

  it('drops bad codes and employees, and refuses a body without a name', () => {
    expect(parseEntity(entity({ organisasjonsform: { kode: '<b>' }, naeringskode1: { kode: 'x' }, antallAnsatte: -1 })))
      .toMatchObject({ formCode: '', naceCode: '', employees: null, hasParent: false, inGroup: false });
    expect(parseEntity({ ...entity(), navn: '' })).toBeNull();
    expect(parseEntity([])).toBeNull();
  });
});

describe('fetchBrreg', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds URLs only for a valid number on the fixed host', () => {
    expect(buildUrl('https://data.brreg.no/enhetsregisteret/api/enheter/', ORG)).toBe(`https://data.brreg.no/enhetsregisteret/api/enheter/${ORG}`);
    for (const bad of ['99990000', '999900004', '../../x', `${ORG}?a=1`, '']) {
      expect(() => buildUrl('https://data.brreg.no/enhetsregisteret/api/enheter/', bad)).toThrow(/invalid number/);
    }
  });

  it('asks with redirect "error" and a timeout signal', async () => {
    const spy = stubBrreg();
    await fetchBrreg(ORG);
    for (const [, init] of spy.mock.calls) {
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('is not found when the entity is 404 or 410, without asking for accounts', async () => {
    const spy = stubBrreg({ ent: () => new Response('', { status: 410 }) });
    expect(await fetchBrreg(ORG)).toEqual({ found: false });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('has no accounts when the accounts URL is 404', async () => {
    stubBrreg({ acc: () => new Response('', { status: 404 }) });
    expect(await fetchBrreg(ORG)).toMatchObject({ found: true, accounts: null });
  });

  it('fails on a redirect status, a timeout, a body over the cap and Infinity in the JSON', async () => {
    stubBrreg({ ent: () => new Response('', { status: 302, headers: { location: 'https://example.invalid/' } }) });
    await expect(fetchBrreg(ORG)).rejects.toMatchObject({ reason: 'status 302' });
    vi.restoreAllMocks();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(fetchBrreg(ORG)).rejects.toMatchObject({ reason: 'timeout' });
    vi.restoreAllMocks();

    stubBrreg({ ent: () => new Response('x'.repeat(MAX_BODY_BYTES + 1), { status: 200 }) });
    await expect(fetchBrreg(ORG)).rejects.toMatchObject({ reason: 'body too large' });
    vi.restoreAllMocks();

    // JSON.parse turns 1e999 into Infinity: the row is dropped, so there are no accounts.
    const raw = JSON.stringify([account('SELSKAP', 2025, 1, 1)]).replace('"sumDriftsinntekter":1', '"sumDriftsinntekter":1e999');
    stubBrreg({ acc: () => new Response(raw, { status: 200 }) });
    expect(await fetchBrreg(ORG)).toMatchObject({ found: true, accounts: null });
  });

  it('never puts the org number in an error', async () => {
    stubBrreg({ ent: () => new Response('down', { status: 503 }) });
    const err = await fetchBrreg(ORG).catch((e) => e);
    expect(String(err.message)).not.toContain(ORG);
  });
});

// ── The route ──────────────────────────────────────────────────────────────

let server;
let dataDir;
let base;

const get = (p) => new Promise((resolve, reject) => {
  http.get(`${base}/api/brreg/${p}`, (r) => {
    let s = '';
    r.on('data', (c) => { s += c; });
    r.on('end', () => resolve({ status: r.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

async function boot() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-brreg-'));
  process.env.DATA_DIR = dataDir;
  delete process.env.DEMO_MODE;
  delete require.cache[require.resolve('./index.js')];
  const app = require('./index.js');
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

const ageCache = (col, value) => {
  const db = new Database(path.join(dataDir, 'database.sqlite'));
  db.prepare(`UPDATE brreg_cache SET ${col} = ?`).run(value);
  db.close();
};

describe('GET /api/brreg/:orgnr', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise((resolve) => server.close(resolve));
    server = undefined;
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
    delete process.env.DATA_DIR;
  });

  it('refuses a bad number with 400 before calling Brreg', async () => {
    await boot();
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const p of ['99990000', '9999000030', '999900004', 'abcdefghi', '999900003%20', '999900003.json']) {
      expect((await get(p)).status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the entity and the newest accounts, then serves the cache', async () => {
    await boot();
    const spy = stubBrreg({ acc: () => json([account('KONSERN', 2025, 300_000_000, 1), account('SELSKAP', 2025, 80_000_000, 9_000_000)]) });
    const res = await get(ORG);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true,
      orgnr: ORG,
      entity: { name: 'Eksempel Konsulent AS', formCode: 'AS', naceCode: '62.020', employees: 52, hasParent: false, inGroup: false },
      accounts: { year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 80_000_000, operatingResult: 9_000_000 },
      stale: false,
    });
    expect(Object.keys(res.body.entity)).not.toContain('hjemmeside');
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await get(ORG)).body.accounts.revenue).toBe(80_000_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is 404 for an unknown number and 200 { noAccounts } when none are filed', async () => {
    await boot();
    stubBrreg({
      ent: (u) => (u.endsWith(ORG2) ? new Response('', { status: 404 }) : json(entity({ organisasjonsform: { kode: 'ENK' } }))),
      acc: () => new Response('', { status: 404 }),
    });
    expect(await get(ORG2)).toEqual({ status: 404, body: { error: 'not found' } });
    const res = await get(ORG);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, noAccounts: true, entity: { formCode: 'ENK' } });
    expect(res.body).not.toHaveProperty('accounts');
  });

  it('gives 200 { available: false } when Brreg is down and nothing is cached, and waits before the next try', async () => {
    await boot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = stubBrreg({ ent: () => new Response('down', { status: 503 }) });
    expect(await get(ORG)).toEqual({ status: 200, body: { available: false } });
    expect(await get(ORG)).toEqual({ status: 200, body: { available: false } });
    expect(spy).toHaveBeenCalledTimes(1);
    // The cooldown is on the row, so it survives in SQLite.
    ageCache('attempt_at', 0);
    await get(ORG);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(ORG);
  });

  it('serves a stale entry when Brreg fails after the TTL', async () => {
    await boot();
    const spy = stubBrreg();
    expect((await get(ORG)).status).toBe(200);
    ageCache('fetched_at', 0);
    ageCache('attempt_at', 0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    spy.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    const res = await get(ORG);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, stale: true, accounts: { revenue: 80_000_000 } });
  });

  it('does not log the org number', async () => {
    await boot();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubBrreg({ acc: () => new Response('x'.repeat(MAX_BODY_BYTES + 1), { status: 200 }) });
    await get(ORG);
    const logged = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().map(String).join(' ');
    expect(logged).not.toContain(ORG);
  });
});
