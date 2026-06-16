const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { fetchCpi, withYoy } = require('./ssb');

const app = express();
app.use(express.json({ limit: '2mb' }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'database.sqlite'));

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

const getStmt = db.prepare('SELECT content FROM finance_data WHERE id = ?');
const upsertStmt = db.prepare('INSERT OR REPLACE INTO finance_data (id, content) VALUES (?, ?)');

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

app.get('/api/data', (req, res) => {
  const row = getStmt.get('headroom');
  res.json(row ? JSON.parse(row.content) : null);
});

app.post('/api/data', (req, res) => {
  upsertStmt.run('headroom', JSON.stringify(req.body));
  res.json({ ok: true });
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

const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback. Regex route (not the bare '*' string) for Express 5 /
  // path-to-regexp v8 compatibility; matches any unhandled GET.
  app.get(/.*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
