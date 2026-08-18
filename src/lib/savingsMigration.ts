// Savings-account migrations, extracted from FinanceContext so the payload
// registry (and its tests) can apply them without pulling in React. Pure domain
// logic: normalise a loaded/imported assets blob into a savingsAccounts array,
// and mirror that onto stored balance snapshots. Behaviour is byte-for-byte the
// same as the inline versions these replaced.
import type {
  Assets, SavingsAccount, BalanceSnapshot, FixedExpense, Saving, SavingDestinationKind,
} from '../context/FinanceContext';

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

// A stored fixed-expense row as it may exist in an old blob: before savings
// became their own record type, a saving WAS a fixed expense, marked either by
// `type: 'saving'` or by pointing at a savings vehicle (writers disagreed about
// which, which is precisely why both had to be checked at read time).
type LegacyFixedExpense =
  Omit<FixedExpense, 'type' | 'destinationKind'>
  & {
    type?: FixedExpense['type'] | 'saving';
    destinationKind?: FixedExpense['destinationKind'] | SavingDestinationKind;
    savingsAccountId?: string;
    amountPercent?: number;
    amountRest?: boolean;
    bufferTargetAmount?: number;
  };

const SAVING_DESTINATIONS: ReadonlySet<string> = new Set<SavingDestinationKind>([
  'savingsAccount', 'bufferAccount', 'portfolio', 'bsu',
]);

/**
 * True for a legacy row that is money retained rather than spent — either
 * because it was explicitly typed as saving, or because it moved a balance into
 * a savings vehicle. Both count, for the same reason the old `isSavingsRow` had
 * to check both: the type was the user's classification, the destination was
 * what actually moved the money, and a row could legitimately have one without
 * the other.
 */
function isLegacySaving(e: LegacyFixedExpense): boolean {
  return e.type === 'saving' || (!!e.destinationKind && SAVING_DESTINATIONS.has(e.destinationKind));
}

export interface SavingsPartition {
  /** The rows that are genuinely spend, with the savings-only fields stripped. */
  expenses: FixedExpense[];
  /** The rows that were savings, rebuilt as `Saving` records. */
  savings: Saving[];
}

/**
 * Split a stored `fixedExpenses` array into real expenses and real savings.
 *
 * This is the load-time half of giving savings their own type: every blob
 * written before the split holds both in one array, and the two are told apart
 * exactly the way the app already told them apart at runtime. Field renames
 * follow (`amountPercent`/`amountRest` → `mode` + `percent`, `automationPaused`
 * → `paused`), so the resolved shape matches `SavingsAllocation`'s.
 *
 * Not a krone moves: a row lands in exactly one of the two arrays with its
 * `amount` untouched, so every total built from expenses + savings is unchanged.
 *
 * Pure and idempotent — re-running it on the `expenses` half yields no further
 * savings, and an already-split blob (savings array present, none left inline)
 * comes back with the same rows.
 */
