const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { fetchCpi, withYoy } = require('./ssb');
const bank = require('./bank');

const app = express();

// Security headers. CSP is tailored to what the app actually loads: same-origin
// scripts/assets, inline styles (Tailwind v4 + Recharts inject them), and Google
// Fonts. `connect-src 'self'` keeps the API same-origin only.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      // The app is served over plain HTTP by design (loopback / reverse proxy
      // terminates TLS). Don't force sub-resources to https — that would break
      // same-origin asset loads when accessed over http on a non-loopback host.
      upgradeInsecureRequests: null,
    },
  },
  // HSTS is pointless (and can lock users out) for a plain-HTTP loopback service.
  hsts: false,
  // Fonts/assets are same-origin; the default 'require-corp' would block them.
  crossOriginEmbedderPolicy: false,
}));

// Optional Host-header allowlist (a DNS-rebinding guard). OFF by default so the
// app works behind any hostname / reverse proxy / ingress out of the box. To
// enable it, set ALLOWED_HOSTS to a comma-separated list of the hostname(s) the
// app is served on, e.g. ALLOWED_HOSTS=finance.example.com,localhost.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
if (ALLOWED_HOSTS.length > 0) {
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    if (host && !ALLOWED_HOSTS.includes(host)) {
      return res.status(403).json({ error: 'host not allowed' });
    }
    next();
  });
}

