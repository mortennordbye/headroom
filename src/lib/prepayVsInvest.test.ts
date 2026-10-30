import { describe, it, expect } from 'vitest';
import { prepayVsInvest, prepayVsInvestFor } from './prepayVsInvest';

describe('prepayVsInvestFor', () => {
  const settings = {
    mortgage: { amortises: true, ratePct: 5 },
    loanRatePct: 6,
    region: 'no',
    customTaxRatePct: 30,
    investGainsTaxPct: 37.84,
  };

  it('taxes the investment gain once, at the horizon', () => {
    const r = prepayVsInvestFor(settings, 5000, 7, 15);
    expect(r.investReturnPct).toBe(7);
    expect(r.afterTaxMortgageRatePct).toBeCloseTo(3.9, 6);
  });

  it('compounds the investment gross and beats a 5.65 % mortgage', () => {
    // 5,000/month for 15 y at 7 %: 1,584,811 gross on 900,000 paid in, so the
    // 684,811 gain is taxed 37.84 % on sale. Taxing the return yearly gave
    // 1,266,431, losing to prepaying (1,272,268).
    const r = prepayVsInvestFor({ ...settings, mortgage: { amortises: true, ratePct: 5.65 } }, 5000, 7, 15);
    expect(r.investFutureValue).toBeCloseTo(1_325_679, 0);
    expect(r.investGainsTax).toBeCloseTo((r.investFutureValue + r.investGainsTax - 900_000) * 0.3784, 6);
    expect(r.winner).toBe('invest');
  });

  it('reports the deduction rate it used', () => {
    expect(prepayVsInvestFor(settings, 5000, 7, 15).interestDeductionRatePct).toBe(22);
    expect(prepayVsInvestFor({ ...settings, region: 'generic' }, 5000, 7, 15).interestDeductionRatePct).toBe(30);
  });

  it('uses the current loan in the owner modes and the planned loan for a first buyer', () => {
    expect(prepayVsInvestFor(settings, 5000, 7, 15).afterTaxMortgageRatePct).toBeCloseTo(5 * 0.78, 6);
    expect(prepayVsInvestFor({ ...settings, mortgage: { amortises: false, ratePct: 0 } }, 5000, 7, 15).afterTaxMortgageRatePct)
      .toBeCloseTo(6 * 0.78, 6);
  });

  it('uses the flat rate as the deduction in generic mode', () => {
    const r = prepayVsInvestFor({ ...settings, region: 'generic' }, 5000, 7, 15);
    expect(r.afterTaxMortgageRatePct).toBeCloseTo(5 * 0.7, 6);
  });
});

describe('prepayVsInvest', () => {
  it('applies the interest deduction to the mortgage rate', () => {
    const r = prepayVsInvest(5000, 5, 7, 10, 22);
    // 5% mortgage after a 22% deduction is really 3.9%.
    expect(r.afterTaxMortgageRatePct).toBeCloseTo(3.9, 5);
    // No gains tax passed → nothing is taken from the investment.
    expect(r.investGainsTax).toBe(0);
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
    const untaxed = prepayVsInvest(5000, 5, 8, 10, 22);
    const r = prepayVsInvest(5000, 5, 8, 10, 22, 37.84);
    // Only the gain is taxed, once: the contributions come back in full.
    expect(r.investGainsTax).toBeCloseTo(untaxed.investGain * 0.3784, 5);
    expect(r.investFutureValue).toBeCloseTo(r.contributions + untaxed.investGain * (1 - 0.3784), 5);
  });
});
