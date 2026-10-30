// HTTP adapter to the running Headroom app.
//
// Reads and writes go through the app's own /api/data endpoint (never SQLite
// directly) so every write inherits the server-side guards: isValidFinancePayload,
// optimistic-concurrency `rev`, reconcileBankTransactions and preserveUserFields
// (server/index.js). Reading via the same channel keeps `rev` consistent for the
// read-modify-write mutation flow.

import type { ExportPayload, InflationPoint } from '../src/context/FinanceContext';
import { partitionSavings, mergeStoredSavings } from '../src/lib/savingsMigration';
import { reconcileMortgageSlices } from '../src/lib/mortgageSlices';
import { currentMonthKey } from '../src/lib/date';

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

/**
 * The whole finance blob plus its current rev, for reading: the mortgage slices
 * are reconciled as the app does on load (mortgageSlices.ts), so every tool sees
 * the balance the app shows. Read-only: the reconciled copy is never written back.
 */
export async function getData(): Promise<DataSnapshot> {
  const { blob, rev } = await fetchData();
  return { blob: reconcileMortgageSlices(blob, currentMonthKey()), rev };
}

/** GET the stored blob plus its current rev. Logs in once if auth is on. */
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
  return { blob: normalizeSavings(blob), rev };
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
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${now.getFullYear() - 2}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
    // The stored blob, not getData's reconciled view: a write changes only what
    // the mutation touches.
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
