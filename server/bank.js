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
// Where the bank redirects the browser after BankID. Must be HTTPS and
// registered on the Enable Banking app, e.g. https://<host>/api/bank/callback.
const REDIRECT_URL = process.env.EB_REDIRECT || '';

const EB_ID_PREFIX = 'eb-';

// --- low-level API client ---------------------------------------------------

function makeJwt() {
  if (!fs.existsSync(KEY_PATH)) throw new Error(`Private key not found at ${KEY_PATH} (set EB_KEY_PATH)`);
  const privateKey = fs.readFileSync(KEY_PATH, 'utf8');
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: APP_ID }));
  const payload = b64(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64(sig)}`;
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

function sessionValid(session, now = Date.now()) {
  if (!session || !session.session_id || !session.valid_until) return false;
  const expiry = new Date(session.valid_until).getTime();
  if (!Number.isFinite(expiry)) return false;
  return expiry - now > 60 * 60 * 1000; // 1h margin
}

// --- pure mapping (unit-tested) ---------------------------------------------

function pickDescription(tx) {
  const party = tx.credit_debit_indicator === 'DBIT' ? tx.creditor && tx.creditor.name : tx.debtor && tx.debtor.name;
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
  return {
    id: stableId(tx, prefix),
    date: pickDate(tx),
    description: pickDescription(tx),
    amount: Math.abs(parsed),
    kind: tx.credit_debit_indicator === 'CRDT' ? 'income' : 'expense',
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

function mergeTransactions(existing, incoming) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return [...byId.values()];
}

// --- high-level flow used by the routes -------------------------------------

function markRelink(reason) {
  const session = readJson(SESSION_PATH);
  if (session) writeSession({ ...session, needs_relink: true, relink_reason: reason });
}

/** Start the BankID flow; returns the redirect url for the browser. */
async function startLink() {
  if (!REDIRECT_URL) throw new Error('EB_REDIRECT is not set (register an HTTPS callback and set it)');
  const aspspName = await resolveAspsp();
  const state = crypto.randomUUID();
  const validUntil = new Date(Date.now() + DAYS * 864e5).toISOString();
  const auth = await api('POST', '/auth', {
    aspsp: { name: aspspName, country: COUNTRY },
    access: { valid_until: validUntil },
    state,
    redirect_url: REDIRECT_URL,
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
  const session = readJson(SESSION_PATH);
  if (!session || !session.session_id) return { linked: false, configured: Boolean(REDIRECT_URL) };
  const expiry = new Date(session.valid_until).getTime();
  const daysLeft = Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - Date.now()) / 864e5)) : 0;
  return {
    linked: true,
    configured: Boolean(REDIRECT_URL),
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
};
