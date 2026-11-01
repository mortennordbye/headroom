// HTTP adapter to the running Headroom app.
//
// Reads and writes go through the app's own /api/data endpoint (never SQLite
// directly) so every write inherits the server-side guards: isValidFinancePayload,
// optimistic-concurrency `rev`, reconcileBankTransactions and preserveUserFields
// (server/index.js). Reading via the same channel keeps `rev` consistent for the
// read-modify-write mutation flow.

import type { ExportPayload, InflationPoint } from '../src/context/FinanceContext';
import { partitionSavings, mergeStoredSavings } from '../src/lib/savingsMigration';
import { migrateMortgageBalance } from '../src/lib/mortgageSlices';
import { currentMonthKey, addMonthsKey } from '../src/lib/date';
import type { ComparableSale } from '../src/lib/marketValuation';

const BASE_URL = (process.env.HEADROOM_URL || 'http://localhost:8080').replace(/\/$/, '');
const PASSWORD = process.env.HEADROOM_PASSWORD || '';

/** Thrown when the stored rev moved between GET and POST and the retry was exhausted. */
export class RevConflictError extends Error {
  currentRev: number;
  constructor(currentRev: number) {
    super(`data changed on the server (rev is now ${currentRev}); retry the mutation`);
    this.name = 'RevConflictError';
    this.currentRev = currentRev;
  }
}

// In-memory session cookie, populated on demand when the app has auth enabled.
let sessionCookie: string | null = null;

async function login(): Promise<void> {
  if (!PASSWORD) {
    throw new Error(
      'Headroom returned 401 (auth is enabled) but HEADROOM_PASSWORD is not set. ' +
        'Set it in the MCP server env to let the AI read/write your data.',
    );
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}); check HEADROOM_PASSWORD`);
  const setCookie = res.headers.get('set-cookie');
  const match = setCookie?.match(/hr_session=[^;]+/);
  if (!match) throw new Error('login succeeded but no session cookie was returned');
  sessionCookie = match[0];
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return sessionCookie ? { ...extra, cookie: sessionCookie } : extra;
}

export interface DataSnapshot {
  blob: ExportPayload;
  rev: number;
}

/** The whole finance blob plus its current rev, migrated as the app does on load. */
export async function getData(): Promise<DataSnapshot> {
  return fetchData();
}

/** GET the stored blob plus its current rev. Logs in once if auth is on. A
 *  legacy mortgage balance is moved onto assets.houseDebt as the app does on
 *  load (mortgageSlices.ts), so every tool reads the balance the app shows and
 *  a mutation writes the current shape. */
async function fetchData(retryOnAuth = true): Promise<DataSnapshot> {
  const res = await fetch(`${BASE_URL}/api/data`, { headers: authHeaders() });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return fetchData(false);
  }
  if (!res.ok) throw new Error(`GET /api/data failed (${res.status})`);
  const rev = Number(res.headers.get('x-data-rev') ?? 0);
  const blob = (await res.json()) as ExportPayload | null;
  if (!blob) throw new Error('no data yet — open the app and enter some data first');
  return { blob: migrateMortgageBalance(normalizeSavings(blob), currentMonthKey()), rev };
}

/** POST the whole blob back, echoing the rev for optimistic concurrency. */
async function putData(blob: ExportPayload, rev: number, label: string, retryOnAuth = true): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/data`, {
    method: 'POST',
    // Attribute the revision to the MCP server, so history shows which saves
    // were the assistant's and each one can be undone on its own.
    headers: authHeaders({
      'content-type': 'application/json',
      'x-data-rev': String(rev),
      'x-headroom-source': 'mcp',
      // Header values must be latin-1; keep the label plain ASCII.
      'x-headroom-label': label.replace(/[^\x20-\x7e]/g, '?').slice(0, 200),
    }),
    body: JSON.stringify(blob),
  });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return putData(blob, rev, label, false);
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { currentRev?: number };
    throw new RevConflictError(Number(body.currentRev ?? rev));
  }
  if (!res.ok) throw new Error(`POST /api/data failed (${res.status})`);
  const body = (await res.json()) as { rev: number };
  return body.rev;
}

