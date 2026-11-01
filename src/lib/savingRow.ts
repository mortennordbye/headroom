// How a row in the Budget page's savings list is presented: which kind of
// destination it feeds, and what that destination holds today. Pure so the page
// does not re-derive balance lookups inline, and so a missing account or a
// hand-edited NaN balance comes back as `null` rather than rendering "NaN kr".
import type { Assets, Goal, Saving } from '../context/FinanceContext';

/**
 * - `goal`: a savings account that a goal is funded from (a goal pot).
 * - `account`: any other savings account.
 * - `buffer`, `bsu`, `invested`: the single-balance destinations.
 */
export type SavingRowKind = 'goal' | 'account' | 'buffer' | 'bsu' | 'invested';

export interface SavingRowInfo {
  kind: SavingRowKind;
  /** The goal funded from this row's savings account; set iff kind is 'goal'. */
  goal?: Goal;
}

type SavingDestination = Pick<Saving, 'destinationKind' | 'savingsAccountId'>;

export function classifySaving(sv: SavingDestination, goals: Goal[]): SavingRowInfo {
  switch (sv.destinationKind) {
    case 'savingsAccount': {
      const goal = sv.savingsAccountId
        ? goals.find(g => g.source === 'savingsAccount' && g.savingsAccountId === sv.savingsAccountId)
        : undefined;
      return goal ? { kind: 'goal', goal } : { kind: 'account' };
    }
    case 'bufferAccount': return { kind: 'buffer' };
    case 'bsu': return { kind: 'bsu' };
    default: return { kind: 'invested' };
  }
}

const finite = (n: number | undefined): number | null => (Number.isFinite(n) ? (n as number) : null);

/** Today's balance of the row's destination, or null when it is unknown
 *  (deleted account, missing or non-finite figure). */
export function savingDestinationBalance(
  sv: SavingDestination,
  assets: Pick<Assets, 'savingsAccounts' | 'bufferAccount' | 'bsu' | 'portfolio'>,
): number | null {
  switch (sv.destinationKind) {
    case 'savingsAccount':
      return finite((assets.savingsAccounts ?? []).find(a => a.id === sv.savingsAccountId)?.balance);
    case 'bufferAccount': return finite(assets.bufferAccount);
    case 'bsu': return finite(assets.bsu);
    case 'portfolio': return finite(assets.portfolio);
    default: return null;
  }
}
