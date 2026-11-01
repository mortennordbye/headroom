import type { DailyTransaction, DeletedBankTombstone } from '../context/FinanceContext';
import type { TransactionSegment } from './segments';

// Remove duplicate bank rows created when the Enable-Banking id format changed.
// A transaction has historically been keyed two ways:
//   eb-<ref>            (legacy — the original single connection, no prefix)
//   eb-<conn8>-<ref>    (current — connection-prefixed for multi-bank support)
// When a connection went from bare to prefixed (e.g. a re-link minted a new
// connection id), every row re-imported under the new id and duplicated the bare
// legacy one. We drop the *bare* row when a prefixed row with the same
// entry_reference exists — but never merge two different prefixed connections,
// since separate banks may reuse an entry_reference (the prefix is what keeps
// those distinct). Manual (non-eb) rows are untouched.
//
// TWIN: `dropStaleBareTwins` in server/bank.js (CJS) is a byte-equivalent copy of
// this logic, including the regexes below. The server can't import from src/,
// so the two are hand-maintained and MUST stay identical — change both or neither.
//
// A legacy bare ref can itself start with 8 hex chars + '-', so the id text alone
// can't tell `eb-<conn8>-<ref>` from `eb-<ref>`. The 8-hex segment counts as a
// connection prefix only when a known connection has it: one named in
// `connectionPrefixes` (the server passes its live and removed connections'
// idPrefix values), or one seen in a row's account key (`<conn8>:<uid>`, stamped
// on every row a prefixed connection imports). Otherwise the id is bare.
const PREFIXED = /^eb-([0-9a-f]{8})-(.+)$/i;
const BARE = /^eb-(.+)$/i;
const CONNECTION_PREFIX = /^eb-([0-9a-f]{8})-$/i;
const ACCOUNT_CONNECTION = /^([0-9a-f]{8}):/i;

function knownPrefixes(txs: DailyTransaction[], connectionPrefixes: string[]): Set<string> {
  const known = new Set<string>();
  for (const p of connectionPrefixes) {
    const m = typeof p === 'string' ? CONNECTION_PREFIX.exec(p) : null;
    if (m) known.add(m[1].toLowerCase());
  }
  for (const t of txs) {
    const m = typeof t.account === 'string' ? ACCOUNT_CONNECTION.exec(t.account) : null;
    if (m) known.add(m[1].toLowerCase());
  }
  return known;
}

function prefixedRef(id: string, known: Set<string>): string | null {
  const m = typeof id === 'string' ? PREFIXED.exec(id) : null;
  return m && known.has(m[1].toLowerCase()) ? m[2] : null;
}

function bareRef(id: string, known: Set<string>): string | null {
  const m = typeof id === 'string' ? BARE.exec(id) : null;
  return m && prefixedRef(id, known) == null ? m[1] : null;
}

// Idempotent: with no legacy twins it returns the list unchanged.
export function dedupeBankTransactions(txs: DailyTransaction[], connectionPrefixes: string[] = []): DailyTransaction[] {
  const known = knownPrefixes(txs, connectionPrefixes);
  const prefixedRefs = new Set<string>();
  for (const t of txs) {
    const r = prefixedRef(t.id, known);
    if (r) prefixedRefs.add(r);
  }
  // A manual category or segment on a dropped bare twin is rescued onto its prefixed
  // survivor so cleanup never loses a hand-set category.
  const rescue = new Map<string, Pick<DailyTransaction, 'category' | 'categorySource'>>();
  const segmentRescue = new Map<string, TransactionSegment>();
  const out: DailyTransaction[] = [];
  for (const t of txs) {
    const br = bareRef(t.id, known);
    if (br && prefixedRefs.has(br)) {
      if (t.categorySource === 'manual' && t.category != null) {
        rescue.set(br, { category: t.category, categorySource: t.categorySource });
      }
      if (t.segment) segmentRescue.set(br, t.segment);
      continue; // stale legacy twin — its prefixed row survives
    }
    out.push(t);
  }
  if (rescue.size === 0 && segmentRescue.size === 0) return out;
  return out.map((t) => {
    const r = prefixedRef(t.id, known);
    const resc = r ? rescue.get(r) : undefined;
    const seg = r ? segmentRescue.get(r) : undefined;
    let row = resc && t.categorySource !== 'manual' ? { ...t, ...resc } : t;
    if (seg && !t.segment) row = { ...row, segment: seg };
    return row;
  });
}

// TWIN: `evictSupersededPending` in server/bank.js (CJS) is a byte-equivalent
// copy — change both or neither. Drops a provisional (pending) row once its
// BOOKED twin arrives, so the two ids for the same transaction don't double-count.
// Match is conservative (same account, |amount|, direction, within a few days);
// a manual category or segment on the dropped pending row is rescued onto the survivor.
const PENDING_SUPERSEDE_DAYS = 6;
export function evictSupersededPending(txs: DailyTransaction[]): DailyTransaction[] {
  const pendings = txs.filter((t) => t.pending);
  if (pendings.length === 0) return txs;
  const booked = txs.filter((t) => !t.pending);
  const dropped = new Set<string>();
  const rescue = new Map<string, Pick<DailyTransaction, 'category' | 'categorySource'>>();
  const segmentRescue = new Map<string, TransactionSegment>();
  for (const p of pendings) {
    const match = booked.find(
      (b) => (b.account || '') === (p.account || '')
        && (b.kind || 'expense') === (p.kind || 'expense')
        && Math.abs(b.amount - p.amount) < 0.005
        && Math.abs((Date.parse(b.date) - Date.parse(p.date)) / 864e5) <= PENDING_SUPERSEDE_DAYS,
    );
    if (match) {
      dropped.add(p.id);
      if (p.categorySource === 'manual' && p.category != null) rescue.set(match.id, { category: p.category, categorySource: p.categorySource });
      if (p.segment) segmentRescue.set(match.id, p.segment);
    }
  }
  if (dropped.size === 0) return txs;
  return txs
    .filter((t) => !dropped.has(t.id))
    .map((t) => {
      const r = rescue.get(t.id);
      const s = segmentRescue.get(t.id);
      let row = r && t.categorySource !== 'manual' ? { ...t, ...r } : t;
      if (s && !t.segment) row = { ...row, segment: s };
      return row;
    });
}

