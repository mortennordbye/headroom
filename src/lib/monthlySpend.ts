// Per-account spending totals over a set of months, for the Budget page's
// "spending per account per month" table. Pure + unit-tested. Income is
// excluded (this is money out); accounts are grouped by their display label, so
// two accounts sharing a name (a merge) roll up into one row.
import type { DailyTransaction } from '../context/FinanceContext';
import { accountGroupLabel } from './account';

export interface AccountMonthRow {
  label: string;
  totals: number[]; // one entry per month, same order as `months`
  sum: number;
}

export function accountMonthlyTotals(
  txs: DailyTransaction[],
  accountLabels: Record<string, string>,
  months: string[],
): AccountMonthRow[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const byAcct = new Map<string, number[]>();
  for (const t of txs) {
    if (t.kind === 'income') continue;
    const label = accountGroupLabel(t, accountLabels);
    if (!label) continue;
    const mi = idx.get(t.date.slice(0, 7));
    if (mi === undefined) continue;
    if (!byAcct.has(label)) byAcct.set(label, months.map(() => 0));
    byAcct.get(label)![mi] += t.amount;
  }
  return [...byAcct.entries()]
    .map(([label, totals]) => ({ label, totals, sum: totals.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sum - a.sum);
}

/** Column (per-month) totals across all account rows. */
export function monthlyColumnTotals(rows: AccountMonthRow[], monthCount: number): number[] {
  const totals = Array.from({ length: monthCount }, () => 0);
  for (const r of rows) r.totals.forEach((v, i) => { totals[i] += v; });
  return totals;
}
