// The 12-month "money in vs money out" series behind CashflowChart and
// SavingsRateChart. Pure + unit-tested. Income for a month is its manual
// override when set, else an estimate: the flat fallback (the current effective
// income), optionally reshaped by the Norwegian June/December salary swings when
// a `seasonal` config is supplied (see feriepenger.ts). Fixed expenses aren't
// snapshotted, so the same current total is applied to every month and past
// months are approximate.
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';
import { reconcile } from './envelopes';
import { isSpend } from './spend';

// Re-exported so existing importers keep working; the definition lives in
// spend.ts so envelopes.ts can use it too (this module imports envelopes).
export { isSpend } from './spend';

export interface MonthlyCashflowRow {
  month: string; // 'yyyy-MM'
  income: number;
  variable: number; // logged expense transactions in the month
  expenses: number; // fixedExpenses + variable
  net: number; // income - expenses
  /** Savings rate as a percent of income; 0 when income ≤ 0. */
  rate: number;
  /**
   * Whether the month has any logged spend at all. A month from before the
   * user connected a bank (or started logging) has `variable === 0`, which
   * makes `rate` collapse to "income minus fixed expenses" and read as a great
   * savings month when it is really just an empty one. Callers should skip or
   * visually break these rather than plot them next to measured months.
   */
  measured: boolean;
}

export function monthlyCashflow(
  months: string[],
  txs: DailyTransaction[],
  monthlyIncomes: Record<string, number>,
  fallbackIncome: number,
  totalFixedExpenses: number,
  // When set (Norwegian salary), un-overridden months are shaped by the June
  // feriepenger spike and December half-trekk instead of the flat fallback.
  seasonal?: FeriepengerConfig | null,
  // The fixed-expense rows behind `totalFixedExpenses`. When supplied, a
  // budgeted line whose real payment was also imported is charged once instead
  // of twice — see the envelope reconciliation below. Must be the same list
  // `totalFixedExpenses` was summed from, or the two disagree.
  fixedExpenses?: FixedExpense[],
): MonthlyCashflowRow[] {
  const spendByMonth = new Map<string, number>();
  const countByMonth = new Map<string, number>();
  for (const tx of txs) {
    if (!isSpend(tx)) continue;
    const key = tx.date.slice(0, 7);
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + tx.amount);
    countByMonth.set(key, (countByMonth.get(key) ?? 0) + 1);
  }
  return months.map((month) => {
    const estimated = seasonal ? feriepengerMonthlyNet(month, fallbackIncome, seasonal) : fallbackIncome;
    const income = monthlyIncomes[month] ?? estimated;
    const variable = spendByMonth.get(month) ?? 0;
    // Without the fixed-expense rows we can only add the two totals, which
    // double-charges any bill that is both budgeted and imported. With them,
    // an enveloped bill costs max(budgeted, actual) — the budget is reserved and
    // its own transactions draw it down — and only unenveloped spend adds on top.
    let expenses = totalFixedExpenses + variable;
    if (fixedExpenses?.length) {
      const { totals } = reconcile(fixedExpenses, txs, month);
      const unenveloped = Math.max(0, variable - totals.actual);
      expenses = totalFixedExpenses + unenveloped + totals.overspent;
    }
    const rate = income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : 0;
    return {
      month, income, variable, expenses, net: income - expenses, rate,
      measured: (countByMonth.get(month) ?? 0) > 0,
    };
  });
}
