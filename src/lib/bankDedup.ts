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
