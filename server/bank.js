// Enable Banking (PSD2 AIS) engine — the single home for bank-sync logic, kept
// self-contained CommonJS so it ships in the Node-22 production image (see
// Dockerfile). Drives the in-app link/callback/sync/status flow from
// server/index.js. Pure mapping helpers are unit-tested (bank.test.ts).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.enablebanking.com';
const APP_ID = process.env.EB_APP_ID || '11984ea1-6a0e-4555-bd07-d7d33184e667';
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
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: APP_ID }));
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

// Load the PEM, transparently decrypting an encrypted envelope.
function loadPem() {
  const raw = fs.readFileSync(KEY_PATH, 'utf8');
  if (raw.trimStart().startsWith('-----BEGIN')) return raw; // plaintext (legacy / manual)
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

async function resolveAspsp(match = /norwegian/i) {
  const { aspsps = [] } = await api('GET', `/aspsps?country=${COUNTRY}`);
  const found = aspsps.find((a) => match.test(a.name));
  if (!found) throw new Error(`No ASPSP matching ${match} in ${COUNTRY}`);
  return found.name;
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

function writeSession(session) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
}

// --- redirect URL: env wins, else a UI setting in eb-config.json ------------

function getRedirect() {
  return ENV_REDIRECT || (readJson(CONFIG_PATH) || {}).redirectUrl || '';
}

function setRedirect(url) {
  if (!/^https:\/\/.+/.test(url)) throw new Error('redirect URL must be https://');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.redirectUrl = url;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
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
  const merchant = pickMerchant(tx);
  const mcc = tx.merchant_category_code != null ? String(tx.merchant_category_code) : undefined;
  return {
    id: stableId(tx, prefix),
    date: pickDate(tx),
    description: pickDescription(tx),
    amount: Math.abs(parsed),
    kind: tx.credit_debit_indicator === 'CRDT' ? 'income' : 'expense',
    // Richer bank-feed fields the client categorizer consumes. Categorization
    // itself is client-side; the server never assigns a category.
    ...(merchant ? { merchant } : {}),
    ...(mcc ? { mcc } : {}),
  };
}

function mapEBTransactions(txs, opts = {}) {
  const out = [];
  for (const tx of txs) {
    if (!opts.includePending && tx.status !== 'BOOK') continue;
    try {
      out.push(mapEBTransaction(tx, opts));
    } catch {
      /* skip malformed row rather than let NaN leak into the ledger */
    }
  }
  return out;
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
  return [...byId.values()];
}

// --- high-level flow used by the routes -------------------------------------

function markRelink(reason) {
  const session = readJson(SESSION_PATH);
  if (session) writeSession({ ...session, needs_relink: true, relink_reason: reason });
}

/** Start the BankID flow; returns the redirect url for the browser. */
async function startLink() {
  const redirectUrl = getRedirect();
  if (!redirectUrl) throw new Error('redirect URL not set (add it in Settings and register it on the EB app)');
  const aspspName = await resolveAspsp();
  const state = crypto.randomUUID();
  const validUntil = new Date(Date.now() + DAYS * 864e5).toISOString();
  const auth = await api('POST', '/auth', {
    aspsp: { name: aspspName, country: COUNTRY },
    access: { valid_until: validUntil },
    state,
    redirect_url: redirectUrl,
    psu_type: 'personal',
  });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PENDING_PATH, JSON.stringify({ state, validUntil, aspspName }));
  return { url: auth.url };
}

/** Complete the BankID flow from the callback's code+state; saves the session. */
async function finishLink(code, state) {
  const pending = readJson(PENDING_PATH);
  if (!pending || !pending.state) throw new Error('no pending link');
  if (state && state !== pending.state) throw new Error('state mismatch');
  const session = await api('POST', '/sessions', { code });
  const accounts = session.accounts || [];
  writeSession({
    session_id: session.session_id,
    valid_until: (session.access && session.access.valid_until) || pending.validUntil,
    aspsp: pending.aspspName,
    accounts: accounts.map((a) => ({ uid: a.uid, name: a.name, currency: a.currency })),
    linked_at: new Date().toISOString(),
  });
  try {
    fs.unlinkSync(PENDING_PATH);
  } catch {
    /* already gone */
  }
  return { accounts: accounts.length };
}

/** Status for the Settings card. Never throws. */
function getStatus() {
  const redirectUrl = getRedirect();
  const hasRedirect = Boolean(redirectUrl);
  const keyPresent = hasKey();
  const base = {
    hasRedirect,
    redirectUrl,
    redirectFromEnv: Boolean(ENV_REDIRECT),
    hasKey: keyPresent,
    keyEncrypted: keyIsEncrypted(),
    keySecretSource: keySecretSource(),
    configured: hasRedirect && keyPresent,
  };
  const session = readJson(SESSION_PATH);
  if (!session || !session.session_id) return { linked: false, ...base };
  const expiry = new Date(session.valid_until).getTime();
  const daysLeft = Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - Date.now()) / 864e5)) : 0;
  return {
    linked: true,
    ...base,
    aspsp: session.aspsp || null,
    accounts: (session.accounts || []).map((a) => ({ name: a.name, currency: a.currency })),
    lastSync: session.last_sync || null,
    validUntil: session.valid_until || null,
    daysLeft,
    needsRelink: Boolean(session.needs_relink) || !sessionValid(session),
  };
}

/**
 * Fetch new transactions and return them mapped. Throws { needsRelink: true }
 * (Error with .needsRelink) when consent has lapsed.
 */
async function fetchMappedTransactions() {
  const session = readJson(SESSION_PATH);
  if (!session) {
    const e = new Error('not linked');
    e.needsRelink = true;
    throw e;
  }
  if (!sessionValid(session)) {
    markRelink('consent expired');
    const e = new Error('consent expired');
    e.needsRelink = true;
    throw e;
  }
  const accounts = session.accounts || [];
  const lastSync = session.last_sync ? new Date(session.last_sync).getTime() : null;
  const fromMs = lastSync ? lastSync - 7 * 864e5 : Date.now() - DAYS * 864e5;
  const from = new Date(fromMs).toISOString().slice(0, 10);
  let raw = [];
  try {
    for (const acc of accounts) {
      raw = raw.concat(await fetchTransactions(acc.uid, from));
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      markRelink(`fetch ${err.status}`);
      const e = new Error('consent expired');
      e.needsRelink = true;
      throw e;
    }
    throw err;
  }
  return mapEBTransactions(raw);
}

/** Record a successful sync time (clears the relink flag). */
function recordSync() {
  const session = readJson(SESSION_PATH);
  if (session) writeSession({ ...session, last_sync: new Date().toISOString(), needs_relink: false });
}

module.exports = {
  EB_ID_PREFIX,
  // pure helpers (tested)
  mapEBTransaction,
  mapEBTransactions,
  mergeTransactions,
  // flow
  startLink,
  finishLink,
  getStatus,
  fetchMappedTransactions,
  recordSync,
  // key management
  hasKey,
  saveKey,
  // redirect config
  getRedirect,
  setRedirect,
};
