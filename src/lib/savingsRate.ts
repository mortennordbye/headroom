// Trailing savings-rate health, derived from the same `monthlyCashflow` rows
// that feed SavingsRateChart. Pure + unit-tested so the Budget page can flag a
// slipping rate without re-deriving the money math in a component.
import type { FixedExpense } from '../context/FinanceContext';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';

/** Finite-and-non-negative guard against a hand-edited undefined/NaN amount. */
const amount = (n: number | undefined): number => (Number.isFinite(n) ? Math.max(0, n as number) : 0);

/**
 * The part of the fixed-expense list that is money moved into savings rather
 * than spent (a `savingsAccount` / `bufferAccount` automation). It leaves
 * free-to-spend like any other fixed expense, but it is still the user's money,
 * so the savings rate must not subtract it as if it were consumption.
 *
 * `mortgage` / `debt` destinations are deliberately NOT included: only the
 * principal portion of those builds equity and this list holds the gross
 * payment, so counting them whole would overstate the rate.
 */
export function savingsContributionTotal(fixedExpenses: FixedExpense[]): number {
  return fixedExpenses.reduce(
    (sum, e) =>
      e.destinationKind === 'savingsAccount' || e.destinationKind === 'bufferAccount'
        ? sum + amount(e.amount)
        : sum,
    0,
  );
}

/**
 * The user's savings target restated as a share of income, so it can be
 * compared against (and drawn on top of) the income-denominated rate from
 * `monthlyCashflow`.
 *
 * `savingsTargetPercent` is a share of the *residual* (income − fixed
 * expenses) — see calcRecommendations — which is a different quantity from the
 * chart's share of *income*. Plotting the raw percent on the rate axis compares
 * two unlike things and makes the target look unreachable.
 *
 * The plan intends the user to retain their automated contributions plus
 * `targetPct` of what is left over, hence:
 *   (contributions + residual × targetPct) / income
 */
export function targetRateOfIncome(
  income: number,
  totalFixedExpenses: number,
  contributionTotal: number,
  targetPct: number,
): number {
  if (income <= 0) return 0;
  const residual = Math.max(0, income - totalFixedExpenses);
  const retained = contributionTotal + residual * (targetPct / 100);
  return Math.round((retained / income) * 1000) / 10;
}

export interface PlanSavingsRow {
  month: string;   // 'yyyy-MM'
  income: number;
  /** Share of income left after the consumption part of the fixed expenses, %. */
  rate: number;
  /** Always true — a plan row is never an unmeasured month. */
  measured: boolean;
}

/**
 * The savings rate as a PLAN figure: for each month, the share of income left
 * after the consumption part of the fixed expenses.
 *
 * Deliberately transaction-free. The chart used to plot
 * (income − fixed − logged spend) / income, which meant a single imported
 * transfer moved a line the user reads as their budget, and months from before a
 * bank was connected had to be blanked out as "unmeasured". This version answers
 * the question the card's own subtitle asks — "andel av inntekt igjen etter
 * utgifter" — from income, fixed expenses and the savings target alone, so it is
 * complete for every month and identical whether or not a bank is connected.
 *
 * `spendFixedTotal` must exclude automated savings contributions: money moved to
 * a savings account is retained, not spent (see `savingsContributionTotal`).
 */
export function planSavingsRateSeries(
  months: string[],
  monthlyIncomes: Record<string, number>,
  fallbackIncome: number,
  spendFixedTotal: number,
  seasonal?: FeriepengerConfig | null,
): PlanSavingsRow[] {
  return months.map((month) => {
    const estimated = seasonal ? feriepengerMonthlyNet(month, fallbackIncome, seasonal) : fallbackIncome;
    const income = monthlyIncomes[month] ?? estimated;
    const rate = income > 0 ? Math.round(((income - spendFixedTotal) / income) * 1000) / 10 : 0;
    return { month, income, rate, measured: true };
  });
}

export interface SavingsRateStatus {
  trailingRate: number;  // average savings rate over the trailing window, %
  belowTarget: boolean;  // trailing rate under the target
  shortfallPp: number;   // percentage points under target (0 when at/above)
  months: number;        // real months actually averaged
}

/**
 * Average the last `window` months' savings rate and flag when it has slipped
 * under the user's target. Months with no income (rate 0 from a blank/zero
 * income) and months with no logged spend (`measured === false`, e.g. before a
 * bank was connected) are skipped so a data gap doesn't fake a decline — or,
 * worse, fake an improvement. Returns null when there are no real months.
 */
export function savingsRateStatus(
  rows: { income: number; rate: number; measured: boolean }[],
  targetPct: number,
  window: number = 3,
): SavingsRateStatus | null {
  const recent = rows.slice(-window).filter((r) => r.income > 0 && r.measured);
  if (recent.length === 0) return null;
  const trailingRate = recent.reduce((s, r) => s + r.rate, 0) / recent.length;
  const belowTarget = trailingRate < targetPct;
  return {
    trailingRate: Math.round(trailingRate * 10) / 10,
    belowTarget,
    shortfallPp: belowTarget ? Math.round((targetPct - trailingRate) * 10) / 10 : 0,
    months: recent.length,
  };
}