// Remember what a deleted bank (eb-) row looked like, next to its id in
// `deletedBankIds`. After a re-link the bank may resend that row under a new
// reference format, which the id alone can't catch; the server matches these
// fingerprints the way it matches stored rows (`dropRelinkFormatTwins` in
// server/bank.js). `deletedAt` records when, since a row's date can be edited
// before it is deleted (prunableBankTombstoneIds). Returns `prev` unchanged when
// nothing new was removed.
export function addDeletedBankTombstones(prev: DeletedBankTombstone[], removed: DailyTransaction[], now: Date = new Date()): DeletedBankTombstone[] {
  const have = new Set(prev.map((t) => t.id));
  const added: DeletedBankTombstone[] = [];
  for (const t of removed) {
    if (typeof t.id !== 'string' || !t.id.startsWith('eb-') || have.has(t.id)) continue;
    have.add(t.id);
    added.push({
      id: t.id, date: t.date, amount: t.amount, account: t.account, description: t.description, kind: t.kind,
      ...(t.pending ? { pending: true } : {}),
      deletedAt: now.toISOString(),
    });
  }
  return added.length ? [...prev, ...added] : prev;
}

// A deleted bank row that is back in the ledger (the delete was undone) is no
// longer deleted: drop its id from `deletedBankIds` and its tombstone, or the
// next sync filters the restored row out again. Works on either list; returns
// `list` unchanged when nothing was restored.
export function forgetRestoredBankRows<T extends string | { id: string }>(list: T[], present: Set<string>): T[] {
  const next = list.filter((x) => !present.has(typeof x === 'string' ? x : x.id));
  return next.length === list.length ? list : next;
}

// What GET /api/bank/status `tombstoneCutoffs` carries (server/bank.js
// tombstoneCutoffs): per account key, and per id prefix as a fallback, the day
// before which no future sync can return a row (floor minus the margin; the
// server enforces it on both the request and the response). A prefix maps to
// null when it can't be bounded.
export interface TombstoneCutoffs {
  accounts?: Record<string, string>;
  prefixes?: Record<string, string | null>;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v);

// The ids of deleted bank rows no future sync can return, so their tombstones and
// `deletedBankIds` entries can go (drop them with forgetRestoredBankRows). A
// tombstone with an `account` is judged by that account's cutoff alone, and kept
// when the account has none. One without an account falls back to the id
// prefixes it starts with (the legacy bare `eb-` prefix overlaps the others):
// it is kept when it matches none or any of them is null, else judged by the
// lowest. Both the row's date and when it was deleted (`deletedAt`) must be
// before the cutoff: the date can be edited before a delete, so a recent row
// backdated and deleted would otherwise be pruned while the overlap fetch can
// still return it, and a row can't be dated after the day it was deleted by more
// than the margin. A tombstone without `deletedAt` (written before it existed)
// is never pruned, since its date may have been edited. An unreadable date keeps
// the tombstone, and a duplicate id is kept if any copy must stay. Legacy ids
// with no tombstone carry no date and are never returned here. Pure.
export function prunableBankTombstoneIds(
  tombstones: DeletedBankTombstone[],
  cutoffs: TombstoneCutoffs | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!cutoffs || typeof cutoffs !== 'object') return out;
  const accounts = cutoffs.accounts && typeof cutoffs.accounts === 'object' ? cutoffs.accounts : {};
  const prefixes = cutoffs.prefixes && typeof cutoffs.prefixes === 'object' ? cutoffs.prefixes : {};
  const cutoffFor = (t: DeletedBankTombstone): string | null => {
    if (typeof t.account === 'string' && t.account) {
      const c = accounts[t.account];
      return isDay(c) ? c : null;
    }
    let lowest: string | null = null;
    for (const [p, c] of Object.entries(prefixes)) {
      if (!t.id.startsWith(p)) continue;
      if (!isDay(c)) return null;
      if (lowest == null || c < lowest) lowest = c;
    }
    return lowest;
  };
  const keep = new Set<string>();
  for (const t of tombstones) {
    if (!t || typeof t.id !== 'string') continue;
    const day = typeof t.date === 'string' ? t.date.slice(0, 10) : '';
    const deleted = typeof t.deletedAt === 'string' ? t.deletedAt.slice(0, 10) : '';
    const cutoff = cutoffFor(t);
    if (cutoff != null && isDay(day) && day < cutoff && isDay(deleted) && deleted < cutoff) out.add(t.id);
    else keep.add(t.id);
  }
  for (const id of keep) out.delete(id);
  return out;
}
