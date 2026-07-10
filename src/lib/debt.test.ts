import { describe, it, expect } from 'vitest';
import { amortize, planPayoff, formatMonths, sumDebtByType, calcDebtBalanceByYear, debtPaydownVsPlan, extraPaymentSavings } from './debt';
import { calcMonthlyPayment } from './calculations';
import type { Debt, BalanceSnapshot } from '../context/FinanceContext';

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: 'd1',
  name: 'Debt',
  type: 'consumer',
  balance: 100_000,
  rate: 10,
  minPayment: 3_000,
  ...over,
});

describe('amortize', () => {
  it('is instantly clear for a zero balance', () => {
    const r = amortize(0, 10, 1_000);
    expect(r.months).toBe(0);
    expect(r.feasible).toBe(true);
  });

  it('is infeasible when the payment cannot cover the first month of interest', () => {
    // 100k @ 12% ⇒ 1000 kr/mo interest; a 1000 kr payment never reduces principal.
    const r = amortize(100_000, 12, 1_000);
    expect(r.feasible).toBe(false);
    expect(r.months).toBe(Infinity);
  });

  it('pays off a feasible debt in finite time', () => {
    const r = amortize(100_000, 10, 3_000);
    expect(r.feasible).toBe(true);
    expect(r.months).toBeGreaterThan(0);
    expect(Number.isFinite(r.months)).toBe(true);
    expect(r.totalInterest).toBeGreaterThan(0);
  });

  it('reports Infinity (like planPayoff), not the cap, when payoff exceeds 50 years', () => {
    // 100k @ 12% ⇒ 1000 kr/mo interest; 1001 kr/mo shrinks the balance but
    // needs ~694 months — past the MAX_MONTHS cap.
    const r = amortize(100_000, 12, 1_001);
    expect(r.feasible).toBe(false);
    expect(r.months).toBe(Infinity);
    expect(r.totalInterest).toBe(Infinity);
  });
});

describe('planPayoff', () => {
  it('clears all debts and returns finite months when feasible', () => {
    const plan = planPayoff([debt({ id: 'a' }), debt({ id: 'b', balance: 50_000, rate: 20 })], 5_000, 'avalanche');
    expect(plan.feasible).toBe(true);
    expect(Number.isFinite(plan.months)).toBe(true);
    expect(plan.perDebt).toHaveLength(2);
  });

  it('returns Infinity months when the budget cannot outrun interest (AUDIT §3.12)', () => {
    // High balances + high rate + tiny minimums and no extra ⇒ never pays off;
    // must report Infinity, not the 600-month cap.
    const plan = planPayoff(
      [debt({ id: 'a', balance: 500_000, rate: 25, minPayment: 100 })],
      0,
      'avalanche',
    );
    expect(plan.feasible).toBe(false);
    expect(plan.months).toBe(Infinity);
  });

  it('avalanche pays no more interest than snowball', () => {
    // Classic invariant: prioritising the highest rate minimises total interest.
    const debts = [
      debt({ id: 'small-high', balance: 20_000, rate: 24, minPayment: 500 }),
      debt({ id: 'big-low', balance: 200_000, rate: 6, minPayment: 2_000 }),
    ];
    const avalanche = planPayoff(debts, 4_000, 'avalanche');
    const snowball = planPayoff(debts, 4_000, 'snowball');
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest + 1e-6);
  });

  it('handles an empty debt list', () => {
    const plan = planPayoff([], 1_000, 'avalanche');
    expect(plan.months).toBe(0);
    expect(plan.feasible).toBe(true);
  });

  it('excludes revolving debts (credit cards paid in full) from the payoff plan', () => {
    const amortizing = debt({ id: 'loan', balance: 60_000, rate: 10, minPayment: 3_000 });
    const revolving = debt({ id: 'card', balance: 25_000, rate: 0, minPayment: 0, revolving: true });
    const withCard = planPayoff([amortizing, revolving], 0, 'avalanche');
    const withoutCard = planPayoff([amortizing], 0, 'avalanche');
    // The revolving card is ignored: same payoff months and interest as if absent,
    // and its balance never appears in the amortizing series.
    expect(withCard.months).toBe(withoutCard.months);
    expect(withCard.totalInterest).toBeCloseTo(withoutCard.totalInterest, 5);
    expect(withCard.balanceSeries[0].total).toBe(60_000);
    expect(withCard.perDebt.some(p => p.id === 'card')).toBe(false);
  });
});

describe('formatMonths', () => {
  it('formats an infinite payoff as never/aldri', () => {
    expect(formatMonths(Infinity, 'en')).toBe('never');
    expect(formatMonths(Infinity, 'nb')).toBe('aldri');
  });

  it('formats zero as paid off', () => {
    expect(formatMonths(0, 'en')).toBe('paid off');
    expect(formatMonths(0, 'nb')).toBe('nedbetalt');
  });

  it('formats years and months', () => {
    expect(formatMonths(14, 'en')).toBe('1 yr 2 mo');
    expect(formatMonths(24, 'nb')).toBe('2 år');
    expect(formatMonths(5, 'nb')).toBe('5 mnd');
  });
});

