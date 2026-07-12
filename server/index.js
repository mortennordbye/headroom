const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { fetchCpi, withYoy } = require('./ssb');
const bank = require('./bank');
const { startBackupSchedule, parseCount } = require('./backup');
const pkg = require('./package.json');

// Build identity. CI passes the commit SHA as BUILD_SHA (see Dockerfile / the
// build workflow's build-args); local runs report 'dev'. Together with the
// package version this makes "what am I running" answerable via /api/version.
const BUILD_SHA = process.env.BUILD_SHA || 'dev';

const app = express();

// Security headers. CSP is tailored to what the app actually loads: same-origin
// scripts/assets, inline styles (Tailwind v4 + Recharts inject them), and Google
// Fonts. `connect-src 'self'` keeps the API same-origin only.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
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

// Read + parse the single stored finance blob. Returns { content, rev } or null
// when the row is missing or its JSON is corrupt — callers decide the fallback
// (send null, keep the incoming payload, or 409). Guards the parse that was
// previously unguarded in /api/bank/sync.
function readBlob(id = 'headroom') {
  const row = getStmt.get(id);
  if (!row) return null;
  try {
    return { content: JSON.parse(row.content), rev: row.rev };
  } catch {
    return null;
  }
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
// Upstream-attempt throttle: at most one SSB call per hour, regardless of
// outcome. Without it, any state that keeps `needsRefresh` true (SSB outage,
// an API change, or a requested range SSB simply doesn't have) turns EVERY
// page load into an SSB hit — log spam at best, a block at worst (SSB's
// limit is 30 req/min/IP). In-memory is fine: one process, and a restart
// granting one fresh attempt is harmless.
const SSB_ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;
let lastSsbAttemptAt = 0;

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

// "What version am I running." version is the single source in package.json;
// sha is the CI-stamped commit ('dev' locally).
app.get('/api/version', (_req, res) => {
  res.json({ version: pkg.version, sha: BUILD_SHA });
});

app.get('/api/data', (req, res) => {
  const blob = readBlob();
  // The client echoes this rev back on save so we can detect a stale write.
  res.set('X-Data-Rev', String(blob ? blob.rev : 0));
  res.json(blob ? blob.content : null);
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
  const blob = readBlob();
  if (!blob) return incoming;
  const stored = blob.content;
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

// Guard user-authored fields (custom account names, categorization/label rules,
// category budgets, bank-row soft-deletes) against a write that omits the field
// entirely — e.g. an older/cached client build that predates the field (a real
// scenario given the PWA stale-service-worker gotcha). Such a write must not
// silently wipe saved data; a dropped deletedBankIds would even resurrect
// deleted bank rows via reconcileBankTransactions. An explicit empty value is
// respected (that's an intentional clear); only a missing field falls back to
// the stored value.
function preserveUserFields(incoming) {
  const blob = readBlob();
  if (!blob) return incoming;
  const stored = blob.content;
  const out = { ...incoming };
  for (const field of ['accountLabels', 'categoryRules', 'labelRules', 'transferRules', 'categoryBudgets', 'deletedBankIds']) {
    const hasStored = stored[field] && (Array.isArray(stored[field]) ? stored[field].length : Object.keys(stored[field]).length);
    if (incoming[field] === undefined && hasStored) {
      console.log(`[data] preserving stored ${field} (incoming payload omitted it)`);
      out[field] = stored[field];
    }
  }
  return out;
}

app.post('/api/data', (req, res) => {
  if (!isValidFinancePayload(req.body)) {
    return res.status(400).json({ error: 'invalid finance payload' });
  }
  // The pagehide beacon flush can't set headers, so it carries the rev it last
  // saw as `_rev` in the body. Pull it out (and strip it, so it never persists
  // into the stored blob) before the concurrency check below.
  const bodyRev = req.body._rev;
  delete req.body._rev;
  const stored = getStmt.get('headroom');
  // Parse the stored blob defensively. A corrupt row would otherwise lock the
  // user out permanently: GET already serves null (readBlob guards its parse),
  // so the client reports rev 0, which mismatches the corrupt row's real rev
  // and, on the old code, threw inside this 409 branch's JSON.parse — 500ing
  // every save. No read, no write, no recovery. Instead, when the stored blob
  // is unreadable there is no valid prior state to protect: quarantine the
  // corrupt bytes (a truncated blob may be hand-recoverable) and fall through
  // to last-write-wins so this valid payload restores write access.
  let storedContent = null;
  let storedCorrupt = false;
  if (stored) {
    try {
      storedContent = JSON.parse(stored.content);
    } catch {
      storedCorrupt = true;
      console.warn('[data] stored blob is corrupt JSON — quarantining and accepting incoming payload (last-write-wins recovery)');
      writeStmt.run({ id: 'headroom:corrupt', content: stored.content, rev: stored.rev });
    }
  }
  // Optimistic concurrency: if the client sent the rev it last saw (X-Data-Rev
  // header, or `_rev` in the body for the beacon flush) and it no longer
  // matches, a newer write landed in between — reject so we don't clobber it.
  // A request carrying neither (a genuinely old client build), or a corrupt
  // stored blob, keeps the last-write-wins path.
  const clientRev = req.get('X-Data-Rev') ?? (typeof bodyRev === 'number' ? String(bodyRev) : null);
  if (stored && !storedCorrupt && clientRev != null && Number(clientRev) !== stored.rev) {
    return res.status(409).json({
      error: 'stale revision — data changed elsewhere',
      currentRev: stored.rev,
      current: storedContent,
    });
  }
  const merged = preserveUserFields(reconcileBankTransactions(req.body));
  // Converge the stored blob: reconcile re-adds any stored eb- row missing from
  // the payload, including legacy bare-id rows the client dropped as twins of a
  // prefixed row (the client dedupes on load but doesn't record those drops in
  // deletedBankIds). Drop them again here, or the blob keeps the dupes and the
  // client/server ping-pong on every save.
  if (Array.isArray(merged.dailyTransactions)) {
    merged.dailyTransactions = bank.dropStaleBareTwins(merged.dailyTransactions);
  }
  const content = JSON.stringify(merged);
  if (content.length > SIZE_WARN_BYTES) {
    console.warn(`[data] payload is ${(content.length / 1024 / 1024).toFixed(1)} MB — approaching the body limit`);
  }
  const rev = writeBlob('headroom', content, stored ? stored.rev : 0);
  res.set('X-Data-Rev', String(rev));
  res.json({ ok: true, rev });
});

// In-app restore from a SQLite backup file (what `make backup` copies out), so
// recovery doesn't need a terminal. This only EXTRACTS the JSON blob from the
// uploaded DB and returns it — it never writes the live data. The client feeds
// the returned blob into the normal import preview → confirm flow (which takes a
// safety backup and applies via the usual save path), so there's no second write
// path to keep in sync and no concurrency edge cases here. `express.raw` reads
// the binary body regardless of content type (the global json parser only acts
// on application/json, so it passes a binary upload straight through).
app.post('/api/restore', express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
  const buf = req.body;
  // express.raw yields a Buffer. Reject anything else — a parsed string/array
  // (body-parser type tampering) or a missing body — before any length/byte
  // inspection, so there's no array-vs-string type confusion downstream.
  if (typeof buf !== 'object' || Array.isArray(buf) || !Buffer.isBuffer(buf)) {
    return res.status(400).json({ error: 'not a SQLite backup file' });
  }
  // SQLite files begin with the literal "SQLite format 3\0".
  if (buf.length < 16 || buf.toString('utf8', 0, 15) !== 'SQLite format 3') {
    return res.status(400).json({ error: 'not a SQLite backup file' });
  }
  // Open the uploaded database in memory, read-only — the attacker-controlled
  // bytes never touch disk (no temp file to write or clean up).
  let src;
  try {
    src = new Database(buf, { readonly: true });
    const row = src.prepare("SELECT content FROM finance_data WHERE id = 'headroom'").get();
    if (!row || typeof row.content !== 'string') {
      return res.status(400).json({ error: 'backup contains no finance data' });
    }
    const data = JSON.parse(row.content);
    if (!isValidFinancePayload(data)) {
      return res.status(400).json({ error: 'backup data is not a valid finance blob' });
    }
    res.json({ data });
  } catch (err) {
    console.warn(`[restore] could not read backup: ${err.message}`);
    res.status(400).json({ error: 'could not read the backup database' });
  } finally {
    try { if (src) src.close(); } catch { /* ignore */ }
  }
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
  // A user-initiated refresh bypasses the per-hour attempt cooldown (but not the
  // needsRefresh check — nothing to fetch when the cache is already current).
  const force = req.query.force === '1';

  let stale = false;
  if (needsRefresh && (force || Date.now() - lastSsbAttemptAt > SSB_ATTEMPT_COOLDOWN_MS)) {
    lastSsbAttemptAt = Date.now();
    try {
      const points = await fetchCpi(paddedFrom, to);
      const now = new Date().toISOString();
      const tx = db.transaction((pts) => {
        for (const p of pts) inflationUpsert.run(p.month, p.cpiIndex, now);
      });
      tx(points);
    } catch (err) {
      console.warn(`[inflation] SSB fetch failed, serving cache (next attempt in ${Math.round(SSB_ATTEMPT_COOLDOWN_MS / 60000)} min):`, err.message);
      stale = true;
    }
  } else if (needsRefresh) {
    // Refresh is due but we attempted recently — serve what we have without
    // touching SSB, flagged stale so the client can show its indicator.
    stale = true;
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

// Wrap a bank route so a thrown error becomes `status` + { error: message }
// instead of a repeated try/catch. Server faults (5xx) are logged; client
// faults (4xx) aren't. Routes with bespoke error handling — the callback
// redirect and sync's needsRelink 409 — keep their own try/catch.
function bankRoute(status, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (status >= 500) console.error(`[bank] ${req.path} failed:`, err.message);
      res.status(status).json({ error: err.message });
    }
  };
}

app.get('/api/bank/status', (_req, res) => {
  res.json(bank.getStatus());
});

// The connectable banks for the picker (proxied so the client never needs the key).
app.get('/api/bank/aspsps', bankRoute(500, async (_req, res) => {
  res.json({ aspsps: await bank.getAspsps() });
}));

// Disconnect one bank. Its already-imported rows stay in the ledger.
app.delete('/api/bank/connection/:id', bankRoute(400, (req, res) => {
  res.json({ ok: true, ...bank.removeConnection(String(req.params.id)), ...bank.getStatus() });
}));

// Upload the app's private key (write-only — never read back). Validates the
// PEM and verifies it against Enable Banking before storing it (chmod 600,
// encrypted at rest when EB_KEY_SECRET is set).
app.post('/api/bank/key', bankRoute(400, async (req, res) => {
  const pem = req.body && req.body.pem;
  if (typeof pem !== 'string' || !pem.includes('PRIVATE KEY')) {
    return res.status(400).json({ error: 'expected a PEM private key' });
  }
  const { verified, encrypted } = await bank.saveKey(pem);
  res.json({ ok: true, verified, encrypted, ...bank.getStatus() });
}));

// Set non-secret bank settings stored server-side: the redirect (callback)
// URL and/or the Enable Banking application ID. Each is applied only when
// present in the body, so the client can save them independently.
app.post('/api/bank/config', bankRoute(400, (req, res) => {
  const body = req.body || {};
  if (body.redirectUrl !== undefined) bank.setRedirect(String(body.redirectUrl || ''));
  if (body.appId !== undefined) bank.setAppId(String(body.appId || ''));
  res.json({ ok: true, ...bank.getStatus() });
}));

// Start BankID for the chosen bank: returns the redirect url the client sends the browser to.
app.post('/api/bank/link', bankRoute(500, async (req, res) => {
  const aspsp = req.body && req.body.aspsp;
  const connectionId = req.body && req.body.connectionId;
  res.json(await bank.startLink(
    typeof aspsp === 'string' ? aspsp : undefined,
    typeof connectionId === 'string' ? connectionId : undefined,
  ));
}));

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
    const stored = readBlob();
    if (!stored) return res.status(409).json({ error: 'no finance data yet — open the app first' });
    const blob = stored.content;
    const existing = Array.isArray(blob.dailyTransactions) ? blob.dailyTransactions : [];
    const before = existing.length;
    const existingIds = new Set(existing.map((tx) => tx.id));
    const deletedIds = Array.isArray(blob.deletedBankIds) ? blob.deletedBankIds : [];
    blob.dailyTransactions = bank.mergeTransactions(existing, mapped, deletedIds);
    // Bump rev so *other* open tabs see the change and refetch the freshly-synced
    // rows. We return the new rev so the tab that triggered the sync can adopt it
    // and not treat its own sync as a conflicting external change.
    const newRev = writeBlob('headroom', JSON.stringify(blob), stored.rev);
    const added = blob.dailyTransactions.length - before;
    const total = blob.dailyTransactions.length;
    // The rows genuinely new this sync (id not in the prior ledger), so the
    // Settings sync-history can list *what* was pulled in, not just how many.
    const items = blob.dailyTransactions.filter((tx) => !existingIds.has(tx.id));
    bank.recordSync({ ok: true, added, fetched: mapped.length, total, items });
    res.set('X-Data-Rev', String(newRev));
    res.json({
      ok: true,
      fetched: mapped.length,
      added,
      total,
      dailyTransactions: blob.dailyTransactions,
      rev: newRev,
    });
  } catch (err) {
    // Log the failed attempt too, so a silent cron failure is visible in-app.
    try { bank.recordSync({ ok: false, error: err.message }); } catch { /* store write best-effort */ }
    if (err.needsRelink) return res.status(409).json({ error: err.message, needsRelink: true });
    console.error('[bank] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // A missing hashed chunk (e.g. a stale reference after redeploy) must 404, not
  // fall through to the SPA handler — returning index.html (text/html) for a
  // /static/*.js request triggers a MIME error and a blank screen instead of a
  // catchable "chunk failed to load". Build output now lives under /static; the
  // legacy /assets/ branch stays so a client still holding the pre-migration
  // index.html gets a clean 404 for its old chunks. Both require a filename with
  // an extension, so the /assets client route (the Formue page) is unaffected.
  app.get(/^\/(?:static|assets)\/.+\.[^/]+$/, (_req, res) => res.sendStatus(404));
  // SPA fallback. Regex route (not the bare '*' string) for Express 5 /
  // path-to-regexp v8 compatibility; matches any unhandled GET.
  app.get(/.*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Rotating on-disk backups (see backup.js). BACKUP_INTERVAL_HOURS=0 disables it.
const backupSchedule = startBackupSchedule(db, DATA_DIR, {
  intervalHours: parseCount(process.env.BACKUP_INTERVAL_HOURS, 24),
  keep: parseCount(process.env.BACKUP_KEEP, 7),
});
if (backupSchedule) console.log(`[backup] rotating snapshots enabled → ${backupSchedule.dir}`);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
