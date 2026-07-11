// Enable Banking (PSD2 AIS) engine — the single home for bank-sync logic, kept
// self-contained CommonJS so it ships in the Node-22 production image (see
// Dockerfile). Drives the in-app link/callback/sync/status flow from
// server/index.js. Pure mapping helpers are unit-tested (bank.test.ts).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.enablebanking.com';
// Required config: every install registers its own Enable Banking application
// (no shared code default — this repo is self-hosted by several people).
// Env wins; otherwise it's a UI setting stored in eb-config.json (see getAppId).
const ENV_APP_ID = process.env.EB_APP_ID || '';
const COUNTRY = process.env.EB_COUNTRY || 'NO';
const DAYS = Number(process.env.EB_DAYS || 90);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const KEY_PATH = process.env.EB_KEY_PATH || path.join(DATA_DIR, 'eb-key.pem');
const SESSION_PATH = path.join(DATA_DIR, 'eb-session.json');
const PENDING_PATH = path.join(DATA_DIR, 'eb-pending.json');
const CONFIG_PATH = path.join(DATA_DIR, 'eb-config.json');
const MASTER_KEY_PATH = path.join(DATA_DIR, 'eb-master.key');

// Encryption secret for the stored key. If EB_KEY_SECRET is set (env / mounted
// secret), it's used — that lives OUTSIDE the data, so a leaked volume is safe.
// Otherwise the app generates and manages its own key so the PEM is always
// encrypted at rest (weaker: the managed key sits in the same volume, so it
// guards against the key file leaking in isolation, not a full-volume breach).
const ENV_KEY_SECRET = process.env.EB_KEY_SECRET || '';
// The bank redirects the browser here after BankID. Env wins; otherwise it's a
// UI setting stored in eb-config.json. Must be HTTPS and registered on the app.
const ENV_REDIRECT = process.env.EB_REDIRECT || '';

const EB_ID_PREFIX = 'eb-';

// --- low-level API client ---------------------------------------------------

function signJwtWith(privateKey) {
  const appId = getAppId();
  if (!appId) throw new Error('Enable Banking application ID is not set — enter it in Settings (or set EB_APP_ID)');
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const payload = b64(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64(sig)}`;
}

// --- at-rest key encryption (AES-256-GCM, scrypt-derived) -------------------

function encryptPem(pem, secret) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1, alg: 'aes-256-gcm',
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64'),
  });
}

function decryptPem(envelope, secret) {
  const e = JSON.parse(envelope);
  const key = crypto.scryptSync(secret, Buffer.from(e.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString('utf8');
}

function keyIsEncrypted() {
  if (!fs.existsSync(KEY_PATH)) return false;
  return !fs.readFileSync(KEY_PATH, 'utf8').trimStart().startsWith('-----BEGIN');
}

function keySecretSource() {
  return ENV_KEY_SECRET ? 'env' : 'managed';
}

// The secret used to encrypt the stored key. Env secret wins; otherwise an
// app-managed random key is created once (chmod 600) so encryption is always on.
function getKeySecret() {
  if (ENV_KEY_SECRET) return ENV_KEY_SECRET;
  if (!fs.existsSync(MASTER_KEY_PATH)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MASTER_KEY_PATH, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    fs.chmodSync(MASTER_KEY_PATH, 0o600);
  }
  return fs.readFileSync(MASTER_KEY_PATH, 'utf8');
}

// Load the PEM, transparently decrypting an encrypted envelope. A plaintext
// key (stored before at-rest encryption, or placed by hand) is re-encrypted in
// place on first read, so the plaintext branch is import-time tolerance rather
// than a persistent state. Best-effort: a read-only key file still works, it
// just stays plaintext.
function loadPem() {
  const raw = fs.readFileSync(KEY_PATH, 'utf8');
  if (raw.trimStart().startsWith('-----BEGIN')) {
    try {
      fs.writeFileSync(KEY_PATH, encryptPem(raw, getKeySecret()), { mode: 0o600 });
      fs.chmodSync(KEY_PATH, 0o600);
      console.log('[bank] re-encrypted plaintext key at rest');
    } catch (err) {
      console.warn(`[bank] could not re-encrypt plaintext key (${err.message}); continuing with it as-is`);
    }
    return raw;
  }
  return decryptPem(raw, getKeySecret());
}

function makeJwt() {
  if (!fs.existsSync(KEY_PATH)) throw new Error(`Private key not found at ${KEY_PATH} (set EB_KEY_PATH)`);
  return signJwtWith(loadPem());
}

function hasKey() {
  return fs.existsSync(KEY_PATH);
}

/**
 * Validate + store an uploaded PEM private key (chmod 600). Verifies the key is
 * accepted by Enable Banking before committing so a wrong key is rejected up
 * front. Throws on bad format or an EB rejection. Never reads the key back out.
 */
async function saveKey(pem) {
  // 1. Format check — throws on anything that isn't a private key.
  crypto.createPrivateKey(pem);
  // 2. Verify against Enable Banking (best-effort: a network failure still
  //    stores, but an explicit auth rejection does not).
  let verified = false;
  try {
    const res = await fetch(`${API_BASE}/aspsps?country=${COUNTRY}`, {
      headers: { Authorization: `Bearer ${signJwtWith(pem)}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('key rejected by Enable Banking (wrong key or application id)');
    }
    verified = res.ok;
  } catch (err) {
    if (/rejected by Enable Banking/.test(err.message)) throw err;
    /* network error — store unverified */
  }
  // 3. Store owner-only, always encrypted at rest.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, encryptPem(pem, getKeySecret()), { mode: 0o600 });
  fs.chmodSync(KEY_PATH, 0o600); // enforce regardless of umask
  return { verified, encrypted: true, keySecretSource: keySecretSource() };
}

