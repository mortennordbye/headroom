import { describe, it, expect } from 'vitest';
import {
  calcMonthlyPayment,
  calcAmortizationSchedule,
  calcHouseEquityByYear,
  calcMortgageBalanceByYear,
  calcRecommendations,
  calcEmergencyFundStatus,
  calcDebtToIncome,
  calcBorrowingCapacity,
  calcNetSaleProceeds,
  calcBridgeLoanCost,
  calcHomeownerMortgageStatus,
  calcNetWorthProjectionByBucket,
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

describe('calcMortgageBalanceByYear', () => {
  it('starts at the current debt and amortizes to 0 by the end of the term', () => {
    const b = calcMortgageBalanceByYear(1_000_000, 5, 10, 15);
    expect(b).toHaveLength(16); // years 0..15 inclusive
    expect(b[0]).toBe(1_000_000);
    expect(b[10]).toBe(0);
    expect(b[15]).toBe(0);
  });

  it('is monotonically non-increasing', () => {
    const b = calcMortgageBalanceByYear(2_500_000, 4.5, 25, 15);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]).toBeLessThanOrEqual(b[i - 1]);
    }
  });

  it('carries the debt flat when there is no amortizing term', () => {
    const b = calcMortgageBalanceByYear(500_000, 5, 0, 5);
    expect(b).toEqual([500_000, 500_000, 500_000, 500_000, 500_000, 500_000]);
  });

  it('is all zeros when there is no debt', () => {
    expect(calcMortgageBalanceByYear(0, 5, 20, 4)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('calcBorrowingCapacity', () => {
  it('is income-bound when equity is ample', () => {
    // income 600k → maxDebt 3.0M; equity 2M → LTV cap = 2M/0.15 = 13.3M.
    // Income cap (3M+2M=5M) is lower, so it binds.
    const c = calcBorrowingCapacity(600_000, 2_000_000, 0, 5, 25);
    expect(c.maxDebt).toBe(3_000_000);
    expect(c.maxPrice).toBe(5_000_000);
    expect(c.ltvBound).toBe(false);
    expect(c.debtAtMaxPrice).toBe(3_000_000);
  });

  it('is LTV-bound when equity is thin relative to income', () => {
    // income 1.2M → maxDebt 6M; equity 400k → LTV cap = 400k/0.15 ≈ 2.67M,
    // far below the income cap (6.4M), so the 15%-equity rule binds.
    const c = calcBorrowingCapacity(1_200_000, 400_000, 0, 5, 25);
    expect(c.ltvBound).toBe(true);
    expect(c.maxPrice).toBeCloseTo(400_000 / 0.15, 4);
    // debt at the LTV cap is price − equity, i.e. 85% of price
    expect(c.debtAtMaxPrice).toBeCloseTo(c.maxPrice - 400_000, 4);
  });

  it('subtracts existing debt from the 5× income headroom', () => {
    const c = calcBorrowingCapacity(600_000, 2_000_000, 500_000, 5, 25);
    expect(c.maxDebt).toBe(2_500_000); // 3.0M − 0.5M
  });

  it('stress-tests the payment at +3pp', () => {
    const c = calcBorrowingCapacity(600_000, 2_000_000, 0, 5, 25);
    expect(c.stressRatePct).toBe(8);
    expect(c.stressedMonthlyPayment).toBeCloseTo(calcMonthlyPayment(c.debtAtMaxPrice, 8, 25), 6);
  });

  it('never returns negative capacity when debt swamps income', () => {
    const c = calcBorrowingCapacity(300_000, 0, 5_000_000, 5, 25);
    expect(c.maxDebt).toBe(0);
    expect(c.maxPrice).toBe(0);
    expect(c.stressedMonthlyPayment).toBe(0);
  });
});

describe('calcNetSaleProceeds', () => {
  it('nets out mortgage, agent fee and fixed costs', () => {
    const r = calcNetSaleProceeds(4_200_000, 2_950_000, 3, 7_500, 10_000);
    expect(r.agentCost).toBe(126_000);
    expect(r.netProceeds).toBe(4_200_000 - 2_950_000 - 126_000 - 7_500 - 10_000);
  });

  it('goes negative when the mortgage exceeds the sale price (no silent clamp)', () => {
    const r = calcNetSaleProceeds(2_000_000, 2_500_000, 0, 0, 0);
    expect(r.netProceeds).toBe(-500_000);
  });
});

describe('calcBridgeLoanCost', () => {
  it('charges simple monthly interest on the bridged amount', () => {
    // 1 000 000 at 6%/yr for 2 months = 1 000 000 × 0.005 × 2.
    expect(calcBridgeLoanCost(1_000_000, 6, 2)).toBeCloseTo(10_000, 6);
  });

  it('is zero with no months or no amount', () => {
    expect(calcBridgeLoanCost(1_000_000, 6, 0)).toBe(0);
    expect(calcBridgeLoanCost(0, 6, 2)).toBe(0);
  });
});

describe('calcHomeownerMortgageStatus', () => {
  it('splits the payment into interest and principal that sum back exactly', () => {
    const s = calcHomeownerMortgageStatus(2_000_000, 2_500_000, 5, 20, 22);
    expect(s.monthlyInterest).toBeCloseTo(2_000_000 * 0.05 / 12, 6);
    expect(s.monthlyInterest + s.monthlyPrincipal).toBeCloseTo(s.monthlyPaymentCalc, 6);
    // "equityPercent" is actually % of original loan repaid (see 5.7 rename note).
    expect(s.equityPercent).toBeCloseTo(20, 6);
  });

  it('bases the tax deduction on year-one amortized interest, below the flat ×12 figure', () => {
    const s = calcHomeownerMortgageStatus(2_000_000, 2_500_000, 5, 20, 22);
    const flatTwelve = s.monthlyInterest * 12 * 0.22;
    expect(s.annualTaxDeduction).toBeGreaterThan(0);
    expect(s.annualTaxDeduction).toBeLessThan(flatTwelve);
  });

  it('falls back to flat ×12 interest when there is no amortization schedule', () => {
    // yearsRemaining 0 → no schedule → monthlyInterest × 12 × sats.
    const s = calcHomeownerMortgageStatus(2_000_000, 2_500_000, 5, 0, 22);
    expect(s.annualTaxDeduction).toBeCloseTo(2_000_000 * 0.05 * 0.22, 6);
  });

  it('clamps repaid share to 0 and handles a zero original loan', () => {
    expect(calcHomeownerMortgageStatus(2_600_000, 2_500_000, 5, 20, 22).equityPercent).toBe(0);
    expect(calcHomeownerMortgageStatus(2_000_000, 0, 5, 20, 22).equityPercent).toBe(0);
  });
});

describe('calcNetWorthProjectionByBucket', () => {
  const start = { stocks: 100_000, crypto: 50_000, cash: 20_000, house: 1_000_000 };
  const rates = { stocks: 10, crypto: 0, cash: 0, house: 2 };

  it('starts at the given amounts and returns years+1 points', () => {
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 5);
    expect(p).toHaveLength(6);
    expect(p[0]).toMatchObject({ stocks: 100_000, crypto: 50_000, cash: 20_000, house: 1_000_000 });
    expect(p[0].total).toBe(1_170_000);
  });

  it('accrues annual savings into the stocks bucket only', () => {
    const flat = { stocks: 0, crypto: 0, cash: 0, house: 0 };
    const zero = { stocks: 0, crypto: 0, cash: 0, house: 0 };
    const p = calcNetWorthProjectionByBucket(flat, 12_000, zero, 3);
    expect(p.map(pt => pt.stocks)).toEqual([0, 12_000, 24_000, 36_000]);
    expect(p.every(pt => pt.crypto === 0 && pt.cash === 0 && pt.house === 0)).toBe(true);
  });

  it('compounds each bucket at its own rate', () => {
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 2);
    expect(p[1].stocks).toBe(110_000);
    expect(p[2].stocks).toBe(121_000);
    expect(p[1].crypto).toBe(50_000); // 0% rate
    expect(p[1].house).toBe(1_020_000);
  });

  it('uses houseByYear verbatim when provided (appreciation + paydown model)', () => {
    const houseByYear = [1_000_000, 1_100_000, 1_210_000];
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 2, houseByYear);
    expect(p.map(pt => pt.house)).toEqual(houseByYear);
  });

  it('nets debtByYear out of total so the projection starts at net worth', () => {
    const debtByYear = [100_000, 60_000, 0];
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 2, undefined, debtByYear);
    expect(p.map(pt => pt.debt)).toEqual(debtByYear);
    expect(p[0].total).toBe(1_170_000 - 100_000);
    expect(p[1].total).toBe(p[1].stocks + p[1].crypto + p[1].cash + p[1].house - 60_000);
  });

  it('defaults debt to 0 when debtByYear is not provided', () => {
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 1);
    expect(p.every(pt => pt.debt === 0)).toBe(true);
    expect(p[0].total).toBe(1_170_000);
  });
});
