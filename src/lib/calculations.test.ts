import { describe, it, expect } from 'vitest';
import {
  calcMonthlyPayment,
  calcAmortizationSchedule,
  calcHouseEquityByYear,
  calcRecommendations,
  calcEmergencyFundStatus,
  calcDebtToIncome,
} from './calculations';

describe('calcMonthlyPayment', () => {
  it('returns 0 for a zero or negative term (no schedule)', () => {
    expect(calcMonthlyPayment(1_000_000, 5, 0)).toBe(0);
    expect(calcMonthlyPayment(1_000_000, 5, -3)).toBe(0);
  });

  it('splits principal evenly at a 0% rate', () => {
    expect(calcMonthlyPayment(120_000, 0, 10)).toBeCloseTo(120_000 / 120, 6);
  });

  it('matches the annuity formula for a known case', () => {
    // 1,000,000 @ 5% over 25 years ≈ 5,845.9 kr/mo.
    expect(calcMonthlyPayment(1_000_000, 5, 25)).toBeCloseTo(5845.9, 0);
  });
});

describe('calcAmortizationSchedule', () => {
  it('pays the loan down to (near) zero', () => {
    const s = calcAmortizationSchedule(1_000_000, 5, 25);
    expect(s[s.length - 1].balance).toBeLessThan(1);
  });

  it("payoff-year invariant: annualPayment == principal + interest for every row", () => {
    // AUDIT §3.10 — the final year has fewer than 12 payments, so annualPayment
    // must be the sum of actual payments, not monthlyPayment × 12.
    const s = calcAmortizationSchedule(1_000_000, 5, 25);
    for (const row of s) {
      expect(row.annualPayment).toBeCloseTo(row.principalPaid + row.interestPaid, 4);
    }
  });

  it('handles a 0% rate (interest columns are all zero)', () => {
    const s = calcAmortizationSchedule(120_000, 0, 10);
    expect(s.reduce((sum, r) => sum + r.interestPaid, 0)).toBeCloseTo(0, 6);
  });
});

describe('calcHouseEquityByYear', () => {
  it('grows equity as the mortgage amortizes', () => {
    const eq = calcHouseEquityByYear(5_000_000, 4_000_000, 3, 5, 25, 5);
    expect(eq[0]).toBeCloseTo(1_000_000, 6); // value - debt today
    expect(eq[5]).toBeGreaterThan(eq[0]);
  });

  it('does NOT vanish the debt when the term is 0 (AUDIT §3.11)', () => {
    // No amortization schedule (term ≤ 0) must carry the debt forward, so equity
    // doesn't jump by the full debt between year 0 and 1.
    const eq = calcHouseEquityByYear(5_000_000, 4_000_000, 0, 5, 0, 3);
    expect(eq[0]).toBeCloseTo(1_000_000, 6);
    expect(eq[1]).toBeCloseTo(1_000_000, 6); // debt still 4M, value flat
  });
});

describe('calcRecommendations', () => {
  it('returns zeros when fixed expenses exceed income', () => {
    const r = calcRecommendations(30_000, 30_000, 40_000, 0, 20);
    expect(r.recommendedSpending).toBe(0);
    expect(r.recommendedInvestment).toBe(0);
    expect(r.conservativeMode).toBe(true);
  });

  it('splits the residual by the savings target', () => {
    const r = calcRecommendations(50_000, 50_000, 30_000, 0, 20);
    expect(r.recommendedInvestment).toBe(Math.round(20_000 * 0.2));
    expect(r.recommendedSpending).toBe(Math.round(20_000 * 0.8));
  });

  it('flags conservative mode on a large income shortfall', () => {
    const r = calcRecommendations(40_000, 50_000, 20_000, 0, 20);
    expect(r.conservativeReason).toBe('shortfall');
  });

  it('flags conservative mode on high volatility', () => {
    const r = calcRecommendations(50_000, 50_000, 20_000, 0.5, 20);
    expect(r.conservativeReason).toBe('volatility');
  });
});

describe('calcEmergencyFundStatus', () => {
  it('treats zero essential expenses as strong / infinite coverage', () => {
    const r = calcEmergencyFundStatus(100_000, 0);
    expect(r.monthsCovered).toBe(Infinity);
    expect(r.status).toBe('strong');
  });

  it('classifies below/within/above the band', () => {
    expect(calcEmergencyFundStatus(20_000, 10_000).status).toBe('low');
    expect(calcEmergencyFundStatus(40_000, 10_000).status).toBe('adequate');
    expect(calcEmergencyFundStatus(70_000, 10_000).status).toBe('strong');
  });

  it('reports the shortfall to the minimum band', () => {
    expect(calcEmergencyFundStatus(20_000, 10_000).shortfallToMin).toBe(10_000);
  });
});

describe('calcDebtToIncome', () => {
  it('reports no headroom and healthy status for zero income', () => {
    const r = calcDebtToIncome(500_000, 0);
    expect(r.ratio).toBe(0);
    expect(r.borrowingHeadroom).toBe(0);
  });

  it('classifies against the 5× cap', () => {
    expect(calcDebtToIncome(2 * 600_000, 600_000).status).toBe('healthy');
    expect(calcDebtToIncome(4 * 600_000, 600_000).status).toBe('moderate');
    expect(calcDebtToIncome(6 * 600_000, 600_000).status).toBe('high');
  });

  it('computes remaining borrowing headroom', () => {
    expect(calcDebtToIncome(2_000_000, 600_000).borrowingHeadroom).toBe(5 * 600_000 - 2_000_000);
  });
});