/**
 * The SSB CPI series for the last two years (enough for a 12-month change), as
 * the app loads it. Best-effort: an unreachable or failing endpoint gives [], and
 * callers fall back to the default inflation rate like the app does.
 */
export async function getInflation(): Promise<InflationPoint[]> {
  const to = currentMonthKey();
  const from = addMonthsKey(to, -24);
  try {
    const res = await fetch(`${BASE_URL}/api/inflation?from=${from}&to=${to}`, { headers: authHeaders() });
    if (!res.ok) return [];
    return ((await res.json()) as { points?: InflationPoint[] }).points ?? [];
  } catch {
    return [];
  }
}

export interface HistoryEntry {
  rev: number;
  ts: string;
  bytes: number;
  /** Who wrote it: ui | mcp | import | bank-sync | restore | undo (null on old revisions). */
  source: string | null;
  label: string | null;
  /** Top-level keys the revision changed (null on revisions before change tracking). */
  keys: string[] | null;
  /** Whether undo_change can revert it on its own (the state before it is still kept). */
  undoable: boolean;
}

interface HistoryList {
  revisions: HistoryEntry[];
  retentionDays: number;
  minKept: number;
  maxBytes: number;
}

/** List stored revisions (newest first) with who made them and what they changed. */
export async function listHistory(retryOnAuth = true): Promise<HistoryList> {
  const res = await fetch(`${BASE_URL}/api/history`, { headers: authHeaders() });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return listHistory(false);
  }
  if (!res.ok) throw new Error(`GET /api/history failed (${res.status})`);
  return (await res.json()) as HistoryList;
}

/** Fetch the full finance blob as it was at a past revision. */
export async function getHistoryRevision(
  rev: number,
  retryOnAuth = true,
): Promise<{ rev: number; ts: string; content: ExportPayload }> {
  const res = await fetch(`${BASE_URL}/api/history/${rev}`, { headers: authHeaders() });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return getHistoryRevision(rev, false);
  }
  if (res.status === 404) throw new Error(`no stored revision ${rev}`);
  if (!res.ok) throw new Error(`GET /api/history/${rev} failed (${res.status})`);
  return (await res.json()) as { rev: number; ts: string; content: ExportPayload };
}

/** Roll the current state back to a past revision (recorded as a new revision). */
export async function restoreRevision(
  rev: number,
  retryOnAuth = true,
): Promise<{ rev: number; restoredFrom: number }> {
  const res = await fetch(`${BASE_URL}/api/history/${rev}/restore`, {
    method: 'POST',
    headers: authHeaders({ 'x-headroom-source': 'mcp' }),
  });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return restoreRevision(rev, false);
  }
  if (res.status === 404) throw new Error(`no stored revision ${rev}`);
  if (!res.ok) throw new Error(`restore of revision ${rev} failed (${res.status})`);
  return (await res.json()) as { rev: number; restoredFrom: number };
}

/**
 * Undo just what one revision changed, keeping everything saved after it. The
 * server refuses (conflict) if a touched value was changed again since.
 */
export async function undoRevision(
  rev: number,
  retryOnAuth = true,
): Promise<{ rev: number; undid: number; keys: string[] }> {
  const res = await fetch(`${BASE_URL}/api/history/${rev}/undo`, {
    method: 'POST',
    headers: authHeaders({ 'x-headroom-source': 'mcp' }),
  });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return undoRevision(rev, false);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; conflicts?: string[] };
  if (res.status === 409 && body.conflicts) {
    throw new Error(
      `cannot undo revision ${rev}: changed again since (${body.conflicts.join(', ')}). ` +
        'Undo the later revisions first, or use restore_revision.',
    );
  }
  if (!res.ok) throw new Error(body.error ?? `undo of revision ${rev} failed (${res.status})`);
  return body as unknown as { rev: number; undid: number; keys: string[] };
}

