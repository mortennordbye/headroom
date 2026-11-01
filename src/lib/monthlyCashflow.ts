// The 12-month "money in vs money out" series behind CashflowChart and
// SavingsRateChart. Pure + unit-tested. Income for a month is its manual
// override when set, else an estimate: the flat fallback (the current effective
// income), optionally reshaped by the Norwegian June/December salary swings when
// a `seasonal` config is supplied (see feriepenger.ts). Fixed expenses are
// either one list/total for every month or resolved per month, so a past month
// can be measured against the fixed expenses it recorded.
import type { DailyTransaction, FixedExpense, Saving } from '../context/FinanceContext';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';
import { envelopeKeyForTx, reconcile } from './envelopes';
import { isSpend } from './spend';
import { savingsContributionTotal } from './savingsRate';
import { matchSavingsToTransactions } from './savingsMatch';

// Re-exported so existing importers keep working; the definition lives in
// spend.ts so envelopes.ts can use it too (this module imports envelopes).
export { isSpend } from './spend';

export interface MonthlyCashflowRow {
  month: string; // 'yyyy-MM'
  income: number;
  variable: number; // logged expense transactions in the month
  expenses: number; // fixedExpenses + variable (spending; never the savings below)
  /**
   * What the month moved into savings, when the caller passes `savingsFor`; else
   * 0. Kept out of `expenses`: a saving is still the user's money, not spending.
   * A saving matched to its imported outgoing row counts that row's amount once,
   * here, and the row leaves `expenses` (see savingsMatch.ts).
   */
  saved: number;
  net: number; // income - expenses - saved: what is left after spending and saving
  /**
   * Savings rate as a percent of income, (income - expenses) / income. With
   * `savingsFor`, savings sit outside `expenses` and count as retained; without
   * it, whatever savings the caller put in `totalFixedExpenses` count as spent.
   * 0 when income ≤ 0.
   */
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
  totalFixedExpenses: number | ((month: string) => number),
  // When set (Norwegian salary), un-overridden months are shaped by the June
  // feriepenger spike and December half-trekk instead of the flat fallback.
  seasonal?: FeriepengerConfig | null,
  // The fixed-expense rows behind `totalFixedExpenses`. When supplied, a
  // budgeted line whose real payment was also imported is charged once instead
  // of twice — see the envelope reconciliation below. Must be the same list
  // `totalFixedExpenses` was summed from, or the two disagree. Pass functions
  // for both to resolve each month's own fixed expenses.
  fixedExpenses?: FixedExpense[] | ((month: string) => FixedExpense[]),
  // Each month's savings (`savingsForMonth`). Must NOT also be inside
  // `totalFixedExpenses`: they are reported as `saved`, apart from spending, so
  // the cashflow classifies savings the same way as the savings rate. Each one is
  // matched against the month's spend rows so a one-legged savings transfer that
  // isn't marked as a transfer counts once, as saved, not also as spending.
  savingsFor?: (month: string) => Saving[],
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
    const fixedTotal = typeof totalFixedExpenses === 'function' ? totalFixedExpenses(month) : totalFixedExpenses;
    const fixedRows = typeof fixedExpenses === 'function' ? fixedExpenses(month) : fixedExpenses;
    const rec = fixedRows?.length ? reconcile(fixedRows, txs, month) : null;
    const monthSavings = savingsFor ? savingsFor(month) : [];
    // A row a fixed-expense envelope already owns can't also be a saving.
    const matches = matchSavingsToTransactions(monthSavings, txs, month, rec ? (tx) => envelopeKeyForTx(tx, rec) !== undefined : undefined);
    const matchedIds = new Set(matches.map((m) => m.savingId));
    const matchedSpend = matches.reduce((sum, m) => sum + m.amount, 0);
    let expenses = fixedTotal + variable - matchedSpend;
    if (rec) {
      const unenveloped = Math.max(0, variable - rec.totals.actual - matchedSpend);
      expenses = fixedTotal + unenveloped + rec.totals.overspent;
    }
    // A matched saving counts what its row actually moved; the rest, as planned.
    const saved = savingsContributionTotal(monthSavings.filter((s) => !matchedIds.has(s.id))) + matchedSpend;
    const rate = income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : 0;
    return {
      month, income, variable, expenses, saved, net: income - expenses - saved, rate,
      measured: (countByMonth.get(month) ?? 0) > 0,
    };
  });
}
