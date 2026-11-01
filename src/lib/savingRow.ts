// How a row in the Budget page's savings list is presented: which kind of
// destination it feeds, which goals it funds, and what that destination held in
// the month on screen. Pure so the page does not re-derive balance lookups
// inline, and so a missing account or a hand-edited NaN balance comes back as
// `null` rather than rendering "NaN kr".
import type { Assets, Goal, Saving, SavingsAccount } from '../context/FinanceContext';

/** The balance-bearing slice of `Assets` a saving can point at. */
export type VehicleAssets = Pick<Assets, 'savingsAccounts' | 'bufferAccount' | 'bsu' | 'portfolio'>;

/** One savings vehicle, named as both `Saving.destinationKind` and the matching
 *  `Goal.source` values name it. */
export type Vehicle = 'savingsAccount' | 'bufferAccount' | 'bsu' | 'portfolio';

const finite = (n: number | undefined): number | null => (Number.isFinite(n) ? (n as number) : null);

/**
 * The balance of one savings vehicle in `assets`, or null when it is unknown
 * (no such account, missing or non-finite figure). Shared with the goal pace
 * series, which reads the same vehicles out of monthly snapshots.
 */
export function vehicleBalance(vehicle: Vehicle, accountId: string | undefined, assets: VehicleAssets): number | null {
  switch (vehicle) {
    case 'savingsAccount': return finite((assets.savingsAccounts ?? []).find(a => a.id === accountId)?.balance);
    case 'bufferAccount': return finite(assets.bufferAccount);
    case 'bsu': return finite(assets.bsu);
    case 'portfolio': return finite(assets.portfolio);
    default: return null;
  }
}

/**
 * Which assets to read a destination balance from for the month on screen:
 * live state for the current month, that month's recorded snapshot for a past
 * month, and nothing for a future month or a past month without a snapshot.
 * Showing today's balance against an old month would read as history.
 */
export function balanceAssetsForMonth(
  monthKey: string,
  nowKey: string,
  liveAssets: VehicleAssets,
  snapshots: Record<string, { assets: VehicleAssets }>,
): VehicleAssets | null {
  if (monthKey === nowKey) return liveAssets;
  if (monthKey > nowKey) return null;
  return snapshots[monthKey]?.assets ?? null;
}

/**
 * - `goal`: a savings account that one or more goals are funded from (a goal pot).
 * - `account`: any other savings account, and the fallback for an unknown kind.
 * - `buffer`, `bsu`, `invested`: the single-balance destinations.
 *
 * Only goals linked to one specific savings account (`source: 'savingsAccount'`)
 * make a row a goal pot. A goal on a scalar source (BSU, buffer, portfolio) tracks
 * the whole balance rather than a pot the row fills, so those rows keep their
 * own kind.
 */
export type SavingRowKind = 'goal' | 'account' | 'buffer' | 'bsu' | 'invested';

export interface SavingRow {
  kind: SavingRowKind;
  /** Goals funded from this row's savings account; non-empty iff kind is 'goal'. */
  goals: Goal[];
  /** The destination account, for a savings-account row whose account exists. */
  account?: SavingsAccount;
  /** A savings-account row whose account no longer exists. */
  accountMissing: boolean;
  /** Destination balance in the month on screen, or null when unknown. */
  balance: number | null;
}

/**
 * Classify a saving and read its destination balance. `liveAssets` decides
 * whether the account still exists; `monthAssets` (from `balanceAssetsForMonth`)
 * supplies the balance, null meaning "don't show one".
 */
export function savingRow(
  sv: Pick<Saving, 'destinationKind' | 'savingsAccountId'>,
  goals: Goal[],
  liveAssets: VehicleAssets,
  monthAssets: VehicleAssets | null,
): SavingRow {
  const balanceFrom = (vehicle: Vehicle) => (monthAssets ? vehicleBalance(vehicle, sv.savingsAccountId, monthAssets) : null);
  switch (sv.destinationKind) {
    case 'savingsAccount': {
      const account = sv.savingsAccountId
        ? (liveAssets.savingsAccounts ?? []).find(a => a.id === sv.savingsAccountId)
        : undefined;
      if (!account) return { kind: 'account', goals: [], accountMissing: true, balance: null };
      const funded = goals.filter(g => g.source === 'savingsAccount' && g.savingsAccountId === account.id);
      // The account object is already in hand for the current month.
      const balance = monthAssets === liveAssets ? finite(account.balance) : balanceFrom('savingsAccount');
      return { kind: funded.length ? 'goal' : 'account', goals: funded, account, accountMissing: false, balance };
    }
    case 'bufferAccount': return { kind: 'buffer', goals: [], accountMissing: false, balance: balanceFrom('bufferAccount') };
    case 'bsu': return { kind: 'bsu', goals: [], accountMissing: false, balance: balanceFrom('bsu') };
    case 'portfolio': return { kind: 'invested', goals: [], accountMissing: false, balance: balanceFrom('portfolio') };
    default: return { kind: 'account', goals: [], accountMissing: false, balance: null };
  }
}

/** "Car", or "Car +2" when one account funds several goals. */
export function goalNamesLabel(goals: Pick<Goal, 'name'>[]): string {
  if (goals.length === 0) return '';
  return goals.length === 1 ? goals[0].name : `${goals[0].name} +${goals.length - 1}`;
}
