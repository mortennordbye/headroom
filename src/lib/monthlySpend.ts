// Per-account spending totals over a set of months, for the Budget page's
// "spending per account per month" table. Pure + unit-tested. Income is
// excluded (this is money out); accounts are grouped by their display label, so
// two accounts sharing a name (a merge) roll up into one row.
import type { DailyTransaction } from '../context/FinanceContext';
import { accountGroupLabel, accountGroupKey } from './account';

export interface AccountMonthRow {
  key: string;
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
  // Group by the specific account (key), display its label — same model as the
  // Budget filter, so a table row is one account, not one holder name.
  const byAcct = new Map<string, { label: string; totals: number[] }>();
  for (const t of txs) {
    if (t.kind === 'income') continue;
    const key = accountGroupKey(t, accountLabels);
    if (!key) continue;
    const mi = idx.get(t.date.slice(0, 7));
    if (mi === undefined) continue;
    if (!byAcct.has(key)) byAcct.set(key, { label: accountGroupLabel(t, accountLabels) || key, totals: months.map(() => 0) });
    byAcct.get(key)!.totals[mi] += t.amount;
  }
  return [...byAcct.entries()]
    .map(([key, v]) => ({ key, label: v.label, totals: v.totals, sum: v.totals.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sum - a.sum);
}

/** Column (per-month) totals across all account rows. */
export function monthlyColumnTotals(rows: AccountMonthRow[], monthCount: number): number[] {
  const totals = Array.from({ length: monthCount }, () => 0);
  for (const r of rows) r.totals.forEach((v, i) => { totals[i] += v; });
  return totals;
}
