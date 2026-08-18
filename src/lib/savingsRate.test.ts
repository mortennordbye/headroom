import { describe, it, expect } from 'vitest';
import { savingsRateStatus, savingsContributionTotal, targetRateOfIncome, planSavingsRateSeries, savingsBase, resolveSavingsAmounts, percentOfSavingsBase } from './savingsRate';
import type { MonthlyCashflowRow } from './monthlyCashflow';
import type { FixedExpense, Saving } from '../context/FinanceContext';

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

const sav = (amount: number, destinationKind: Saving['destinationKind'] = 'portfolio'): Saving =>
  ({ id: `s-${amount}-${destinationKind}`, name: 'x', amount, destinationKind });

describe('savingsContributionTotal', () => {
  it('sums every savings destination', () => {
    const total = savingsContributionTotal([
      sav(5000, 'savingsAccount'),
      sav(2000, 'bufferAccount'),
      sav(4000, 'portfolio'),
      sav(1000, 'bsu'),
    ]);
    expect(total).toBe(12000);
  });

  it('is 0 for an empty list', () => {
    expect(savingsContributionTotal([])).toBe(0);
  });

  it('ignores a NaN/undefined amount instead of poisoning the total', () => {
    const bad = { ...sav(0, 'savingsAccount'), amount: undefined as unknown as number };
    expect(savingsContributionTotal([bad, sav(5000, 'savingsAccount')])).toBe(5000);
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

// A savings transfer is not consumption. Four different screens have now shipped
// the same defect — dividing by, or bucketing against, `totalFixedExpenses`
// (which HOLDS the savings) where consumption-only was meant. These pin the
// arithmetic every one of those call sites has to do, so the next screen that
// needs "what do they actually spend" has a named, tested quantity to copy.
describe('consumption vs the raw fixed-expense total', () => {
  const bills: FixedExpense[] = [
    { id: 'a', name: 'Boliglån', amount: 18000, type: 'fixed' },
    { id: 'b', name: 'Mat', amount: 6000, type: 'variable' },
    { id: 'c', name: 'Spotify', amount: 139, type: 'subscription' },
  ];
  const savings: Saving[] = [
    { id: 'd', name: 'Aksjer og fond', amount: 13444, destinationKind: 'portfolio' },
    { id: 'e', name: 'Ferie/Gaver', amount: 500, destinationKind: 'savingsAccount', savingsAccountId: 's1' },
  ];
  const consumption = bills.reduce((n, e) => n + e.amount, 0);
  const contributions = savingsContributionTotal(savings);

  it('separates the reserved total into consumption and saving with nothing lost', () => {
    expect(contributions).toBe(13944);
    expect(consumption).toBe(24139);
    // What `totalFixedExpenses` means: everything reserved before free-to-spend.
    expect(consumption + contributions).toBe(38083);
  });

  it('a mortgage paydown counts as consumption, not saving', () => {
    // Only the principal builds equity and the expense holds the gross payment,
    // so counting it whole would overstate the rate — which is why paydown stays
    // a FixedExpense and never becomes a Saving.
    const withPaydown: FixedExpense[] = [
      ...bills,
      { id: 'f', name: 'Ekstra avdrag', amount: 2000, type: 'fixed', destinationKind: 'mortgage' },
    ];
    expect(savingsBase(55491, withPaydown)).toBe(55491 - consumption - 2000);
  });
});

describe('savingsBase / resolveSavingsAmounts', () => {
  const bill = (id: string, amount: number): FixedExpense => ({ id, name: id, amount, type: 'fixed' });
  const pctSaving = (id: string, percent: number): Saving =>
    ({ id, name: id, amount: 0, mode: 'percent', percent, destinationKind: 'portfolio' });
  const krSaving = (id: string, amount: number): Saving =>
    ({ id, name: id, amount, mode: 'amount', destinationKind: 'savingsAccount', savingsAccountId: 's1' });
  // The pool a saving is a share of, for an income and a bill list.
  const poolOf = (income: number, bills: FixedExpense[]) => savingsBase(income, bills);

  it('bases the pool on the expenses alone — savings are not subtracted', () => {
    // 55 491 − 18 000 consumption. The savings array is not part of this at all.
    expect(savingsBase(55491, [bill('rent', 18000)])).toBe(37491);
  });

  it('resolves a percentage row against that pool', () => {
    // base 30 000 → 50% → 15 000.
    const pool = poolOf(50000, [bill('rent', 20000)]);
    expect(resolveSavingsAmounts([pctSaving('fund', 50)], pool, 20)[0].amount).toBe(15000);
  });

  it('follows income up — the whole point of the feature', () => {
    const bills = [bill('rent', 20000)];
    const lean = resolveSavingsAmounts([pctSaving('fund', 50)], poolOf(50000, bills), 20)[0].amount;
    const fat = resolveSavingsAmounts([pctSaving('fund', 50)], poolOf(70000, bills), 20)[0].amount;
    expect(lean).toBe(15000);
    expect(fat).toBe(25000);
  });

  it('leaves fixed-amount savings alone', () => {
    const rows = [krSaving('buffer', 500)];
    const out = resolveSavingsAmounts(rows, poolOf(90000, [bill('rent', 20000)]), 20);
    // Same array identity: nothing to resolve, so memoized callers don't churn.
    expect(out).toBe(rows);
  });

  it('shrinks a percentage saving when the month is lean', () => {
    const pool = poolOf(21000, [bill('rent', 20000)]);
    expect(resolveSavingsAmounts([pctSaving('fund', 50)], pool, 20)[0].amount).toBe(500);
  });

  it('resolves to 0 rather than negative when consumption exceeds income', () => {
    const pool = poolOf(30000, [bill('rent', 40000)]);
    expect(resolveSavingsAmounts([pctSaving('fund', 50)], pool, 20)[0].amount).toBe(0);
  });

  it('guards a NaN or non-positive percent by keeping the stored amount', () => {
    const rows: Saving[] = [
      { id: 'a', name: 'a', amount: 700, mode: 'percent', percent: NaN, destinationKind: 'bsu' },
      { id: 'b', name: 'b', amount: 800, mode: 'percent', percent: 0, destinationKind: 'bsu' },
    ];
    const out = resolveSavingsAmounts(rows, 30000, 20);
    expect(out.map(e => e.amount)).toEqual([700, 800]);
  });

  it('feeds savingsContributionTotal the resolved amount', () => {
    const pool = poolOf(50000, [bill('rent', 20000)]);
    expect(savingsContributionTotal(resolveSavingsAmounts([pctSaving('fund', 50)], pool, 20))).toBe(15000);
  });
});

describe('resolveSavingsAmounts — rest rows', () => {
  const krSaving = (id: string, amount: number): Saving =>
    ({ id, name: id, amount, mode: 'amount', destinationKind: 'bufferAccount' });
  const pctSaving = (id: string, percent: number): Saving =>
    ({ id, name: id, amount: 0, mode: 'percent', percent, destinationKind: 'portfolio' });
  const restSaving = (id: string): Saving =>
    ({ id, name: id, amount: 0, mode: 'rest', destinationKind: 'portfolio' });

  // base 30 000 (50 000 income − 20 000 of bills), target 65 % → 19 500.
  const base = 30000;

  it('takes what the other savings leave of the target', () => {
    const rows = [krSaving('buffer', 500), restSaving('fund')];
    expect(resolveSavingsAmounts(rows, base, 65)[1].amount).toBe(19000);
  });

  it('counts a percentage sibling at its resolved amount, not its stored one', () => {
    // 10 % of 30 000 = 3 000, so the rest is 19 500 − 3 000.
    const out = resolveSavingsAmounts([pctSaving('bsu', 10), restSaving('fund')], base, 65);
    expect(out[0].amount).toBe(3000);
    expect(out[1].amount).toBe(16500);
  });

  it('follows income up, like a percentage row', () => {
    const rows = [krSaving('buffer', 500), restSaving('fund')];
    // 60 000 income − 20 000 of bills → base 40 000, target 65 % → 26 000.
    expect(resolveSavingsAmounts(rows, 40000, 65)[1].amount).toBe(25500);
  });

  it('resolves to 0 rather than negative when the target is already spoken for', () => {
    const rows = [krSaving('buffer', 25000), restSaving('fund')];
    expect(resolveSavingsAmounts(rows, base, 65)[1].amount).toBe(0);
  });

  it('splits the pool evenly between two rest rows, to the exact krone', () => {
    const out = resolveSavingsAmounts([krSaving('buffer', 501), restSaving('a'), restSaving('b')], base, 65);
    // 19 500 − 501 = 18 999 → 9 500 / 9 499, summing exactly.
    expect(out[1].amount + out[2].amount).toBe(18999);
    expect(out[1].amount).toBe(9500);
  });

  it('lets rest win over a stale percentage on the same row', () => {
    const rows: Saving[] = [
      { id: 'f', name: 'f', amount: 0, mode: 'rest', percent: 10, destinationKind: 'portfolio' },
    ];
    expect(resolveSavingsAmounts(rows, base, 65)[0].amount).toBe(19500);
  });
});

describe('kr ⇄ % round-trip', () => {
  // The panel converts a fixed amount into a share of the base when you flip a
  // row to %. Switching a unit must not move the money, so the share has to
  // carry enough precision to resolve back to the same krone.
  const shareOfBase = (amount: number, base: number) => percentOfSavingsBase(amount, base);

  it('returns the same kroner after kr → % → kr', () => {
    for (const base of [31_491, 23_750, 51_491, 9_806, 7]) {
      for (const amount of [500, 1, 13_444, 6_270, Math.floor(base / 3)]) {
        if (amount > base) continue;
        const pct = shareOfBase(amount, base);
        const rows: Saving[] = [
          { id: 's', name: 's', amount: 0, mode: 'percent', percent: pct, destinationKind: 'portfolio' },
        ];
        expect(resolveSavingsAmounts(rows, base, 20)[0].amount).toBe(amount);
      }
    }
  });
});