describe('calcDebtBalanceByYear', () => {
  it('returns years+1 zeros for no debts', () => {
    expect(calcDebtBalanceByYear([], 3)).toEqual([0, 0, 0, 0]);
  });

  it('pays an interest-free debt down at its minimum and stays at zero', () => {
    // 12 000 @ 0% with 1 000/mo clears in exactly 12 months.
    const d = debt({ balance: 12_000, rate: 0, minPayment: 1_000 });
    expect(calcDebtBalanceByYear([d], 3)).toEqual([12_000, 0, 0, 0]);
  });

  it('declines monotonically for an amortizing debt until paid off', () => {
    const out = calcDebtBalanceByYear([debt()], 5); // 100k @ 10%, 3k/mo ≈ 3.2 yrs
    expect(out[0]).toBe(100_000);
    for (let y = 1; y < out.length; y++) expect(out[y]).toBeLessThanOrEqual(out[y - 1]);
    expect(out[5]).toBe(0);
  });

  it('carries revolving balances flat forever', () => {
    const card = debt({ balance: 18_000, rate: 0, minPayment: 0, revolving: true });
    expect(calcDebtBalanceByYear([card], 2)).toEqual([18_000, 18_000, 18_000]);
    // Mixed: the amortizing part clears, the revolving floor remains.
    const out = calcDebtBalanceByYear([card, debt({ balance: 12_000, rate: 0, minPayment: 1_000 })], 2);
    expect(out).toEqual([30_000, 18_000, 18_000]);
  });

  it('carries an infeasible debt at its starting balance instead of growing without bound', () => {
    const d = debt({ balance: 500_000, rate: 25, minPayment: 100 });
    expect(calcDebtBalanceByYear([d], 2)).toEqual([500_000, 500_000, 500_000]);
  });
});

describe('sumDebtByType', () => {
  it('sums only the balances of the given type, ignoring negatives', () => {
    const debts = [
      debt({ id: 'a', type: 'student', balance: 300_000 }),
      debt({ id: 'b', type: 'student', balance: 50_000 }),
      debt({ id: 'c', type: 'consumer', balance: 80_000 }),
      debt({ id: 'd', type: 'credit_card', balance: -10 }),
    ];
    expect(sumDebtByType(debts, 'student')).toBe(350_000);
    expect(sumDebtByType(debts, 'consumer')).toBe(80_000);
    expect(sumDebtByType(debts, 'credit_card')).toBe(0);
    expect(sumDebtByType([], 'student')).toBe(0);
  });
});

describe('debtPaydownVsPlan', () => {
  const snap = (debts: Debt[]): BalanceSnapshot => ({ debts } as unknown as BalanceSnapshot);

  it('returns empty when no month has non-revolving debt', () => {
    const r = debtPaydownVsPlan({ '2026-01': snap([debt({ balance: 0 })]) });
    expect(r.anchorMonth).toBeNull();
    expect(r.points).toEqual([]);
  });

  it('anchors at the first month with debt and tracks plan vs actual', () => {
    const r = debtPaydownVsPlan({
      '2026-01': snap([debt({ balance: 100_000 })]),
      '2026-02': snap([debt({ balance: 96_500 })]),
    });
    expect(r.anchorMonth).toBe('2026-01');
    expect(r.points).toHaveLength(2);
    expect(r.points[0].plan).toBe(100_000); // k=0 → anchor total
    expect(r.points[0].actual).toBe(100_000);
    expect(r.principalPaid).toBe(100_000 - 96_500);
  });

  it('reports ahead when the actual balance is below the minimums-only plan', () => {
    const planned = debtPaydownVsPlan({
      '2026-01': snap([debt({ balance: 100_000 })]),
      '2026-02': snap([debt({ balance: 100_000 })]),
    });
    const planMonth2 = planned.points[1].plan;
    const r = debtPaydownVsPlan({
      '2026-01': snap([debt({ balance: 100_000 })]),
      '2026-02': snap([debt({ balance: planMonth2 - 4_000 })]),
    });
    expect(r.aheadBy).toBeCloseTo(4_000, 0);
  });

  it('excludes revolving cards and guards a NaN balance', () => {
    const r = debtPaydownVsPlan({
      '2026-01': snap([debt({ id: 'a', balance: 50_000 }), debt({ id: 'r', balance: 20_000, revolving: true })]),
      '2026-02': snap([debt({ id: 'a', balance: NaN }), debt({ id: 'r', balance: 20_000, revolving: true })]),
    });
    expect(r.points[0].actual).toBe(50_000); // revolving excluded
    expect(r.points.every(p => Number.isFinite(p.actual) && Number.isFinite(p.plan))).toBe(true);
  });
});

describe('extraPaymentSavings', () => {
  const balance = 3_000_000;
  const rate = 5.5;
  const term = 25;
  const basePayment = calcMonthlyPayment(balance, rate, term);

  it('is a no-op when the extra is zero', () => {
    const r = extraPaymentSavings(balance, rate, basePayment, 0);
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSaved).toBeCloseTo(0, 0);
    expect(r.feasible).toBe(true);
  });

  it('shortens the term and cuts interest with a positive extra', () => {
    const r = extraPaymentSavings(balance, rate, basePayment, 3_000);
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.extraMonths).toBeLessThan(r.baseMonths);
    expect(r.interestSaved).toBeGreaterThan(0);
    expect(r.extraInterest).toBeLessThan(r.baseInterest);
  });

  it('clamps a negative extra to zero', () => {
    const r = extraPaymentSavings(balance, rate, basePayment, -5_000);
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSaved).toBeCloseTo(0, 0);
  });

  it('reports infeasible when the base payment cannot outrun interest', () => {
    // A trivially small payment never amortizes → not feasible, no negative savings.
    const r = extraPaymentSavings(balance, rate, 100, 0);
    expect(r.feasible).toBe(false);
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSaved).toBe(0);
  });
});