async function api(method, apiPath, body) {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${makeJwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${apiPath} -> ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listAspsps() {
  const { aspsps = [] } = await api('GET', `/aspsps?country=${COUNTRY}`);
  return aspsps;
}

// Resolve a bank by exact name (from the picker). A name is required — there is
// no default bank; re-linking a legacy connection with an unknown aspsp goes
// through the picker (the client passes its connectionId, see startLink).
async function resolveAspsp(name) {
  if (!name) throw new Error('bank name required');
  const aspsps = await listAspsps();
  const found = aspsps.find((a) => a.name === name);
  if (!found) throw new Error(`ASPSP not found: ${name}`);
  return found.name;
}

// The connectable banks, trimmed to what the picker needs.
async function getAspsps() {
  const aspsps = await listAspsps();
  return aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo || null }));
}

async function fetchTransactions(accountUid, dateFrom) {
  const all = [];
  let cont = null;
  do {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (cont) q.set('continuation_key', cont);
    const page = await api('GET', `/accounts/${accountUid}/transactions?${q}`);
    all.push(...(page.transactions || []));
    cont = page.continuation_key || null;
  } while (cont);
  return all;
}

// --- session / pending-state persistence ------------------------------------

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic write (tmp + rename): a crash mid-write must never leave a truncated
// store — losing eb-session.json loses every bank connection.
function writeJsonAtomic(p, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

function writeStore(store) {
  writeJsonAtomic(SESSION_PATH, store);
}

// Read the session store, migrating the legacy single-session shape
// ({ session_id, accounts, ... }) into the multi-connection shape
// ({ connections: [...] }). The migrated connection keeps the bare `eb-` id
// prefix so already-imported rows still match on the next sync (no duplicates).
// The migration is written back to disk immediately, so it runs once instead of
// on every read; a migrated connection may still have `aspsp: null` (the legacy
// store didn't record the bank) until the user re-links it via the picker.
function readStore() {
  const raw = readJson(SESSION_PATH);
  if (!raw) return { connections: [] };
  if (Array.isArray(raw.connections)) return raw;
  if (raw.session_id) {
    const migrated = {
      connections: [
        {
          id: raw.id || 'legacy',
          aspsp: raw.aspsp || null,
          idPrefix: EB_ID_PREFIX,
          session_id: raw.session_id,
          valid_until: raw.valid_until,
          linked_at: raw.linked_at,
          last_sync: raw.last_sync || null,
          needs_relink: Boolean(raw.needs_relink),
          relink_reason: raw.relink_reason,
          accounts: raw.accounts || [],
        },
      ],
    };
    writeStore(migrated);
    console.log('[bank] migrated legacy single-session store to connections[]');
    return migrated;
  }
  return { connections: [] };
}

// Stable per-account key stamped onto every imported transaction, so the client
// can badge and (later) filter by account even across banks with colliding
// account names.
function accountKey(connection, acc) {
  return `${connection.id.slice(0, 8)}:${acc.uid}`;
}

// --- redirect URL + app id: env wins, else a UI setting in eb-config.json ---

function getRedirect() {
  return ENV_REDIRECT || (readJson(CONFIG_PATH) || {}).redirectUrl || '';
}

function setRedirect(url) {
  if (!/^https:\/\/.+/.test(url)) throw new Error('redirect URL must be https://');
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.redirectUrl = url;
  writeJsonAtomic(CONFIG_PATH, cfg);
}

// The Enable Banking application ID (a public identifier, not a secret — it
// rides in the JWT header as `kid`).
function getAppId() {
  return ENV_APP_ID || (readJson(CONFIG_PATH) || {}).appId || '';
}

function setAppId(id) {
  const v = String(id).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error('application ID must be a UUID (from the Enable Banking control panel)');
  }
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.appId = v;
  writeJsonAtomic(CONFIG_PATH, cfg);
}

