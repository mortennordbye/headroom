// Savings-account migrations, extracted from FinanceContext so the payload
// registry (and its tests) can apply them without pulling in React. Pure domain
// logic: normalise a loaded/imported assets blob into a savingsAccounts array,
// and mirror that onto stored balance snapshots. Behaviour is byte-for-byte the
// same as the inline versions these replaced.
import type { Assets, SavingsAccount, BalanceSnapshot, FixedExpense } from '../context/FinanceContext';
import { isSavingsDestination } from './savingsRate';

// Stable-ish unique id (also used by FinanceContext's array CRUD helpers). Not
// cryptographic — just needs to avoid collisions within a session.
export const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Normalise a loaded/imported assets blob into a savings-accounts array. If the
// array is present it's cleaned (valid id/name/number balance); when it's absent
// *or empty*, a nonzero legacy `savings` scalar is migrated into one account
// (empty-array-with-scalar is real in the wild: the pre-1.8 onboarding wrote the
// scalar next to the default empty array). Returning an array (never undefined)
// makes `savingsAccounts` the canonical source; the caller zeroes the scalar.
export function migrateSavingsAccounts(a: Assets): SavingsAccount[] {
  const raw: unknown = a.savingsAccounts;
  if (Array.isArray(raw)) {
    const cleaned = raw
      .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      .map((x) => {
        const bal = x.balance;
        const balance = typeof bal === 'number' && Number.isFinite(bal)
          ? bal
          : typeof bal === 'string' ? (parseFloat(bal.replace(',', '.')) || 0) : 0;
        return {
          id: typeof x.id === 'string' && x.id ? x.id : makeId('sav'),
          name: typeof x.name === 'string' ? x.name : 'Sparekonto',
          balance,
        };
      });
    if (cleaned.length > 0) return cleaned;
  }
  const legacy = typeof a.savings === 'number' && Number.isFinite(a.savings) ? a.savings : 0;
  return legacy > 0 ? [{ id: makeId('sav'), name: 'Sparekonto', balance: legacy }] : [];
}

// Repair rows that move money into a savings vehicle but are stored with a
// spending `type`. Every writer before the 'saving' type existed — and
// SavingsAllocationPanel after it — stamped `type: 'fixed'`, so a stock transfer
// persisted as a fixed expense. The Budget page hid it because `isSavingsRow`
// also matches on the destination, but anything keyed on `type` alone read it as
// a bill: it drew the 'fixed' colour, and `essentialMonthlyExpenses` counted it
// as spend you cannot cancel, shrinking the emergency-fund runway.
//
// The destination is the reliable signal — it is what actually moves the money —
// so it wins over the stored type. Idempotent: rows already typed 'saving', and
// rows with no savings destination, come back untouched (same object identity,
// so a loaded blob with nothing to fix keeps its array reference).
export function migrateSavingsExpenseType(expenses: FixedExpense[]): FixedExpense[] {
  return expenses.map(e =>
    isSavingsDestination(e.destinationKind) && e.type !== 'saving'
      ? { ...e, type: 'saving' as const }
      : e,
  );
}

// One-time migration of stored balance snapshots, mirroring what applyPayload
// does to the live assets: give each snapshot's assets the canonical
// savingsAccounts array and zero the legacy scalar. The client re-saves the
// whole blob after load, so this self-persists and `sumSavings`' scalar
// fallback stops being load-bearing for migrated data.
export function migrateSnapshotSavings(snaps: Record<string, BalanceSnapshot>): Record<string, BalanceSnapshot> {
  const out: Record<string, BalanceSnapshot> = {};
  for (const [month, snap] of Object.entries(snaps)) {
    out[month] = snap && snap.assets && typeof snap.assets === 'object'
      ? { ...snap, assets: { ...snap.assets, savings: 0, savingsAccounts: migrateSavingsAccounts(snap.assets) } }
      : snap;
  }
  return out;
}