// The whole dataset is a single JSON blob that grows as transactions/snapshots
// accumulate. Keep the limit generous so a large history doesn't start silently
// 413-ing saves; the size warning below flags when it's getting big.
app.use(express.json({ limit: '10mb' }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  // Almost always a permissions problem: the data volume isn't writable by the
  // container user. Fail with a clear, actionable message instead of a raw
  // SQLITE_CANTOPEN stack trace.
  console.error(`[db] Could not open ${DB_PATH}: ${err.message}`);
  console.error(`[db] Ensure DATA_DIR (${DATA_DIR}) is writable by uid ${process.getuid ? process.getuid() : '?'}. ` +
    `For Docker, either let the container start as root (it drops to 'node' after fixing perms) or chown the volume to that user.`);
  process.exit(1);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_data (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inflation_cache (
    month TEXT PRIMARY KEY,
    cpi_index REAL NOT NULL,
    fetched_at TEXT NOT NULL
  );
`);

// Optimistic-concurrency revision. Existing volumes predate the column, so add
// it if missing (SQLite has no ADD COLUMN IF NOT EXISTS). Every write bumps rev;
// a POST carrying a stale rev is rejected (409) instead of clobbering a newer
// write from another tab/device or the bank-sync cron.
if (!db.prepare('PRAGMA table_info(finance_data)').all().some((c) => c.name === 'rev')) {
  db.exec('ALTER TABLE finance_data ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
}

const getStmt = db.prepare('SELECT content, rev FROM finance_data WHERE id = ?');
const writeStmt = db.prepare(
  'INSERT INTO finance_data (id, content, rev) VALUES (@id, @content, @rev) ' +
  'ON CONFLICT(id) DO UPDATE SET content = @content, rev = @rev'
);
// Persist `content` for `id`, bumping rev from `prevRev`. Returns the new rev.
function writeBlob(id, content, prevRev) {
  const rev = (prevRev ?? 0) + 1;
  writeStmt.run({ id, content, rev });
  return rev;
}

const inflationGetRange = db.prepare(
  'SELECT month, cpi_index AS cpiIndex, fetched_at AS fetchedAt FROM inflation_cache WHERE month >= ? AND month <= ? ORDER BY month ASC'
);
const inflationUpsert = db.prepare(
  'INSERT OR REPLACE INTO inflation_cache (month, cpi_index, fetched_at) VALUES (?, ?, ?)'
);
const inflationLatest = db.prepare(
  'SELECT MAX(fetched_at) AS latest FROM inflation_cache'
);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30 * ONE_DAY_MS;

function monthCount(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// Cheap liveness probe: exercises the DB so a hung event loop / broken SQLite
// handle fails the healthcheck instead of staying "Up" forever.
const healthStmt = db.prepare('SELECT 1 AS ok');
app.get('/healthz', (_req, res) => {
  try {
    healthStmt.get();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/data', (req, res) => {
  const row = getStmt.get('headroom');
  // The client echoes this rev back on save so we can detect a stale write.
  res.set('X-Data-Rev', String(row ? row.rev : 0));
  res.json(row ? JSON.parse(row.content) : null);
});

// Minimal shape check so a stray/garbage POST can't overwrite the single data
// row with junk (`[]`, `42`, undefined body from a missing JSON content-type).
// Not a full schema — just enough to reject anything that clearly isn't the
// finance blob. Acts as a corruption firewall.
function isValidFinancePayload(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  // Expect the core domain keys the client always persists.
  return (
    typeof body.income === 'number' &&
    typeof body.assets === 'object' && body.assets !== null &&
    Array.isArray(body.fixedExpenses) &&
    Array.isArray(body.dailyTransactions)
  );
}

const SIZE_WARN_BYTES = 2 * 1024 * 1024; // warn once the blob passes ~2 MB

// Bank-imported transactions carry this id prefix (see server/bank.js).
const EB_ID_PREFIX = bank.EB_ID_PREFIX;

// Anti-clobber: the daily bank sync (scripts/enable-banking/sync.ts) writes
// imported rows straight into the blob. If a client tab was open during a sync,
// its next full-blob autosave would be missing those rows and drop them. Re-add
// any stored eb- rows the incoming payload doesn't have, so the cron can't be
// clobbered. (Trade-off: deleting an imported row in the UI can resurrect it —
// tracked in BACKLOG.md.)
function reconcileBankTransactions(incoming) {
  const row = getStmt.get('headroom');
  if (!row) return incoming;
  let stored;
  try {
    stored = JSON.parse(row.content);
  } catch {
    return incoming;
  }
  const storedTx = Array.isArray(stored.dailyTransactions) ? stored.dailyTransactions : [];
  const incomingTx = Array.isArray(incoming.dailyTransactions) ? incoming.dailyTransactions : [];
  const incomingIds = new Set(incomingTx.map((t) => t && t.id));
  // A row the user deleted in the UI carries its id in deletedBankIds; don't
  // resurrect it even though it's still in the stored blob.
  const deletedIds = new Set(Array.isArray(incoming.deletedBankIds) ? incoming.deletedBankIds : []);
  const missing = storedTx.filter(
    (t) => t && typeof t.id === 'string' && t.id.startsWith(EB_ID_PREFIX)
      && !incomingIds.has(t.id) && !deletedIds.has(t.id),
  );
  if (missing.length === 0) return incoming;
  console.log(`[data] re-adding ${missing.length} bank tx missing from client payload`);
  return { ...incoming, dailyTransactions: [...incomingTx, ...missing] };
}

app.post('/api/data', (req, res) => {
  if (!isValidFinancePayload(req.body)) {
    return res.status(400).json({ error: 'invalid finance payload' });
  }
  const stored = getStmt.get('headroom');
  // Optimistic concurrency: if the client sent the rev it last saw and it no
  // longer matches, a newer write landed in between — reject so we don't clobber
  // it. A client that sends no rev (legacy) keeps the old last-write-wins path.
  const clientRev = req.get('X-Data-Rev');
  if (stored && clientRev != null && Number(clientRev) !== stored.rev) {
    return res.status(409).json({
      error: 'stale revision — data changed elsewhere',
      currentRev: stored.rev,
      current: JSON.parse(stored.content),
    });
  }
  const content = JSON.stringify(reconcileBankTransactions(req.body));
  if (content.length > SIZE_WARN_BYTES) {
    console.warn(`[data] payload is ${(content.length / 1024 / 1024).toFixed(1)} MB — approaching the body limit`);
  }
  const rev = writeBlob('headroom', content, stored ? stored.rev : 0);
  res.set('X-Data-Rev', String(rev));
  res.json({ ok: true, rev });
});

app.get('/api/inflation', async (req, res) => {
  const from = String(req.query.from || '').match(/^\d{4}-\d{2}$/) ? req.query.from : null;
  const to = String(req.query.to || '').match(/^\d{4}-\d{2}$/) ? req.query.to : null;
  if (!from || !to || from > to) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM and from <= to' });
  }

  // Pull a 12-month margin earlier so YoY is defined for the requested window
  const [fy, fm] = from.split('-').map(Number);
  const paddedFrom = `${fy - 1}-${String(fm).padStart(2, '0')}`;

  const cached = inflationGetRange.all(paddedFrom, to);
  const expectedCount = monthCount(paddedFrom, to);
  const latestRow = inflationLatest.get();
  const latestAt = latestRow?.latest ? Date.parse(latestRow.latest) : 0;
  const ageMs = Date.now() - latestAt;
  const needsRefresh = cached.length < expectedCount || ageMs > CACHE_TTL_MS;

  let stale = false;
  if (needsRefresh) {
    try {
      const points = await fetchCpi(paddedFrom, to);
      const now = new Date().toISOString();
      const tx = db.transaction((pts) => {
        for (const p of pts) inflationUpsert.run(p.month, p.cpiIndex, now);
      });
      tx(points);
    } catch (err) {
      console.warn('[inflation] SSB fetch failed, serving cache:', err.message);
      stale = true;
    }
  }

  const finalRows = inflationGetRange.all(paddedFrom, to);
  const points = withYoy(finalRows.map(r => ({ month: r.month, cpiIndex: r.cpiIndex })))
    .filter(p => p.month >= from);

  res.json({ points, stale, count: points.length });
});

// ── SSB wage statistics ──────────────────────────────────────────
// National median gross annual wage, full-time employees, all sectors.
// Curated from SSB publications (table 11418 / 13606). Update yearly.
// Live-fetch from SSB is on BACKLOG.md (the metadata query requires
// occupation+sector code calibration that's brittle to do blindly).
const WAGE_STATS_STATIC = [
  { year: 2020, median: 565_000 },
  { year: 2021, median: 593_500 },
  { year: 2022, median: 612_000 },
  { year: 2023, median: 657_300 },
  { year: 2024, median: 698_400 },
  { year: 2025, median: 730_000 },
];

app.get('/api/wage-stats', (_req, res) => {
  res.json({ points: WAGE_STATS_STATIC, source: 'static-curated' });
});

// ── Bank sync (Enable Banking) ───────────────────────────────────
// Drives the in-app link/re-link/sync flow. Engine in server/bank.js.

app.get('/api/bank/status', (_req, res) => {
  res.json(bank.getStatus());
});

// Upload the app's private key (write-only — never read back). Validates the
// PEM and verifies it against Enable Banking before storing it (chmod 600,
// encrypted at rest when EB_KEY_SECRET is set).
app.post('/api/bank/key', async (req, res) => {
  try {
    const pem = req.body && req.body.pem;
    if (typeof pem !== 'string' || !pem.includes('PRIVATE KEY')) {
      return res.status(400).json({ error: 'expected a PEM private key' });
    }
    const { verified, encrypted } = await bank.saveKey(pem);
    res.json({ ok: true, verified, encrypted, ...bank.getStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Set the redirect (callback) URL — a non-secret setting stored server-side.
app.post('/api/bank/config', (req, res) => {
  try {
    bank.setRedirect(String((req.body && req.body.redirectUrl) || ''));
    res.json({ ok: true, ...bank.getStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Start BankID: returns the redirect url the client sends the browser to.
app.post('/api/bank/link', async (_req, res) => {
  try {
    res.json(await bank.startLink());
  } catch (err) {
    console.error('[bank] link failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// BankID redirect lands here; exchange the code, save the session, bounce to Settings.
app.get('/api/bank/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await bank.finishLink(String(req.query.code || ''), String(req.query.state || ''));
    res.redirect('/settings?bank=linked');
  } catch (err) {
    console.error('[bank] callback failed:', err.message);
    res.redirect(`/settings?bank=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// Fetch new transactions and merge them into the finance blob.
app.post('/api/bank/sync', async (_req, res) => {
  try {
    const mapped = await bank.fetchMappedTransactions();
    const row = getStmt.get('headroom');
    if (!row) return res.status(409).json({ error: 'no finance data yet — open the app first' });
    const blob = JSON.parse(row.content);
    const existing = Array.isArray(blob.dailyTransactions) ? blob.dailyTransactions : [];
    const before = existing.length;
    const deletedIds = Array.isArray(blob.deletedBankIds) ? blob.deletedBankIds : [];
    blob.dailyTransactions = bank.mergeTransactions(existing, mapped, deletedIds);
    // Bump rev so an open client's next autosave sees the conflict and refetches
    // the freshly-synced rows instead of overwriting them.
    writeBlob('headroom', JSON.stringify(blob), row.rev);
    bank.recordSync();
    res.json({
      ok: true,
      fetched: mapped.length,
      added: blob.dailyTransactions.length - before,
      total: blob.dailyTransactions.length,
      dailyTransactions: blob.dailyTransactions,
    });
  } catch (err) {
    if (err.needsRelink) return res.status(409).json({ error: err.message, needsRelink: true });
    console.error('[bank] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // A missing hashed asset (e.g. a stale chunk after redeploy) must 404, not
  // fall through to the SPA handler — returning index.html (text/html) for a
  // /assets/*.js request triggers a MIME error and a blank screen instead of a
  // catchable "chunk failed to load".
  app.get(/^\/assets\//, (_req, res) => res.sendStatus(404));
  // SPA fallback. Regex route (not the bare '*' string) for Express 5 /
  // path-to-regexp v8 compatibility; matches any unhandled GET.
  app.get(/.*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
