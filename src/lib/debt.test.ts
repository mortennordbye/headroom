import { describe, it, expect } from 'vitest';
import { amortize, planPayoff, formatMonths } from './debt';
import type { Debt } from '../context/FinanceContext';

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
