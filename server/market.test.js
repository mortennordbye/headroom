import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { parseListing, parseSale, parseBatch, createMarketStore, makeMarketGate, MAX_BATCH, isDay, isPastDay, normalizeAddress } from './market.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const listing = (over = {}) => ({
  url: 'https://example.com/ad/1',
  address: 'Testveien 1',
  postnr: '0570',
  bra: 55,
  bedrooms: 2,
  askingPrice: 5_000_000,
  fellesgjeld: 200_000,
  ...over,
});

const sale = (over = {}) => ({
  address: 'Testveien 1',
  unit: 'H0201',
  postnr: '0570',
  bra: 40,
  soldPrice: 4_000_000,
  soldOn: '2026-03-16',
  ...over,
});

describe('isDay', () => {
  it('accepts real calendar days only', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-1')).toBe(false);
    expect(isDay(20260201)).toBe(false);
  });
});

describe('isPastDay', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  it('allows today and tomorrow (time zones), refuses later', () => {
    expect(isPastDay('2026-10-31', now)).toBe(true);
    expect(isPastDay('2026-11-01', now)).toBe(true);
    expect(isPastDay('2026-11-02', now)).toBe(false);
    expect(isPastDay('2099-01-01', now)).toBe(false);
    expect(isPastDay('2026-02-30', now)).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('joins a house number to its entrance letter and collapses spaces', () => {
    expect(normalizeAddress('Brekkelia 3 C')).toBe('Brekkelia 3C');
    expect(normalizeAddress('  Brekkelia   3c ')).toBe('Brekkelia 3C');
    expect(normalizeAddress('Storgata 12B, 0182 Oslo')).toBe('Storgata 12B, 0182 Oslo');
    expect(normalizeAddress('Øvre gate 5 å')).toBe('Øvre gate 5Å');
  });

  it('leaves a following word alone', () => {
    expect(normalizeAddress('Gate 5 Bygg 2')).toBe('Gate 5 Bygg 2');
    expect(normalizeAddress('Parkveien 3 Oslo')).toBe('Parkveien 3 Oslo');
  });
});

describe('parseListing / parseSale', () => {
  it('accepts a valid row and trims strings', () => {
    expect(parseListing(listing({ address: '  Testveien 1 ' })).value.address).toBe('Testveien 1');
    expect(parseSale(sale()).value.soldPrice).toBe(4_000_000);
  });

  it('rejects unknown fields instead of silently storing them', () => {
    expect(parseListing(listing({ description: 'Lys og fin' })).error).toBe('unknown field "description"');
    expect(parseListing({ ...listing(), constructor: 1 }).error).toBe('unknown field "constructor"');
    expect(parseSale(JSON.parse('{"__proto__": 1, "address": "a", "soldPrice": 1, "soldOn": "2026-01-01"}')).error)
      .toBe('unknown field "__proto__"');
    expect(parseSale(sale({ images: [] })).error).toBe('unknown field "images"');
  });

  it('requires the identifying fields', () => {
    expect(parseListing({ address: 'x' }).error).toBe('missing url');
    expect(parseSale({ address: 'x', soldPrice: 1 }).error).toBe('missing soldOn');
  });

  it('only allows http(s) URLs', () => {
    expect(parseListing(listing({ url: 'javascript:alert(1)' })).error).toBe('invalid url');
    expect(parseListing(listing({ url: 'not a url' })).error).toBe('invalid url');
  });

  it('rejects a sale date in the future', () => {
    expect(parseSale(sale({ soldOn: '2099-01-01' })).error).toBe('invalid soldOn');
  });

  it('rejects out-of-range and non-finite numbers', () => {
    expect(parseListing(listing({ askingPrice: -1 })).error).toBe('invalid askingPrice');
    expect(parseListing(listing({ bra: Number.NaN })).error).toBe('invalid bra');
    expect(parseListing(listing({ bedrooms: 2.5 })).error).toBe('invalid bedrooms');
    expect(parseSale(sale({ soldPrice: 0 })).error).toBe('invalid soldPrice');
    expect(parseSale(sale({ postnr: '570' })).error).toBe('invalid postnr');
  });

  it('treats null as "not given"', () => {
    expect(parseListing(listing({ floor: null })).value).not.toHaveProperty('floor');
  });
});

describe('parseBatch', () => {
  it('is all-or-nothing', () => {
    const r = parseBatch([listing(), { address: 'x' }], parseListing);
    expect(r.rows).toBeUndefined();
    expect(r.errors).toEqual(['row 1: missing url']);
  });

  it('caps the batch size', () => {
    const rows = Array.from({ length: MAX_BATCH + 1 }, (_, i) => listing({ url: `https://example.com/${i}` }));
    expect(parseBatch(rows, parseListing).errors[0]).toMatch(/at most/);
    expect(parseBatch([], parseListing).errors).toBeDefined();
    expect(parseBatch('nope', parseListing).errors).toBeDefined();
  });
});

describe('createMarketStore', () => {
  let store;
  beforeEach(() => {
    store = createMarketStore(new Database(':memory:'));
  });

  it('starts off and can be turned on', () => {
    expect(store.isEnabled()).toBe(false);
    store.setEnabled(true);
    expect(store.status()).toMatchObject({ enabled: true, listings: 0, sales: 0 });
  });

  it('upserts listings by URL and builds a price history', () => {
    expect(store.importListings([listing()], '2026-09-28')).toEqual({ added: 1, updated: 0, priceChanges: [] });
    const second = store.importListings([listing({ askingPrice: 4_800_000, floor: 3 })], '2026-10-25');
    expect(second).toEqual({
      added: 0,
      updated: 1,
      priceChanges: [{ url: 'https://example.com/ad/1', from: 5_000_000, to: 4_800_000 }],
    });
    expect(store.status()).toMatchObject({ listings: 1, lastListingSeen: '2026-10-25' });
  });

  it('lists listings with their first recorded asking price', () => {
    store.importListings([listing()], '2026-09-28');
    store.importListings([listing({ askingPrice: 4_800_000 })], '2026-10-25');
    store.importListings([listing({ url: 'https://example.com/ad/2', askingPrice: undefined })], '2026-10-01');
    const rows = store.listings();
    expect(rows.map((r) => r.url)).toEqual(['https://example.com/ad/1', 'https://example.com/ad/2']);
    expect(rows[0]).toMatchObject({
      askingPrice: 4_800_000, firstAskingPrice: 5_000_000, firstSeen: '2026-09-28', lastSeen: '2026-10-25', bra: 55,
    });
    expect(rows[1].firstAskingPrice).toBeNull();
  });

  it('keeps first/last seen right when an older snapshot is imported later', () => {
    store.importListings([listing()], '2026-10-25');
    store.importListings([listing()], '2026-09-28');
    expect(store.status().lastListingSeen).toBe('2026-10-25');
  });

  it('treats spelling variants of one address as the same sale', () => {
    expect(store.importSales([sale({ address: 'Testveien 3 C' })]).added).toBe(1);
    expect(store.importSales([sale({ address: 'testveien 3c' })]).added).toBe(0);
    expect(store.salesForPostnr('0570')[0].address).toBe('Testveien 3C');
  });

  it('normalizes rows stored before normalization, dropping the duplicates that exposes', () => {
    const db = new Database(':memory:');
    createMarketStore(db);
    const insert = db.prepare(
      `INSERT INTO market_sales (address, address_key, unit, postnr, sold_price, sold_on, imported_at)
       VALUES (?, ?, '', '0570', 4000000, '2026-03-01', 'x')`,
    );
    insert.run('Testveien 3 C', 'testveien 3 c'); // old spelling
    insert.run('Testveien 3C', 'testveien 3c'); // same sale, already normalized
    insert.run('Testveien 5 d', 'testveien 5 d');
    const again = createMarketStore(db); // migration runs on open
    expect(again.salesForPostnr('0570').map((r) => r.address).sort()).toEqual(['Testveien 3C', 'Testveien 5D']);
  });

  it('skips a sale imported twice, including sales without a unit', () => {
    expect(store.importSales([sale(), sale({ unit: undefined })])).toEqual({ added: 2, duplicates: 0 });
    expect(store.importSales([sale(), sale({ unit: undefined })])).toEqual({ added: 0, duplicates: 2 });
    expect(store.importSales([sale({ address: 'TESTVEIEN  1' })]).added).toBe(0);
  });

  it('returns sales for a postnummer, newest first', () => {
    store.importSales([sale({ soldOn: '2025-01-01' }), sale({ soldOn: '2026-01-01' }), sale({ postnr: '0150' })]);
    const rows = store.salesForPostnr('0570');
    expect(rows.map((r) => r.soldOn)).toEqual(['2026-01-01', '2025-01-01']);
    expect(rows[0]).toMatchObject({ address: 'Testveien 1', unit: 'H0201', bra: 40, soldPrice: 4_000_000 });
  });

  it('wipe deletes everything but keeps the setting', () => {
    store.setEnabled(true);
    store.importListings([listing()], '2026-10-25');
    store.importSales([sale()]);
    store.wipe();
    expect(store.status()).toMatchObject({ enabled: true, listings: 0, sales: 0 });
  });
});

describe('makeMarketGate', () => {
  const call = (gate, path) => {
    let status = 200;
    let nextCalled = false;
    const res = { status: (s) => { status = s; return { json: () => {} }; } };
    gate({ path }, res, () => { nextCalled = true; });
    return nextCalled ? 'next' : status;
  };

  it('closes market routes while off but leaves status, config and other routes open', () => {
    const gate = makeMarketGate(() => false);
    expect(call(gate, '/api/market/sales')).toBe(404);
    expect(call(gate, '/API/Market/listings')).toBe(404);
    expect(call(gate, '/api/market/status')).toBe('next');
    expect(call(gate, '/api/market/config')).toBe('next');
    expect(call(gate, '/api/data')).toBe('next');
  });

  it('opens everything when on', () => {
    expect(call(makeMarketGate(() => true), '/api/market/sales')).toBe('next');
  });
});
