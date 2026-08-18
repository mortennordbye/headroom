// Trailing savings-rate health, derived from the same `monthlyCashflow` rows
// that feed SavingsRateChart. Pure + unit-tested so the Budget page can flag a
// slipping rate without re-deriving the money math in a component.
import type { FixedExpense, Saving } from '../context/FinanceContext';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';

/** Finite-and-non-negative guard against a hand-edited undefined/NaN amount. */
const amount = (n: number | undefined): number => (Number.isFinite(n) ? Math.max(0, n as number) : 0);

/**
 * What the savings list moves every month. It leaves free-to-spend like any
 * fixed expense, but it is still the user's money, so the savings rate must not
 * subtract it as if it were consumption — and the investing recommendation must
 * count it as already set aside rather than asking for it again.
 *
 * Mortgage/debt paydown is deliberately not in here: only the principal portion
 * of those builds equity and a `FixedExpense` holds the gross payment, so
 * counting them whole would overstate the rate. They stay expenses.
 */
export function savingsContributionTotal(savings: Saving[]): number {
  return savings.reduce((sum, s) => sum + amount(s.amount), 0);
}

/**
 * Income minus CONSUMPTION — the pool a savings plan is a share of, and the same
 * quantity `calcRecommendations` calls `base`. Only fixed expenses are
 * subtracted: a saving is not a cost, and taking it off would make the plan a
 * share of a pool it had already been removed from.
 */
export function savingsBase(effectiveIncome: number, fixedExpenses: FixedExpense[]): number {
  const consumption = fixedExpenses.reduce((sum, e) => sum + amount(e.amount), 0);
  return Math.max(0, (Number.isFinite(effectiveIncome) ? effectiveIncome : 0) - consumption);
}

/**
 * The share of `base` that keeps `amount` moving — the conversion behind a
 * kr → % switch. Undefined when there is no base to take a share of.
 *
 * Four decimals, not two. At a ~31 000 base a 0.01-point rounding is worth
 * ~1.6 kr, so a coarser share made switching kr → % move the amount by a krone
 * — changing a unit must never change what you save. Four decimals keeps the
 * round-trip exact to the krone for any realistic base.
 */
export function percentOfSavingsBase(amount: number, base: number): number | undefined {
  return base > 0 ? Math.round((amount / base) * 1_000_000) / 10_000 : undefined;
}

/**
 * The month's savings target in kroner: the share of the savings base the plan
 * sets aside. The same quantity `calcRecommendations` computes as `targetTotal`,
 * restated here so `resolveSavingsAmounts` can size a 'rest' row without
 * reaching for the whole recommendation.
 */
export function savingsTargetAmount(base: number, savingsTargetPercent: number): number {
  const pct = Number.isFinite(savingsTargetPercent)
    ? Math.min(100, Math.max(0, savingsTargetPercent))
    : 0;
  return Math.round((Math.max(0, base) * pct) / 100);
}

/**
 * Resolve derived savings into this month's kroner.
 *
 * A saving may be sized in one of three ways instead of a frozen `amount`:
 * 'percent' is "this share of the month's savings base", and 'rest' is
 * "whatever the other savings leave of the savings target". Both make a transfer
 * follow income: import a bigger payslip and the amount moved rises with it,
 * instead of the target rising while the transfer stays put.
 *
 * `base` is `savingsBase(income, fixedExpenses)` — passed in rather than derived
 * here, because a saving no longer lives in the expense list it is measured
 * against.
 *
 * Returns the same array (and the same row objects) when there is nothing to
 * resolve, so callers memoized on identity don't churn.
 */
export function resolveSavingsAmounts(
  savings: Saving[],
  base: number,
  savingsTargetPercent: number,
): Saving[] {
  const hasPercent = savings.some(s => isPercentSavings(s));
  const restCount = savings.reduce((n, s) => (isRestSavings(s) ? n + 1 : n), 0);
  if (!hasPercent && restCount === 0) return savings;
  const resolved = savings.map(s =>
    isPercentSavings(s)
      ? { ...s, amount: Math.round((Math.max(0, base) * (s.percent as number)) / 100) }
      : s,
  );
  if (restCount === 0) return resolved;
  // What the other savings already claim of the target — percentages resolved
  // above, fixed rows at their stated kroner. Neither depends on a 'rest' row,
  // so this can't feed back on itself.
  const claimed = resolved.reduce(
    (sum, s) => (isRestSavings(s) ? sum : sum + amount(s.amount)),
    0,
  );
  const pool = Math.max(0, savingsTargetAmount(base, savingsTargetPercent) - claimed);
  // Split evenly between the rest rows, the odd kroner to the first, so they sum
  // to exactly the pool. More than one is unusual but well-defined — two rows
  // asking for "the rest" get half each. Same rule as resolveAllocation.
  const each = Math.floor(pool / restCount);
  let extra = pool - each * restCount;
  return resolved.map(s => (isRestSavings(s) ? { ...s, amount: each + (extra-- > 0 ? 1 : 0) } : s));
}

/** A saving driven by a share of the base rather than a fixed amount. */
export function isPercentSavings(s: Saving): boolean {
  return s.mode === 'percent'
    && typeof s.percent === 'number'
    && Number.isFinite(s.percent)
    && s.percent > 0;
}

/** A saving that takes whatever the others leave of the target. */
export function isRestSavings(s: Saving): boolean {
  return s.mode === 'rest';
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
