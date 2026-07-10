import { describe, it, expect } from 'vitest';
import { prepayVsInvest } from './prepayVsInvest';

describe('prepayVsInvest', () => {
  it('applies the interest deduction to the mortgage rate', () => {
    const r = prepayVsInvest(5000, 5, 7, 10, 22);
    // 5% mortgage after a 22% deduction is really 3.9%.
    expect(r.afterTaxMortgageRatePct).toBeCloseTo(3.9, 5);
    // No gains tax passed → expected return is untouched.
    expect(r.afterTaxReturnPct).toBeCloseTo(7, 5);
  });

  it('picks invest when the expected return beats the after-tax mortgage rate', () => {
    const r = prepayVsInvest(5000, 5, 7, 15, 22);
    expect(r.winner).toBe('invest');
    expect(r.investFutureValue).toBeGreaterThan(r.prepayFutureValue);
    expect(r.advantage).toBeCloseTo(r.investFutureValue - r.prepayFutureValue, 5);
  });

  it('picks prepay when the after-tax mortgage rate beats the return', () => {
    // 6% mortgage after tax = 4.68%, higher than a 3% expected return.
    const r = prepayVsInvest(5000, 6, 3, 15, 22);
    expect(r.winner).toBe('prepay');
    expect(r.prepayFutureValue).toBeGreaterThan(r.investFutureValue);
  });

  it('reports a tie when the two after-tax rates match', () => {
    // 5% mortgage after 22% = 3.9%; a 3.9% return matches it exactly.
    const r = prepayVsInvest(5000, 5, 3.9, 20, 22);
    expect(r.winner).toBe('tie');
  });

  it('future value with 0% equals plain contributions', () => {
    const r = prepayVsInvest(1000, 0, 0, 5);
    expect(r.months).toBe(60);
    expect(r.contributions).toBe(60000);
    expect(r.prepayFutureValue).toBeCloseTo(60000, 5);
    expect(r.investFutureValue).toBeCloseTo(60000, 5);
    expect(r.prepayGain).toBeCloseTo(0, 5);
  });

  it('clamps a negative extra to zero', () => {
    const r = prepayVsInvest(-200, 5, 7, 10);
    expect(r.extraMonthly).toBe(0);
    expect(r.contributions).toBe(0);
    expect(r.prepayFutureValue).toBe(0);
  });

  it('applies a gains tax to the investment leg when given', () => {
    const r = prepayVsInvest(5000, 5, 8, 10, 22, 37.84);
    // 8% taxed at 37.84% ≈ 4.97% after tax.
    expect(r.afterTaxReturnPct).toBeCloseTo(8 * (1 - 0.3784), 5);
  });
});