function sessionValid(session, now = Date.now()) {
  if (!session || !session.session_id || !session.valid_until) return false;
  const expiry = new Date(session.valid_until).getTime();
  if (!Number.isFinite(expiry)) return false;
  return expiry - now > 60 * 60 * 1000; // 1h margin
}

// --- pure mapping (unit-tested) ---------------------------------------------

// The counterparty (merchant) name, when the feed carries one. Kept separate
// from the description fallback chain so the client categorizer has a clean
// merchant signal to match on.
function pickMerchant(tx) {
  const party = tx.credit_debit_indicator === 'DBIT' ? tx.creditor && tx.creditor.name : tx.debtor && tx.debtor.name;
  return party || undefined;
}

function pickDescription(tx) {
  const party = pickMerchant(tx);
  if (party) return party;
  const remittance = (tx.remittance_information || []).filter(Boolean).join(' ').trim();
  if (remittance) return remittance;
  if (tx.bank_transaction_code && tx.bank_transaction_code.description) return tx.bank_transaction_code.description;
  return 'Unknown';
}

function pickDate(tx) {
  return tx.booking_date || tx.value_date || tx.transaction_date || '';
}

function stableId(tx, prefix) {
  if (tx.entry_reference) return `${prefix}${tx.entry_reference}`;
  const key = [pickDate(tx), tx.credit_debit_indicator, (tx.transaction_amount && tx.transaction_amount.amount) || '', pickDescription(tx).slice(0, 24)].join('|');
  return `${prefix}${key}`;
}

function mapEBTransaction(tx, opts = {}) {
  const prefix = opts.idPrefix || EB_ID_PREFIX;
  const raw = tx.transaction_amount && tx.transaction_amount.amount;
  const parsed = Number(raw);
  // Number('') is 0, not NaN — reject blanks so an empty amount can't slip
  // through as a 0 kr transaction.
  if (raw == null || String(raw).trim() === '' || !Number.isFinite(parsed)) {
    throw new Error(`unparseable amount: ${raw}`);
  }
  // A row with no date at all would store as date:'' — invisible to every
  // 'YYYY-MM' month filter and so undeletable in the UI. Reject it like a bad
  // amount; mapEBTransactions skips it rather than let it poison the ledger.
  const date = pickDate(tx);
  if (!date) throw new Error('transaction has no usable date');
  const merchant = pickMerchant(tx);
  const mcc = tx.merchant_category_code != null ? String(tx.merchant_category_code) : undefined;
  // Direction: honour the explicit indicator; if a feed omits it, fall back to
  // the amount sign (statement convention: inflow positive, outflow negative),
  // so a refund with no indicator counts as income, not a positive expense.
  const indicator = tx.credit_debit_indicator;
  const kind = indicator === 'CRDT' ? 'income'
    : indicator === 'DBIT' ? 'expense'
      : (parsed < 0 ? 'expense' : 'income');
  return {
    id: stableId(tx, prefix),
    date,
    description: pickDescription(tx),
    amount: Math.abs(parsed),
    kind,
    // Richer bank-feed fields the client categorizer consumes. Categorization
    // itself is client-side; the server never assigns a category.
    ...(merchant ? { merchant } : {}),
    ...(mcc ? { mcc } : {}),
    // Which account/bank this row came from, for the per-account badge. Display
    // only — never touches the money math.
    ...(opts.account ? { account: opts.account } : {}),
    ...(opts.bank ? { bank: opts.bank } : {}),
    ...(opts.accountName ? { accountName: opts.accountName } : {}),
  };
}

