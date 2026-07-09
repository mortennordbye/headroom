import { describe, it, expect } from 'vitest';
import { paydownVsPlan } from './paydown';
import { calcMonthlyPayment } from './calculations';
import type { BalanceSnapshot } from '../context/FinanceContext';

// Minimal homeowner snapshot carrying just the mortgage fields paydown reads.
const mk = (mortgage: number, rente = 5, term = 25): BalanceSnapshot => ({
  housingMode: 'homeowner',
  homeowner: { currentMortgageBalance: mortgage, rente, nedbetalingstid: term },
  assets: { houseDebt: mortgage },
} as unknown as BalanceSnapshot);

describe('paydownVsPlan', () => {
  it('returns empty when no month has a mortgage', () => {
    const r = paydownVsPlan({ '2026-01': mk(0) });
    expect(r.anchorMonth).toBeNull();
    expect(r.points).toEqual([]);
  });

  it('anchors at the first month with a mortgage and tracks plan vs actual', () => {
    const r = paydownVsPlan({ '2026-01': mk(2_000_000), '2026-02': mk(1_990_000) });
    expect(r.anchorMonth).toBe('2026-01');
    expect(r.points).toHaveLength(2);
    expect(r.points[0].plan).toBe(2_000_000); // k=0 → anchor balance
    expect(r.points[0].actual).toBe(2_000_000);
    expect(r.monthlyPayment).toBeCloseTo(calcMonthlyPayment(2_000_000, 5, 25), 2);
  });

  it('reports "ahead" when the actual balance is below plan', () => {
    // One month in: plan pays down the scheduled amount; actual pays down more.
    const planned = paydownVsPlan({ '2026-01': mk(2_000_000), '2026-02': mk(2_000_000) });
    const planMonth2 = planned.points[1].plan; // where the plan expects the balance
    const r = paydownVsPlan({ '2026-01': mk(2_000_000), '2026-02': mk(planMonth2 - 5_000) });
    expect(r.aheadBy).toBeCloseTo(5_000, 0);
    expect(r.monthsAhead).toBeGreaterThan(0);
    expect(r.principalPaid).toBeCloseTo(2_000_000 - (planMonth2 - 5_000), 0);
  });

  it('reports "behind" (negative) when the actual balance is above plan', () => {
    const planned = paydownVsPlan({ '2026-01': mk(2_000_000), '2026-02': mk(2_000_000) });
    const planMonth2 = planned.points[1].plan;
    const r = paydownVsPlan({ '2026-01': mk(2_000_000), '2026-02': mk(planMonth2 + 8_000) });
    expect(r.aheadBy).toBeCloseTo(-8_000, 0);
    expect(r.monthsAhead).toBeLessThan(0);
  });

  it('does not divide by zero on a single-snapshot / interest-free mortgage', () => {
    const r = paydownVsPlan({ '2026-01': mk(1_000_000, 0, 20) });
    expect(r.points).toHaveLength(1);
    expect(Number.isFinite(r.interestPaid)).toBe(true);
    expect(r.interestPaid).toBe(0); // no month gaps, no interest accrued yet
    expect(Number.isFinite(r.monthsAhead)).toBe(true);
  });

  it('estimates interest paid across a month gap without NaN', () => {
    const r = paydownVsPlan({ '2026-01': mk(2_400_000), '2026-04': mk(2_370_000) });
    expect(r.interestPaid).toBeGreaterThan(0);
    expect(Number.isFinite(r.interestPaid)).toBe(true);
  });

  it('guards a NaN rate / balance from a hand-edited snapshot (no NaN in the plan)', () => {
    const bad = { housingMode: 'homeowner', homeowner: { currentMortgageBalance: 2_000_000, rente: NaN, nedbetalingstid: 25 }, assets: { houseDebt: 2_000_000 } } as unknown as BalanceSnapshot;
    const next = { housingMode: 'homeowner', homeowner: { currentMortgageBalance: NaN, rente: 5, nedbetalingstid: 25 }, assets: { houseDebt: 1_990_000 } } as unknown as BalanceSnapshot;
    const r = paydownVsPlan({ '2026-01': bad, '2026-02': next });
    expect(r.points.every(p => Number.isFinite(p.plan) && Number.isFinite(p.actual))).toBe(true);
    expect(Number.isFinite(r.aheadBy) && Number.isFinite(r.interestPaid)).toBe(true);
  });
});
