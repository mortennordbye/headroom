// The 12-month "money in vs money out" series behind CashflowChart and
// SavingsRateChart. Pure + unit-tested. Income for a month is its manual
// override when set, else an estimate: the flat fallback (the current effective
// income), optionally reshaped by the Norwegian June/December salary swings when
// a `seasonal` config is supplied (see feriepenger.ts). Fixed expenses aren't
// snapshotted, so the same current total is applied to every month and past
// months are approximate.
import type { DailyTransaction } from '../context/FinanceContext';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';

/**
 * Whether a transaction counts as spend (money out). Income rows are excluded;
 * a missing `kind` is treated as an expense (legacy rows). This is the app's
 * one "what counts as spend" predicate — keep other spend filters in sync.
 */
export function isSpend(tx: DailyTransaction): boolean {
  return tx.kind !== 'income';
}

export interface MonthlyCashflowRow {
  month: string; // 'yyyy-MM'
  income: number;
  variable: number; // logged expense transactions in the month
  expenses: number; // fixedExpenses + variable
  net: number; // income - expenses
  /** Savings rate as a percent of income; 0 when income ≤ 0. */
  rate: number;
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
): MonthlyCashflowRow[] {
  const spendByMonth = new Map<string, number>();
  for (const tx of txs) {
    if (!isSpend(tx)) continue;
    const key = tx.date.slice(0, 7);
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + tx.amount);
  }
  return months.map((month) => {
    const estimated = seasonal ? feriepengerMonthlyNet(month, fallbackIncome, seasonal) : fallbackIncome;
    const income = monthlyIncomes[month] ?? estimated;
    const variable = spendByMonth.get(month) ?? 0;
    const expenses = totalFixedExpenses + variable;
    const rate = income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : 0;
    return { month, income, variable, expenses, net: income - expenses, rate };
  });
}