function mapEBTransactions(txs, opts = {}) {
  const out = [];
  // Rows without an entry_reference fall back to a date|amount|description id
  // (stableId), so two genuinely distinct same-day purchases of the same amount
  // at the same merchant would collide and merge into one row. Suffix repeat
  // occurrences within the batch; the first keeps the unsuffixed id so it still
  // matches what earlier syncs stored.
  const fallbackSeen = new Map();
  for (const tx of txs) {
    if (!opts.includePending && tx.status !== 'BOOK') continue;
    try {
      const row = mapEBTransaction(tx, opts);
      if (!tx.entry_reference) {
        const n = (fallbackSeen.get(row.id) || 0) + 1;
        fallbackSeen.set(row.id, n);
        if (n > 1) row.id = `${row.id}#${n}`;
      }
      out.push(row);
    } catch {
      /* skip malformed row rather than let NaN leak into the ledger */
    }
  }
  return out;
}

// Drop legacy bare-id rows (eb-<ref>) that now have a connection-prefixed twin
// (eb-<conn8>-<ref>) with the same entry_reference — the duplication left behind
// when a connection went from bare to prefixed. Two *different* prefixed
// connections may reuse a ref, so we never merge across prefixes; only a bare row
// with a prefixed twin is removed. A manual category on the dropped row is
// rescued onto its survivor.
//
// TWIN: `dedupeBankTransactions` in src/lib/bankDedup.ts (TS/ESM) is a
// byte-equivalent copy of this logic, including the two regexes below. This CJS
// server can't import from src/, so the two are hand-maintained and MUST stay
// identical — change both or neither.
//
// Known limitation (see BACKLOG.md "Bank-id dedup regex ambiguity"): the
// prefixed-vs-bare split is inherently ambiguous. A legacy BARE id whose ref
// happens to start with 8 hex chars + '-' (e.g. `eb-a1b2c3d4-...`) is
// indistinguishable from a real PREFIXED id and is treated as prefixed. Not
// tightened here because no safe structural discriminator exists — guessing wrong
// could resurrect or double-count real bank transactions.
function dropStaleBareTwins(txs) {
  const PREFIXED = /^eb-[0-9a-f]{8}-(.+)$/i;
  const BARE = /^eb-(?![0-9a-f]{8}-)(.+)$/i;
  const prefixedRefs = new Set();
  for (const t of txs) {
    const m = PREFIXED.exec(t.id);
    if (m) prefixedRefs.add(m[1]);
  }
  const rescue = new Map();
  const out = [];
  for (const t of txs) {
    const b = BARE.exec(t.id);
    if (b && prefixedRefs.has(b[1])) {
      if (t.categorySource === 'manual' && t.category != null) rescue.set(b[1], { category: t.category, categorySource: t.categorySource });
      continue;
    }
    out.push(t);
  }
  if (rescue.size === 0) return out;
  return out.map((t) => {
    const m = PREFIXED.exec(t.id);
    const r = m && rescue.get(m[1]);
    return r && t.categorySource !== 'manual' ? { ...t, ...r } : t;
  });
}

function mergeTransactions(existing, incoming, deletedIds = []) {
  const deleted = new Set(deletedIds);
  // A row the user soft-deleted in the UI must not come back on the next sync.
  const byId = new Map(existing.filter((t) => !deleted.has(t.id)).map((t) => [t.id, t]));
  for (const t of incoming) {
    if (deleted.has(t.id)) continue; // honor client-side soft-deletes
    const prior = byId.get(t.id);
    // Re-synced rows come back category-less from the bank. Carry forward any
    // label the client already assigned (auto or manual) so a re-sync never
    // wipes categorization; the fresh bank fields (amount, etc.) still win.
    if (prior && prior.category != null) {
      byId.set(t.id, { ...t, category: prior.category, categorySource: prior.categorySource });
    } else {
      byId.set(t.id, t);
    }
  }
  return dropStaleBareTwins([...byId.values()]);
}

