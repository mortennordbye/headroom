// HTTP adapter to the running Headroom app.
//
// Reads and writes go through the app's own /api/data endpoint (never SQLite
// directly) so every write inherits the server-side guards: isValidFinancePayload,
// optimistic-concurrency `rev`, reconcileBankTransactions and preserveUserFields
// (server/index.js). Reading via the same channel keeps `rev` consistent for the
// read-modify-write mutation flow.

import type { ExportPayload } from '../src/context/FinanceContext';

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

/** GET the whole finance blob plus its current rev. Logs in once if auth is on. */
export async function getData(retryOnAuth = true): Promise<DataSnapshot> {
  const res = await fetch(`${BASE_URL}/api/data`, { headers: authHeaders() });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return getData(false);
  }
  if (!res.ok) throw new Error(`GET /api/data failed (${res.status})`);
  const rev = Number(res.headers.get('x-data-rev') ?? 0);
  const blob = (await res.json()) as ExportPayload | null;
  if (!blob) throw new Error('no data yet — open the app and enter some data first');
  return { blob, rev };
}

/** POST the whole blob back, echoing the rev for optimistic concurrency. */
async function putData(blob: ExportPayload, rev: number, retryOnAuth = true): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/data`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json', 'x-data-rev': String(rev) }),
    body: JSON.stringify(blob),
  });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return putData(blob, rev, false);
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { currentRev?: number };
    throw new RevConflictError(Number(body.currentRev ?? rev));
  }
  if (!res.ok) throw new Error(`POST /api/data failed (${res.status})`);
  const body = (await res.json()) as { rev: number };
  return body.rev;
}

export interface HistoryEntry {
  rev: number;
  ts: string;
  bytes: number;
}

/** List recent stored revisions (newest first) with timestamps and sizes. */
export async function listHistory(
  retryOnAuth = true,
): Promise<{ revisions: HistoryEntry[]; limit: number }> {
  const res = await fetch(`${BASE_URL}/api/history`, { headers: authHeaders() });
  if (res.status === 401 && retryOnAuth) {
    await login();
    return listHistory(false);
  }
  if (!res.ok) throw new Error(`GET /api/history failed (${res.status})`);
  return (await res.json()) as { revisions: HistoryEntry[]; limit: number };
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
    headers: authHeaders(),
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
 * Read-modify-write one slice of the blob. `mutate` receives a deep-cloned blob,
 * changes only what it needs, and returns it. On a rev conflict we re-read and
 * apply once more, then give up loudly — never a silent clobber.
 */
export async function applyMutation(
  mutate: (blob: ExportPayload) => ExportPayload,
): Promise<{ rev: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { blob, rev } = await getData();
    const next = mutate(structuredClone(blob));
    try {
      const newRev = await putData(next, rev);
      return { rev: newRev };
    } catch (err) {
      if (err instanceof RevConflictError && attempt === 0) continue; // re-read and retry once
      throw err;
    }
  }
  throw new RevConflictError(-1);
}
