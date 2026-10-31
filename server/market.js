// Housing-market data: homes for sale and sold comparables, imported by the user
// (usually through an AI client over MCP) and used for the home-value estimate.
//
// Opt-in: off until the user turns it on (Bolig page → Marked tab). While off, every
// /api/market/* route except status/config answers 404 (see makeMarketGate).
// Headroom never fetches market data itself; it only stores what is imported.
//
// Stored in its own tables in the main SQLite file, NOT in the finance blob:
// the blob is rewritten whole on every autosave and this data grows without a
// natural bound. Living in the same file means the rotating on-disk backups
// cover it, and turning the feature off with "delete" empties the tables.
//
// Only facts are accepted (prices, sizes, dates, location). There are no fields
// for photos or ad text. Every row is validated against an allowlist; a batch
// with any invalid row is rejected whole, so a half-imported batch can't happen.

const MAX_BATCH = 500;

const DWELLING_TYPES = ['leilighet', 'enebolig', 'rekkehus', 'tomannsbolig', 'hytte', 'other'];
const OWNERSHIP_TYPES = ['selveier', 'borettslag', 'aksjeleilighet', 'other'];
const LISTING_STATUSES = ['active', 'sold', 'withdrawn'];

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// --- validation ---------------------------------------------------------------

/**
 * One spelling per address: whitespace collapsed and a house number joined to
 * its entrance letter, upper-cased ("Storgata  3 c" → "Storgata 3C"), so the
 * same building imported from two sources is one address.
 */
function normalizeAddress(address) {
  return address
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d+) ?([a-zæøå])(?![a-zæøå])/gi, (_, n, letter) => `${n}${letter.toUpperCase()}`);
}

/** The case-insensitive key sales are de-duplicated on. */
const addressKey = (address) => normalizeAddress(address).toLowerCase();

function isDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * A real day that isn't in the future. One day of slack, so a client a time
 * zone ahead of the server isn't refused. A future date would never age out
 * (first/last seen are kept as min/max).
 */
function isPastDay(v, now = new Date()) {
  if (!isDay(v)) return false;
  const latest = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  return v <= latest;
}

// Field specs: [kind, options]. Kinds: text, num, int, enum, day, url, postnr.
const COMMON_FIELDS = {
  address: ['text', { max: 200 }],
  unit: ['text', { max: 20 }],
  postnr: ['postnr'],
  area: ['text', { max: 100 }],
  lat: ['num', { min: -90, max: 90 }],
  lng: ['num', { min: -180, max: 180 }],
  dwellingType: ['enum', { values: DWELLING_TYPES }],
  ownership: ['enum', { values: OWNERSHIP_TYPES }],
  bra: ['num', { min: 1, max: 5000 }],
  bedrooms: ['int', { min: 0, max: 50 }],
  floor: ['int', { min: -5, max: 200 }],
  yearBuilt: ['int', { min: 1500, max: 2100 }],
  askingPrice: ['num', { min: 0, max: 1e10 }],
  fellesgjeld: ['num', { min: 0, max: 1e10 }],
  source: ['text', { max: 100 }],
};

const LISTING_FIELDS = {
  ...COMMON_FIELDS,
  url: ['url'],
  felleskost: ['num', { min: 0, max: 1e7 }],
  status: ['enum', { values: LISTING_STATUSES }],
};

const SALE_FIELDS = {
  ...COMMON_FIELDS,
  url: ['url'],
  soldPrice: ['num', { min: 1, max: 1e10 }],
  soldOn: ['day'],
};

const LISTING_REQUIRED = ['url'];
const SALE_REQUIRED = ['address', 'soldPrice', 'soldOn'];