// --- high-level flow used by the routes -------------------------------------

function markRelink(connId, reason) {
  const store = readStore();
  const c = store.connections.find((x) => x.id === connId);
  if (c) {
    c.needs_relink = true;
    c.relink_reason = reason;
    writeStore(store);
  }
}

/**
 * Start the BankID flow for a bank; returns the redirect url for the browser.
 * Re-linking a bank that's already connected reuses its connection id and id
 * prefix so its stored rows keep matching (no duplicates on the next sync).
 * An explicit connectionId (re-linking a migrated legacy connection whose
 * aspsp is unknown) wins over the aspsp match; finishLink then stamps the
 * chosen bank onto that connection, backfilling the missing aspsp.
 */
async function startLink(bankName, relinkConnectionId) {
  const redirectUrl = getRedirect();
  if (!redirectUrl) throw new Error('redirect URL not set (add it in Settings and register it on the EB app)');
  const aspspName = await resolveAspsp(bankName);
  const store = readStore();
  // Reuse the id/prefix of a live connection to this bank, or of a removed one
  // (tombstoned by removeConnection) — the ledger keeps its rows on disconnect,
  // so a fresh prefix would re-import the 90-day history as duplicates.
  const match = relinkConnectionId ? (c) => c.id === relinkConnectionId : (c) => c.aspsp === aspspName;
  const existing = store.connections.find(match)
    || (store.removed || []).find(match);
  const connectionId = existing ? existing.id : crypto.randomUUID();
  const idPrefix = existing ? existing.idPrefix : `${EB_ID_PREFIX}${connectionId.slice(0, 8)}-`;
  const state = crypto.randomUUID();
  const validUntil = new Date(Date.now() + DAYS * 864e5).toISOString();
  const auth = await api('POST', '/auth', {
    aspsp: { name: aspspName, country: COUNTRY },
    access: { valid_until: validUntil },
    state,
    redirect_url: redirectUrl,
    psu_type: 'personal',
  });
  writeJsonAtomic(PENDING_PATH, { state, validUntil, aspspName, connectionId, idPrefix });
  return { url: auth.url };
}

// An account entry in the session response can be a full object or (for some
// ASPSPs) a bare uid string. Normalize to the shape we store. The IBAN (or BBAN)
// is captured so accounts with an identical holder name can still be told apart.
function normalizeAccount(a) {
  if (typeof a === 'string') return { uid: a };
  const acctId = a.account_id || {};
  const iban = acctId.iban || acctId.bban || (acctId.other && acctId.other.identification) || a.iban || undefined;
  return { uid: a.uid, name: a.name, product: a.product, currency: a.currency, ...(iban ? { iban } : {}) };
}

// Accounts as returned when the session was created, with a GET fallback for
// ASPSPs that don't inline them in the POST /sessions response. Returns a
// `note` explaining why the list is empty, surfaced in the UI for diagnosis.
async function resolveSessionAccounts(session) {
  let accounts = (session.accounts || []).map(normalizeAccount).filter((a) => a.uid);
  let note = null;
  if (accounts.length === 0) {
    if (!session.session_id) {
      note = 'no-session';
    } else {
      try {
        const s = await api('GET', `/sessions/${session.session_id}`);
        accounts = (s.accounts || []).map(normalizeAccount).filter((a) => a.uid);
        // The consent completed but the bank shared no accounts — almost always
        // account access wasn't granted/selected during BankID.
        if (accounts.length === 0) note = 'no-accounts-granted';
      } catch (err) {
        note = `fetch-failed: ${err.message}`;
      }
    }
  }
  return { accounts, note };
}

