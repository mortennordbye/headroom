import { describe, it, expect } from 'vitest';
import { savingsRateStatus, savingsContributionTotal, targetRateOfIncome, planSavingsRateSeries } from './savingsRate';
import type { MonthlyCashflowRow } from './monthlyCashflow';
import type { FixedExpense } from '../context/FinanceContext';

const row = (month: string, income: number, rate: number, measured = true): MonthlyCashflowRow => ({
  month, income, variable: 0, expenses: 0, net: 0, rate, measured,
});

describe('savingsRateStatus', () => {
  it('flags a trailing average under the target', () => {
    const rows = [row('2026-01', 50000, 30), row('2026-02', 50000, 10), row('2026-03', 50000, 8)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.trailingRate).toBeCloseTo(16, 5); // (30+10+8)/3
    expect(s.belowTarget).toBe(true);
    expect(s.shortfallPp).toBeCloseTo(4, 5);
    expect(s.months).toBe(3);
  });

  it('does not flag when the trailing average meets the target', () => {
    const rows = [row('2026-01', 50000, 22), row('2026-02', 50000, 25), row('2026-03', 50000, 20)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.belowTarget).toBe(false);
    expect(s.shortfallPp).toBe(0);
  });

  it('skips months with no income so a data gap does not fake a decline', () => {
    // Only the last real month counts; the zero-income month is ignored.
    const rows = [row('2026-01', 0, 0), row('2026-02', 0, 0), row('2026-03', 50000, 25)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.months).toBe(1);
    expect(s.trailingRate).toBeCloseTo(25, 5);
    expect(s.belowTarget).toBe(false);
  });

  it('skips unmeasured months so a pre-bank-sync gap does not fake a high rate', () => {
    // The two 55% months have no logged spend — they only look good because
    // nothing was recorded. Only the measured month should count.
    const rows = [row('2026-01', 50000, 55, false), row('2026-02', 50000, 55, false), row('2026-03', 50000, 10)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.months).toBe(1);
    expect(s.trailingRate).toBeCloseTo(10, 5);
    expect(s.belowTarget).toBe(true);
  });

  it('returns null when there are no real months in the window', () => {
    const rows = [row('2026-02', 0, 0), row('2026-03', 0, 0)];
    expect(savingsRateStatus(rows, 20)).toBeNull();
  });

  it('honours a custom window length', () => {
    const rows = [row('2026-01', 50000, 40), row('2026-02', 50000, 10), row('2026-03', 50000, 10)];
    // window 2 → average of the last two months (10, 10)
    expect(savingsRateStatus(rows, 20, 2)!.trailingRate).toBeCloseTo(10, 5);
  });
});

const fixed = (amount: number, destinationKind?: FixedExpense['destinationKind']): FixedExpense =>
  ({ id: `f-${amount}-${destinationKind ?? 'none'}`, name: 'x', amount, type: 'fixed', destinationKind });

describe('savingsContributionTotal', () => {
  it('counts savings and buffer destinations, not ordinary expenses', () => {
    const total = savingsContributionTotal([
      fixed(12000),                     // rent
      fixed(5000, 'savingsAccount'),
      fixed(2000, 'bufferAccount'),
    ]);
    expect(total).toBe(7000);
  });

  it('excludes mortgage and debt destinations (gross payment, not principal)', () => {
    expect(savingsContributionTotal([fixed(9000, 'mortgage'), fixed(3000, 'debt')])).toBe(0);
  });

  it('is 0 for an empty list', () => {
    expect(savingsContributionTotal([])).toBe(0);
  });

  it('ignores a NaN/undefined amount instead of poisoning the total', () => {
    const bad = { ...fixed(0, 'savingsAccount'), amount: undefined as unknown as number };
    expect(savingsContributionTotal([bad, fixed(5000, 'savingsAccount')])).toBe(5000);
  });
});

describe('targetRateOfIncome', () => {
  it('restates a residual-share target as a share of income', () => {
    // income 50k, fixed 30k → residual 20k; 20% of residual = 4k retained = 8% of income.
    expect(targetRateOfIncome(50000, 30000, 0, 20)).toBeCloseTo(8, 5);
  });

  it('adds automated contributions on top of the residual share', () => {
    // Of the 30k fixed, 5k is a savings transfer. Retained = 5k + 20% × 20k = 9k = 18%.
    expect(targetRateOfIncome(50000, 30000, 5000, 20)).toBeCloseTo(18, 5);
  });

  it('matches the achievable rate when the user follows the plan exactly', () => {
    // Same inputs as above: spend the recommended 80% of residual (16k) and the
    // rate from monthlyCashflow is (50k − 25k spend-fixed − 16k)/50k = 18%.
    const income = 50000, totalFixed = 30000, contributions = 5000;
    const spendFixed = totalFixed - contributions;
    const variable = (income - totalFixed) * 0.8;
    const actual = ((income - spendFixed - variable) / income) * 100;
    expect(actual).toBeCloseTo(targetRateOfIncome(income, totalFixed, contributions, 20), 5);
  });

  it('clamps a negative residual instead of lowering the target below contributions', () => {
    // Fixed expenses exceed income → residual share is 0, contributions still count.
    expect(targetRateOfIncome(50000, 60000, 5000, 20)).toBeCloseTo(10, 5);
  });

  it('returns 0 for a month with no income', () => {
    expect(targetRateOfIncome(0, 30000, 5000, 20)).toBe(0);
  });
});

describe('planSavingsRateSeries', () => {
  it('is the share of income left after the consumption fixed expenses', () => {
    const rows = planSavingsRateSeries(['2026-06', '2026-07'], {}, 50000, 30000);
    // (50000 − 30000) / 50000 = 40%
    expect(rows.map((r) => r.rate)).toEqual([40, 40]);
    expect(rows.map((r) => r.income)).toEqual([50000, 50000]);
  });

  it('uses a manual monthly income override when present', () => {
    const rows = planSavingsRateSeries(['2026-06', '2026-07'], { '2026-07': 80000 }, 50000, 40000);
    expect(rows[0].rate).toBe(20);  // (50000 − 40000) / 50000
    expect(rows[1].rate).toBe(50);  // (80000 − 40000) / 80000
  });

  // The whole point of the plan series: it must not vary with transactions, and
  // it must have a value for every month (no "unmeasured" gaps to blank out).
  it('marks every month measured, so no month is blanked from the chart', () => {
    const rows = planSavingsRateSeries(['2026-01', '2026-02', '2026-03'], {}, 50000, 10000);
    expect(rows.every((r) => r.measured)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('returns 0 rather than dividing by zero when income is absent', () => {
    expect(planSavingsRateSeries(['2026-07'], {}, 0, 10000)[0].rate).toBe(0);
  });

  it('goes negative when fixed expenses exceed income', () => {
    expect(planSavingsRateSeries(['2026-07'], {}, 20000, 30000)[0].rate).toBe(-50);
  });
});