export function partitionSavings(expenses: LegacyFixedExpense[]): SavingsPartition {
  const out: SavingsPartition = { expenses: [], savings: [] };
  for (const e of expenses) {
    if (!isLegacySaving(e)) {
      // Strip the savings-only fields rather than carrying them as dead weight
      // on a bill — a stray `amountPercent` on a fixed expense was never read,
      // but it would survive every export forever.
      const { savingsAccountId: _s, amountPercent: _p, amountRest: _r, bufferTargetAmount: _b,
        type, destinationKind, debtId, ...rest } = e;
      // Keys are added only when they have a value, never stamped as explicit
      // `undefined`: the persisted blob is compared field-by-field on round-trip,
      // and an `undefined` that wasn't there before is a change.
      const kept: FixedExpense = { ...rest };
      // 'saving' is no longer an ExpenseType; a row typed that way but with no
      // savings destination cannot happen (isLegacySaving caught it above).
      if (type && type !== 'saving') kept.type = type;
      if (destinationKind === 'mortgage' || destinationKind === 'debt') {
        kept.destinationKind = destinationKind;
        if (destinationKind === 'debt' && debtId) kept.debtId = debtId;
      }
      out.expenses.push(kept);
      continue;
    }
    const destinationKind = (e.destinationKind && SAVING_DESTINATIONS.has(e.destinationKind)
      ? e.destinationKind
      // A row typed 'saving' that was never pointed anywhere still has to land
      // somewhere; the investment portfolio is the dialog's own default.
      : 'portfolio') as SavingDestinationKind;
    const percent = typeof e.amountPercent === 'number' && Number.isFinite(e.amountPercent) && e.amountPercent > 0
      ? e.amountPercent : undefined;
    const sv: Saving = {
      id: e.id,
      name: e.name,
      amount: Number.isFinite(e.amount) ? e.amount : 0,
      // 'rest' wins over a percentage, matching the old `isPercentSavings`
      // guard (`!e.amountRest && …`), so a row that carried both keeps behaving
      // as it did before the split.
      mode: e.amountRest === true ? 'rest' : percent !== undefined ? 'percent' : 'amount',
      destinationKind,
    };
    if (percent !== undefined && e.amountRest !== true) sv.percent = percent;
    if (destinationKind === 'savingsAccount' && e.savingsAccountId) sv.savingsAccountId = e.savingsAccountId;
    if (e.automationPaused === true) sv.paused = true;
    if (e.lastPostedMonth) sv.lastPostedMonth = e.lastPostedMonth;
    if (e.bufferTargetAmount !== undefined) sv.bufferTargetAmount = e.bufferTargetAmount;
    out.savings.push(sv);
  }
  return out;
}

/**
 * Every saving a loaded blob holds: the ones already stored under the `savings`
 * key, plus the ones still inline in `fixedExpenses` because the blob predates
 * the split. Concatenated rather than merged — a blob written after the split
 * has nothing left inline, and one written before has no `savings` key at all,
 * so the two sources never describe the same row.
 */
export function mergeStoredSavings(
  stored: Saving[] | undefined,
  expenses: LegacyFixedExpense[] | undefined,
): Saving[] {
  return [...(stored ?? []), ...partitionSavings(expenses ?? []).savings];
}

// One-time migration of stored balance snapshots, mirroring what applyPayload
// does to the live state: give each snapshot's assets the canonical
// savingsAccounts array and zero the legacy scalar, and split its captured
// budget composition into expenses and savings the same way the live arrays are
// split. The client re-saves the whole blob after load, so this self-persists
// and `sumSavings`' scalar fallback stops being load-bearing for migrated data.
//
// Re-partitioning a snapshot does not rewrite history: the captured rows keep
// their recorded amounts, they are only filed under the right heading. A v1/v2
// snapshot has no `savings` key, so its savings come out of `fixedExpenses`;
// a v3 one already has them and nothing inline is left to move.
export function migrateSnapshotSavings(snaps: Record<string, BalanceSnapshot>): Record<string, BalanceSnapshot> {
  const out: Record<string, BalanceSnapshot> = {};
  for (const [month, snap] of Object.entries(snaps)) {
    const hasAssets = !!snap && typeof snap === 'object' && !!snap.assets && typeof snap.assets === 'object';
    const hasRows = !!snap && typeof snap === 'object' && Array.isArray(snap.fixedExpenses);
    // Identity in, identity out when there is nothing to migrate — memoized
    // readers of a loaded blob shouldn't churn on every load.
    if (!hasAssets && !hasRows) { out[month] = snap; continue; }
    const next = { ...snap };
    if (hasAssets) {
      next.assets = { ...snap.assets, savings: 0, savingsAccounts: migrateSavingsAccounts(snap.assets) };
    }
    if (hasRows) {
      const { expenses, savings } = partitionSavings(snap.fixedExpenses!);
      next.fixedExpenses = expenses;
      // Only write the key when there is something to write: a recorded month
      // that never had a saving must come back exactly as it was stored, or the
      // load→save cycle rewrites history with an empty array it never held.
      const merged = [...(snap.savings ?? []), ...savings];
      if (merged.length > 0) next.savings = merged;
    }
    out[month] = next;
  }
  return out;
}