/** Complete the BankID flow from the callback's code+state; upserts the connection. */
async function finishLink(code, state) {
  const pending = readJson(PENDING_PATH);
  if (!pending || !pending.state) throw new Error('no pending link');
  if (state && state !== pending.state) throw new Error('state mismatch');
  const session = await api('POST', '/sessions', { code });
  const { accounts, note } = await resolveSessionAccounts(session);
  console.log(`[bank] linked ${pending.aspspName}: ${accounts.length} account(s)${note ? ` (${note})` : ''}`);
  const store = readStore();
  const idx = store.connections.findIndex((c) => c.id === pending.connectionId);
  const connection = {
    id: pending.connectionId,
    aspsp: pending.aspspName,
    idPrefix: pending.idPrefix || EB_ID_PREFIX,
    session_id: session.session_id,
    valid_until: (session.access && session.access.valid_until) || pending.validUntil,
    linked_at: new Date().toISOString(),
    // Preserve the prior sync time on a re-link so we don't refetch 90 days.
    last_sync: idx >= 0 ? store.connections[idx].last_sync || null : null,
    needs_relink: false,
    accounts,
    accounts_note: note,
  };
  if (idx >= 0) store.connections[idx] = connection;
  else store.connections.push(connection);
  if (store.removed) store.removed = store.removed.filter((c) => c.id !== connection.id);
  writeStore(store);
  try {
    fs.unlinkSync(PENDING_PATH);
  } catch {
    /* already gone */
  }
  return { accounts: accounts.length };
}

/**
 * Disconnect a bank. Its already-imported rows stay in the ledger, so the
 * connection's id/prefix is tombstoned for startLink to reuse on a re-add —
 * a fresh prefix would re-import those rows under new ids (duplicates).
 */
function removeConnection(id) {
  const store = readStore();
  const before = store.connections.length;
  const gone = store.connections.find((c) => c.id === id);
  store.connections = store.connections.filter((c) => c.id !== id);
  if (gone && gone.aspsp) {
    store.removed = (store.removed || []).filter((c) => c.aspsp !== gone.aspsp);
    store.removed.push({ aspsp: gone.aspsp, id: gone.id, idPrefix: gone.idPrefix });
  }
  writeStore(store);
  return { removed: before - store.connections.length };
}

/** Status for the Settings card. Never throws. */
function getStatus() {
  const redirectUrl = getRedirect();
  const hasRedirect = Boolean(redirectUrl);
  const keyPresent = hasKey();
  const appId = getAppId();
  const base = {
    hasRedirect,
    redirectUrl,
    redirectFromEnv: Boolean(ENV_REDIRECT),
    hasKey: keyPresent,
    keyEncrypted: keyIsEncrypted(),
    keySecretSource: keySecretSource(),
    appId,
    hasAppId: Boolean(appId),
    appIdFromEnv: Boolean(ENV_APP_ID),
    configured: hasRedirect && keyPresent && Boolean(appId),
  };
  const store = readStore();
  const connections = store.connections.map((c) => {
    const expiry = new Date(c.valid_until).getTime();
    const daysLeft = Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - Date.now()) / 864e5)) : 0;
    return {
      id: c.id,
      aspsp: c.aspsp || null,
      accounts: (c.accounts || []).map((a) => ({ key: accountKey(c, a), name: a.name, product: a.product, currency: a.currency, iban: a.iban || null })),
      accountsNote: c.accounts_note || null,
      lastSync: c.last_sync || null,
      validUntil: c.valid_until || null,
      daysLeft,
      needsRelink: Boolean(c.needs_relink) || !sessionValid(c),
    };
  });
  // Rolling sync history, newest first, for the Settings card.
  const syncLog = [...(store.syncLog || [])].reverse();
  return { linked: connections.length > 0, connections, syncLog, ...base };
}

/**
 * Fetch new transactions and return them mapped. Throws { needsRelink: true }
 * (Error with .needsRelink) when consent has lapsed.
 */
