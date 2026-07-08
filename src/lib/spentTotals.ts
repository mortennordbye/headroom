import type { DailyDataEntry } from '../context/FinanceContext';

// Two deliberate definitions of "spent this month" ship on different surfaces;
// this is the one place that names the difference:
//
//  - `sumLedgerSpent`: raw expense total, envelope-covered spend included —
//    what actually left the account. The Budget ledger uses this because it is
//    a faithful record of money out.
//  - `sumDiscretionarySpent`: only the portion that drew down the daily budget
//    (envelope spillover + non-enveloped spend). Dashboard pacing, burn rate
//    and the composition bar use this because envelope-covered spend is
//    already accounted for inside totalFixedExpenses — counting it again
//    would double-count.

type SpendDay = Pick<DailyDataEntry, 'spent' | 'discretionary'>;

export function sumLedgerSpent(days: SpendDay[]): number {
  return days.reduce((sum, d) => sum + d.spent, 0);
}

export function sumDiscretionarySpent(days: SpendDay[]): number {
  return days.reduce((sum, d) => sum + d.discretionary, 0);
}
