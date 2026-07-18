import type { DailyTransaction } from '../context/FinanceContext';

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
// this logic, including the two regexes below. The server can't import from src/,
// so the two are hand-maintained and MUST stay identical — change both or neither.
//
// Known limitation (see BACKLOG.md "Bank-id dedup regex ambiguity"): the
// prefixed-vs-bare split is inherently ambiguous. A legacy BARE id whose ref
// happens to start with 8 hex chars + '-' (e.g. `eb-a1b2c3d4-...`) is
// indistinguishable from a real PREFIXED id and is treated as prefixed. Not
// tightened here because no safe structural discriminator exists — guessing wrong
// could resurrect or double-count real bank transactions.
const PREFIXED = /^eb-[0-9a-f]{8}-(.+)$/i;
const BARE = /^eb-(?![0-9a-f]{8}-)(.+)$/i;

function prefixedRef(id: string): string | null {
  const m = typeof id === 'string' ? PREFIXED.exec(id) : null;
  return m ? m[1] : null;
}

function bareRef(id: string): string | null {
  const m = typeof id === 'string' ? BARE.exec(id) : null;
  return m ? m[1] : null;
}

// Idempotent: with no legacy twins it returns the list unchanged.
export function dedupeBankTransactions(txs: DailyTransaction[]): DailyTransaction[] {
  const prefixedRefs = new Set<string>();
  for (const t of txs) {
    const r = prefixedRef(t.id);
    if (r) prefixedRefs.add(r);
  }
  // A manual category on a dropped bare twin is rescued onto its prefixed
  // survivor so cleanup never loses a hand-set category.
  const rescue = new Map<string, Pick<DailyTransaction, 'category' | 'categorySource'>>();
  const out: DailyTransaction[] = [];
  for (const t of txs) {
    const br = bareRef(t.id);
    if (br && prefixedRefs.has(br)) {
      if (t.categorySource === 'manual' && t.category != null) {
        rescue.set(br, { category: t.category, categorySource: t.categorySource });
      }
      continue; // stale legacy twin — its prefixed row survives
    }
    out.push(t);
  }
  if (rescue.size === 0) return out;
  return out.map((t) => {
    const r = prefixedRef(t.id);
    const resc = r ? rescue.get(r) : undefined;
    return resc && t.categorySource !== 'manual' ? { ...t, ...resc } : t;
  });
}

// TWIN: `evictSupersededPending` in server/bank.js (CJS) is a byte-equivalent
// copy — change both or neither. Drops a provisional (pending) row once its
// BOOKED twin arrives, so the two ids for the same transaction don't double-count.
// Match is conservative (same account, |amount|, direction, within a few days);
// a manual category on the dropped pending row is rescued onto the survivor.
const PENDING_SUPERSEDE_DAYS = 6;
export function evictSupersededPending(txs: DailyTransaction[]): DailyTransaction[] {
  const pendings = txs.filter((t) => t.pending);
  if (pendings.length === 0) return txs;
  const booked = txs.filter((t) => !t.pending);
  const dropped = new Set<string>();
  const rescue = new Map<string, Pick<DailyTransaction, 'category' | 'categorySource'>>();
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
    }
  }
  if (dropped.size === 0) return txs;
  return txs
    .filter((t) => !dropped.has(t.id))
    .map((t) => {
      const r = rescue.get(t.id);
      return r && t.categorySource !== 'manual' ? { ...t, ...r } : t;
    });
}