async function fetchMappedTransactions() {
  const store = readStore();
  if (!store.connections.length) {
    const e = new Error('not linked');
    e.needsRelink = true;
    throw e;
  }
  let mapped = [];
  let anyValid = false;
  for (const c of store.connections) {
    // A single expired bank flags itself for re-link but doesn't block the
    // others — we still sync every bank whose consent is live.
    if (!sessionValid(c)) {
      markRelink(c.id, 'consent expired');
      continue;
    }
    anyValid = true;
    // Self-heal: a connection linked while the ASPSP exposed no accounts (or an
    // older link that didn't capture them) re-fetches the account list here so a
    // plain "Sync now" fixes it. Logs the count either way for diagnosis.
    // Re-fetch the account list when it's empty (self-heal), or — once — when
    // accounts exist but none carry an IBAN, so already-connected accounts pick
    // up the identifier that tells same-named accounts apart.
    const hasAccounts = Array.isArray(c.accounts) && c.accounts.length > 0;
    const missingIban = hasAccounts && c.accounts.every((a) => !a.iban);
    if (!hasAccounts || (missingIban && !c.accounts_enriched)) {
      try {
        const { accounts: refreshed, note } = await resolveSessionAccounts({ session_id: c.session_id });
        if (refreshed.length) c.accounts = refreshed;
        c.accounts_note = note;
        if (missingIban) c.accounts_enriched = true;
        writeStore(store);
        console.log(`[bank] ${c.aspsp}: ${refreshed.length} account(s) after refresh${note ? ` (${note})` : ''}`);
      } catch (err) {
        if (missingIban) c.accounts_enriched = true;
        c.accounts_note = `fetch-failed: ${err.message}`;
        writeStore(store);
        console.log(`[bank] account refresh failed for ${c.aspsp}: ${err.message}`);
      }
    }
    const lastSync = c.last_sync ? new Date(c.last_sync).getTime() : null;
    const fromMs = lastSync ? lastSync - 7 * 864e5 : Date.now() - DAYS * 864e5;
    const from = new Date(fromMs).toISOString().slice(0, 10);
    try {
      for (const acc of c.accounts || []) {
        const raw = await fetchTransactions(acc.uid, from);
        mapped = mapped.concat(
          mapEBTransactions(raw, {
            idPrefix: c.idPrefix,
            account: accountKey(c, acc),
            bank: c.aspsp || undefined,
            accountName: acc.name || acc.product || '',
          }),
        );
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        markRelink(c.id, `fetch ${err.status}`);
        continue;
      }
      throw err;
    }
  }
  // Only a hard stop when nothing was syncable at all.
  if (!anyValid) {
    const e = new Error('consent expired');
    e.needsRelink = true;
    throw e;
  }
  return mapped;
}

// How many recent sync outcomes to keep in the rolling log (oldest pruned).
const SYNC_LOG_MAX = 20;

/** Shape one sync outcome into a compact, bounded log entry. Pure. */
function makeSyncEntry(outcome, nowIso) {
  const ok = outcome.ok !== false;
  const entry = { at: nowIso, ok };
  if (ok) {
    const num = (v) => (Number.isFinite(v) ? v : 0);
    entry.added = num(outcome.added);
    entry.fetched = num(outcome.fetched);
    entry.total = num(outcome.total);
  } else if (outcome.error) {
    entry.error = String(outcome.error).slice(0, 200);
  }
  return entry;
}

/** Append an entry to a rolling log, keeping at most `max` (newest). Pure. */
function appendSyncLog(log, entry, max = SYNC_LOG_MAX) {
  const next = (Array.isArray(log) ? log : []).concat([entry]);
  return next.slice(Math.max(0, next.length - max));
}

/**
 * Record a sync outcome: on success, stamp `last_sync` on every live connection
 * (clearing its relink flag); always append a rolling log entry (ok or error) so
 * the Settings card can show whether a cron sync ran and what it pulled.
 */
function recordSync(outcome = {}) {
  const store = readStore();
  const now = new Date().toISOString();
  if (outcome.ok !== false) {
    for (const c of store.connections) {
      if (sessionValid(c)) {
        c.last_sync = now;
        c.needs_relink = false;
      }
    }
  }
  store.syncLog = appendSyncLog(store.syncLog, makeSyncEntry(outcome, now));
  writeStore(store);
}

module.exports = {
  EB_ID_PREFIX,
  // pure helpers (tested)
  mapEBTransaction,
  mapEBTransactions,
  mergeTransactions,
  dropStaleBareTwins,
  normalizeAccount,
  // flow
  getAspsps,
  startLink,
  finishLink,
  getStatus,
  fetchMappedTransactions,
  recordSync,
  makeSyncEntry,
  appendSyncLog,
  removeConnection,
  // key management
  hasKey,
  saveKey,
  // redirect config
  getRedirect,
  setRedirect,
  getAppId,
  setAppId,
};
