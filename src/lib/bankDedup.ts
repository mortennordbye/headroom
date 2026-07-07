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