function checkField(kind, opts, v) {
  switch (kind) {
    case 'text':
      return typeof v === 'string' && v.trim().length > 0 && v.length <= opts.max;
    case 'num':
      return typeof v === 'number' && Number.isFinite(v) && v >= opts.min && v <= opts.max;
    case 'int':
      return Number.isInteger(v) && v >= opts.min && v <= opts.max;
    case 'enum':
      return opts.values.includes(v);
    case 'day':
      return isPastDay(v);
    case 'postnr':
      return typeof v === 'string' && /^\d{4}$/.test(v);
    case 'url': {
      if (typeof v !== 'string' || v.length > 500) return false;
      try {
        const u = new URL(v);
        // Rendered as a link in the UI, so only http(s) — never javascript: etc.
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Validate one row against an allowlist. Returns { value } or { error }. */
function parseRow(row, fields, required) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: 'not an object' };
  const value = {};
  for (const [key, v] of Object.entries(row)) {
    // Own keys only: `constructor` or `__proto__` must read as unknown fields.
    const spec = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!spec) return { error: `unknown field "${key}"` };
    if (v === null || v === undefined) continue;
    if (!checkField(spec[0], spec[1] || {}, v)) return { error: `invalid ${key}` };
    value[key] = key === 'address' ? normalizeAddress(v) : typeof v === 'string' ? v.trim() : v;
  }
  for (const key of required) {
    if (value[key] === undefined) return { error: `missing ${key}` };
  }
  return { value };
}

const parseListing = (row) => parseRow(row, LISTING_FIELDS, LISTING_REQUIRED);
const parseSale = (row) => parseRow(row, SALE_FIELDS, SALE_REQUIRED);

/**
 * Validate a whole batch. All-or-nothing: returns { rows } when every row is
 * valid, or { errors } (the first few, with their index) when any is not.
 */
function parseBatch(rows, parse) {
  if (!Array.isArray(rows) || rows.length === 0) return { errors: ['expected a non-empty array'] };
  if (rows.length > MAX_BATCH) return { errors: [`at most ${MAX_BATCH} rows per import`] };
  const out = [];
  const errors = [];
  rows.forEach((row, i) => {
    const r = parse(row);
    if (r.error) errors.push(`row ${i}: ${r.error}`);
    else out.push(r.value);
  });
  if (errors.length) return { errors: errors.slice(0, 10) };
  return { rows: out };
}

// --- storage ------------------------------------------------------------------

const LISTING_COLUMNS = {
  address: 'address', unit: 'unit', postnr: 'postnr', area: 'area', lat: 'lat', lng: 'lng',
  dwellingType: 'dwelling_type', ownership: 'ownership', bra: 'bra', bedrooms: 'bedrooms',
  floor: 'floor', yearBuilt: 'year_built', askingPrice: 'asking_price', fellesgjeld: 'fellesgjeld',
  felleskost: 'felleskost', status: 'status', source: 'source',
};

/** Create the market tables on `db` and return the store's operations. */
function createMarketStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_config (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_listings (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      address TEXT, unit TEXT, postnr TEXT, area TEXT, lat REAL, lng REAL,
      dwelling_type TEXT, ownership TEXT, bra REAL, bedrooms INTEGER, floor INTEGER,
      year_built INTEGER, asking_price REAL, fellesgjeld REAL, felleskost REAL,
      status TEXT, source TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS market_listings_postnr ON market_listings (postnr);
    -- One asking price per listing per day it was seen: re-importing builds the
    -- price history (drops, time on market) for free.
    CREATE TABLE IF NOT EXISTS market_listing_prices (
      listing_id INTEGER NOT NULL REFERENCES market_listings (id) ON DELETE CASCADE,
      seen_on TEXT NOT NULL,
      asking_price REAL NOT NULL,
      PRIMARY KEY (listing_id, seen_on)
    );
    CREATE TABLE IF NOT EXISTS market_sales (
      id INTEGER PRIMARY KEY,
      address TEXT NOT NULL,
      address_key TEXT NOT NULL,
      unit TEXT, postnr TEXT, area TEXT, lat REAL, lng REAL,
      dwelling_type TEXT, ownership TEXT, bra REAL, bedrooms INTEGER, floor INTEGER,
      year_built INTEGER, asking_price REAL, sold_price REAL NOT NULL, fellesgjeld REAL,
      sold_on TEXT NOT NULL, url TEXT, source TEXT,
      imported_at TEXT NOT NULL,
      UNIQUE (address_key, unit, sold_on, sold_price)
    );
    CREATE INDEX IF NOT EXISTS market_sales_postnr ON market_sales (postnr);
  `);

  // Bring rows imported before addresses were normalized into one spelling.
  // Idempotent: only rows whose address changes are touched. A sale that turns
  // out to duplicate an already-normalized one is dropped.
  db.transaction(() => {
    const update = db.prepare('UPDATE OR IGNORE market_sales SET address = ?, address_key = ? WHERE id = ?');
    const drop = db.prepare('DELETE FROM market_sales WHERE id = ?');
    for (const r of db.prepare('SELECT id, address, address_key AS k FROM market_sales').all()) {
      const address = normalizeAddress(r.address);
      if (address === r.address && addressKey(address) === r.k) continue;
      if (update.run(address, addressKey(address), r.id).changes === 0) drop.run(r.id);
    }
    const updateListing = db.prepare('UPDATE market_listings SET address = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, address FROM market_listings WHERE address IS NOT NULL').all()) {
      const address = normalizeAddress(r.address);
      if (address !== r.address) updateListing.run(address, r.id);
    }
  })();

  const configGet = db.prepare("SELECT enabled FROM market_config WHERE id = 'market'");
  const configSet = db.prepare(
    "INSERT INTO market_config (id, enabled, updated_at) VALUES ('market', ?, ?) " +
    'ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at',
  );
  const countListings = db.prepare('SELECT COUNT(*) AS n, MAX(last_seen) AS last FROM market_listings');
  const countSales = db.prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS last FROM market_sales');
  const listingByUrl = db.prepare('SELECT id, first_seen, last_seen FROM market_listings WHERE url = ?');
  const listingInsert = db.prepare(
    `INSERT INTO market_listings (url, ${Object.values(LISTING_COLUMNS).join(', ')}, first_seen, last_seen)
     VALUES (@url, ${Object.keys(LISTING_COLUMNS).map((k) => `@${k}`).join(', ')}, @seenOn, @seenOn)`,
  );
  const priceUpsert = db.prepare(
    'INSERT INTO market_listing_prices (listing_id, seen_on, asking_price) VALUES (?, ?, ?) ' +
    'ON CONFLICT(listing_id, seen_on) DO UPDATE SET asking_price = excluded.asking_price',
  );
  const priceBefore = db.prepare(
    'SELECT asking_price AS p FROM market_listing_prices WHERE listing_id = ? AND seen_on < ? ORDER BY seen_on DESC LIMIT 1',
  );
  const saleInsert = db.prepare(
    `INSERT OR IGNORE INTO market_sales
       (address, address_key, unit, postnr, area, lat, lng, dwelling_type, ownership, bra, bedrooms, floor,
        year_built, asking_price, sold_price, fellesgjeld, sold_on, url, source, imported_at)
     VALUES (@address, @addressKey, @unit, @postnr, @area, @lat, @lng, @dwellingType, @ownership, @bra, @bedrooms,
        @floor, @yearBuilt, @askingPrice, @soldPrice, @fellesgjeld, @soldOn, @url, @source, @importedAt)`,
  );
  const salesByPostnr = db.prepare(
    `SELECT address, unit, postnr, area, dwelling_type AS dwellingType, ownership, bra, bedrooms, floor,
            year_built AS yearBuilt, asking_price AS askingPrice, sold_price AS soldPrice, fellesgjeld,
            sold_on AS soldOn, url
       FROM market_sales WHERE postnr = ? ORDER BY sold_on DESC LIMIT 2000`,
  );

  // Newest-seen first; firstAskingPrice is the earliest recorded price, so the
  // client can show how much the price has moved since the listing appeared.
  const listingsAll = db.prepare(
    `SELECT l.url, l.address, l.unit, l.postnr, l.area, l.dwelling_type AS dwellingType, l.ownership, l.bra,
            l.bedrooms, l.floor, l.year_built AS yearBuilt, l.asking_price AS askingPrice, l.fellesgjeld,
            l.felleskost, l.status, l.first_seen AS firstSeen, l.last_seen AS lastSeen,
            (SELECT p.asking_price FROM market_listing_prices p WHERE p.listing_id = l.id
              ORDER BY p.seen_on ASC LIMIT 1) AS firstAskingPrice
       FROM market_listings l ORDER BY l.last_seen DESC, l.id DESC LIMIT 2000`,
  );

  const withNulls = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));

  function isEnabled() {
    return !!configGet.get()?.enabled;
  }

  function setEnabled(enabled) {
    configSet.run(enabled ? 1 : 0, new Date().toISOString());
  }

  function status() {
    const l = countListings.get();
    const s = countSales.get();
    return {
      enabled: isEnabled(),
      listings: l.n,
      sales: s.n,
      lastListingSeen: l.last || null,
      lastSalesImport: s.last || null,
    };
  }

  /**
   * Upsert listings by URL and record each asking price for `seenOn`. Fields
   * left out of a re-import keep their stored value.
   */
  const importListings = db.transaction((rows, seenOn) => {
    let added = 0;
    let updated = 0;
    const priceChanges = [];
    for (const input of rows) {
      const row = input.address ? { ...input, address: normalizeAddress(input.address) } : input;
      const existing = listingByUrl.get(row.url);
      let id;
      if (!existing) {
        id = listingInsert.run({ url: row.url, seenOn, ...withNulls(row, Object.keys(LISTING_COLUMNS)) }).lastInsertRowid;
        added++;
      } else {
        id = existing.id;
        const set = Object.keys(LISTING_COLUMNS).filter((k) => row[k] !== undefined);
        const params = { id, first: existing.first_seen < seenOn ? existing.first_seen : seenOn,
          last: existing.last_seen > seenOn ? existing.last_seen : seenOn };
        for (const k of set) params[k] = row[k];
        db.prepare(
          `UPDATE market_listings SET ${[...set.map((k) => `${LISTING_COLUMNS[k]} = @${k}`),
            'first_seen = @first', 'last_seen = @last'].join(', ')} WHERE id = @id`,
        ).run(params);
        updated++;
      }
      if (row.askingPrice !== undefined) {
        const prev = priceBefore.get(id, seenOn);
        if (prev && prev.p !== row.askingPrice) {
          priceChanges.push({ url: row.url, from: prev.p, to: row.askingPrice });
        }
        priceUpsert.run(id, seenOn, row.askingPrice);
      }
    }
    return { added, updated, priceChanges };
  });

  /** Insert sold comparables; an identical sale imported twice is skipped. */
  const importSales = db.transaction((rows) => {
    const importedAt = new Date().toISOString();
    let added = 0;
    for (const row of rows) {
      const info = saleInsert.run({
        ...withNulls(row, Object.keys(SALE_FIELDS)),
        address: normalizeAddress(row.address),
        addressKey: addressKey(row.address),
        // UNIQUE treats NULLs as distinct, so a missing unit is stored as ''
        // to keep the duplicate check working for sales without one.
        unit: row.unit ?? '',
        importedAt,
      });
      added += info.changes;
    }
    return { added, duplicates: rows.length - added };
  });

  function salesForPostnr(postnr) {
    return salesByPostnr.all(postnr).map((r) => ({ ...r, unit: r.unit || null }));
  }

  function listings() {
    return listingsAll.all();
  }

  const wipe = db.transaction(() => {
    db.exec('DELETE FROM market_listing_prices; DELETE FROM market_listings; DELETE FROM market_sales;');
  });

  return { isEnabled, setEnabled, status, importListings, importSales, salesForPostnr, listings, wipe };
}

/**
 * 404 every /api/market/* route except status and config while the feature is
 * off, so nothing can be read or written until the user opts in.
 */
function makeMarketGate(isEnabled) {
  const open = ['/api/market/status', '/api/market/config'];
  return (req, res, next) => {
    const p = (req.path || '').toLowerCase();
    if (!p.startsWith('/api/market')) return next();
    if (open.includes(p) || isEnabled()) return next();
    return res.status(404).json({ error: 'market data is turned off' });
  };
}

module.exports = {
  MAX_BATCH, DWELLING_TYPES, OWNERSHIP_TYPES, LISTING_STATUSES,
  isDay, isPastDay, normalizeAddress, parseListing, parseSale, parseBatch, createMarketStore, makeMarketGate,
};