/**
 * Read-modify-write one slice of the blob. `mutate` receives a deep-cloned blob,
 * changes only what it needs, and returns it. On a rev conflict we re-read and
 * apply once more, then give up loudly — never a silent clobber. `label` is read
 * after `mutate`, so it can describe what the mutation changed.
 */
export async function applyMutation(
  mutate: (blob: ExportPayload) => ExportPayload,
  label: () => string = () => 'mcp write',
): Promise<{ rev: number; unchanged?: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // The stored blob, migrated as on load (fetchData), so the write saves the
    // current shape plus what the mutation touches.
    const { blob, rev } = await fetchData();
    const next = mutate(structuredClone(blob));
    // Nothing changed (e.g. the value was already set): skip the save, so a
    // repeated write doesn't add an empty revision to the history.
    if (JSON.stringify(next) === JSON.stringify(blob)) return { rev, unchanged: true };
    try {
      const newRev = await putData(next, rev, label());
      return { rev: newRev };
    } catch (err) {
      if (err instanceof RevConflictError && attempt === 0) continue; // re-read and retry once
      throw err;
    }
  }
  throw new RevConflictError(-1);
}

/**
 * Apply the savings split to a raw blob, the same way the app's payload registry
 * does on load. A blob the app has not re-saved since the split still holds its
 * savings inline in `fixedExpenses`, and every derivation here would then read a
 * transfer as a bill — the exact confusion the split removed. Idempotent, so a
 * blob already in the new shape passes through unchanged.
 */
function normalizeSavings(blob: ExportPayload): ExportPayload {
  return {
    ...blob,
    fixedExpenses: partitionSavings(blob.fixedExpenses ?? []).expenses,
    savings: mergeStoredSavings(blob.savings, blob.fixedExpenses),
  };
}

/**
 * JSON request to one of the app's /api/market/* or other read endpoints. Logs
 * in once on 401. Surfaces the server's own error message (and validation
 * details) so the model can correct an import and retry.
 */
async function requestJson<T>(method: 'GET' | 'POST', path: string, body?: unknown, retryOnAuth = true): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: authHeaders(body === undefined ? {} : { 'content-type': 'application/json', 'x-headroom-source': 'mcp' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return requestJson<T>(method, path, body, false);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
  if (!res.ok) {
    const details = json.details?.length ? `: ${json.details.join('; ')}` : '';
    throw new Error(`${json.error ?? `${method} ${path} failed (${res.status})`}${details}`);
  }
  return json as T;
}

export interface MarketStatus {
  enabled: boolean;
  listings: number;
  sales: number;
  lastListingSeen: string | null;
  lastSalesImport: string | null;
}

/** Whether market data is turned on, plus row counts. */
export function getMarketStatus(): Promise<MarketStatus> {
  return requestJson<MarketStatus>('GET', '/api/market/status');
}

export function importMarketListings(listings: unknown[], seenOn?: string) {
  return requestJson<{ added: number; updated: number; priceChanges: unknown[]; seenOn: string }>(
    'POST', '/api/market/listings', { listings, seenOn },
  );
}

export function importMarketSales(sales: unknown[]) {
  return requestJson<{ added: number; duplicates: number }>('POST', '/api/market/sales', { sales });
}

export async function getMarketSales(postnr: string): Promise<ComparableSale[]> {
  return (await requestJson<{ sales: ComparableSale[] }>('GET', `/api/market/sales?postnr=${encodeURIComponent(postnr)}`)).sales;
}

/** SSB average kr/m² for the postnummer's kommune and dwelling type (null when SSB has none). */
export async function getKvmpris(postnr: string, type?: string): Promise<{
  latestPrice: number | null;
  latestQuarter: string | null;
  poststed?: string;
  points?: { quarter: string; price: number | null }[];
}> {
  const q = new URLSearchParams({ postnr, ...(type ? { type } : {}) });
  return requestJson('GET', `/api/kvmpris?${q}`);
}
