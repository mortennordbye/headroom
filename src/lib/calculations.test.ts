import { describe, it, expect } from 'vitest';
import {
  calcMonthlyPayment,
  calcAmortizationSchedule,
  calcHouseEquityByYear,
  calcMortgageBalanceByYear,
  calcRecommendations,
  calcEmergencyFundStatus,
  bufferRecommendation,
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

  it('suggests the conservative floor when the target is under it', () => {
    // Volatile income, target 20% of a 30k residual → advisory asks for 30%.
    const r = calcRecommendations(50_000, 50_000, 20_000, 0.5, 20);
    expect(r.recommendedInvestment).toBe(6_000);
    expect(r.suggestedInvestment).toBe(9_000);
  });

  it('stops suggesting once the plan already clears the floor', () => {
    const r = calcRecommendations(50_000, 50_000, 20_000, 0.5, 45);
    // suggested === recommended is what hides the advisory in the UI.
    expect(r.suggestedInvestment).toBe(r.recommendedInvestment);
  });

  it('resolves instead of ratcheting when the suggestion is accepted', () => {
    // The old formula was target + 10pp, so accepting the advisory raised the
    // target and re-suggested another 10pp above it, forever. Accepting must
    // now settle: one round trip, then no further ask.
    const residual = 30_000;
    const first = calcRecommendations(50_000, 50_000, 20_000, 0.5, 20);
    const acceptedPct = (first.suggestedInvestment / residual) * 100;
    const second = calcRecommendations(50_000, 50_000, 20_000, 0.5, acceptedPct);
    expect(second.suggestedInvestment).toBe(second.recommendedInvestment);
    expect(second.suggestedInvestment).toBe(first.suggestedInvestment);
  });

  it('never suggests above the 95% cap', () => {
    const r = calcRecommendations(50_000, 50_000, 20_000, 0.5, 99);
    expect(r.suggestedInvestment).toBeLessThanOrEqual(Math.round(30_000 * 0.95));
  });

  it('leaves the suggestion equal to the plan outside conservative mode', () => {
    const r = calcRecommendations(50_000, 50_000, 20_000, 0, 10);
    expect(r.conservativeMode).toBe(false);
    expect(r.suggestedInvestment).toBe(r.recommendedInvestment);
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

describe('bufferRecommendation', () => {
  it('suggests a monthly set-aside that closes the shortfall over the horizon, rounded up to 100', () => {
    const ef = calcEmergencyFundStatus(20_000, 10_000); // shortfall 10 000 to reach 3 mo
    const r = bufferRecommendation(ef, 12);
    expect(r.action).toBe('build');
    expect(r.suggestedMonthly).toBe(900);               // ceil(10000/12/100)*100 = 900
    expect(r.horizonMonths).toBe(12);
  });

  it('maintains (0) once the buffer is at or above the minimum', () => {
    const r = bufferRecommendation(calcEmergencyFundStatus(40_000, 10_000));
    expect(r.action).toBe('maintain');
    expect(r.suggestedMonthly).toBe(0);
  });

  it('floors the horizon at 1 month so it never divides by zero', () => {
    const r = bufferRecommendation(calcEmergencyFundStatus(0, 10_000), 0);
    expect(r.horizonMonths).toBe(1);
    expect(r.suggestedMonthly).toBe(30_000);            // full 3-mo shortfall in one month
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
    // income 600k → maxDebt 3.0M; equity 2M → LTV cap = 2M/0.10 = 20M.
    // Income cap (3M+2M=5M) is lower, so it binds.
    const c = calcBorrowingCapacity(600_000, 2_000_000, 0, 5, 25);
    expect(c.maxDebt).toBe(3_000_000);
    expect(c.maxPrice).toBe(5_000_000);
    expect(c.ltvBound).toBe(false);
    expect(c.debtAtMaxPrice).toBe(3_000_000);
  });

  it('is LTV-bound when equity is thin relative to income', () => {
    // income 1.2M → maxDebt 6M; equity 400k → LTV cap = 400k/0.10 = 4.0M,
    // below the income cap (6.4M), so the 10%-equity rule binds.
    const c = calcBorrowingCapacity(1_200_000, 400_000, 0, 5, 25);
    expect(c.ltvBound).toBe(true);
    expect(c.maxPrice).toBeCloseTo(400_000 / 0.10, 4);
    // debt at the LTV cap is price − equity, i.e. 90% of price
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
    // % of the original loan repaid (20% of 2.5M paid down to 2.0M).
    expect(s.originalLoanRepaidPercent).toBeCloseTo(20, 6);
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
    expect(calcHomeownerMortgageStatus(2_600_000, 2_500_000, 5, 20, 22).originalLoanRepaidPercent).toBe(0);
    expect(calcHomeownerMortgageStatus(2_000_000, 0, 5, 20, 22).originalLoanRepaidPercent).toBe(0);
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

  it('leaves wealthTax at 0 and total unchanged when no config is passed', () => {
    const p = calcNetWorthProjectionByBucket(start, 0, rates, 2);
    expect(p.every(pt => pt.wealthTax === 0)).toBe(true);
  });

  describe('wealth-tax drag', () => {
    const zero = { stocks: 0, crypto: 0, cash: 0, house: 0 };
    // 3M in listed shares → valued at 80% = 2.4M, 0.64M above the 1.76M bunnfradrag
    // → 6 400/yr at the first bracket (1.0%).
    const rich = { stocks: 3_000_000, crypto: 0, cash: 0, house: 0 };

    it('assesses tax on the valued wealth above the bunnfradrag and pays it from the pot', () => {
      const p = calcNetWorthProjectionByBucket(rich, 0, zero, 2, undefined, undefined, {
        mortgageByYear: [0, 0, 0], region: 'no',
      });
      expect(p[0].wealthTax).toBe(6_400);          // 0.64M × 1.0%
      expect(p[0].total).toBe(3_000_000);          // year 0 = today, pre-deduction
      expect(p[1].total).toBe(2_993_600);          // last year's 6 400 left the pot
      expect(p[1].wealthTax).toBe(6_349);          // reassessed on the smaller base
    });

    it('is a no-op below the bunnfradrag', () => {
      const modest = { stocks: 1_000_000, crypto: 0, cash: 0, house: 0 }; // valued 0.8M < 1.76M
      const p = calcNetWorthProjectionByBucket(modest, 0, zero, 2, undefined, undefined, {
        mortgageByYear: [0, 0, 0], region: 'no',
      });
      expect(p.every(pt => pt.wealthTax === 0)).toBe(true);
      expect(p[2].total).toBe(1_000_000);
    });

    it('is a no-op outside the Norwegian region', () => {
      const p = calcNetWorthProjectionByBucket(rich, 0, zero, 2, undefined, undefined, {
        mortgageByYear: [0, 0, 0], region: 'generic',
      });
      expect(p.every(pt => pt.wealthTax === 0)).toBe(true);
      expect(p.every(pt => pt.total === 3_000_000)).toBe(true);
    });

    it('recovers the home market value from equity + mortgage', () => {
      // 17M equity + 3M mortgage = 20M market value → valued 10M×25% + 10M×70% = 9.5M,
      // less 3M debt = 6.5M net wealth; 4.74M above bunnfradrag × 1.0% = 47 400.
      const p = calcNetWorthProjectionByBucket(zero, 0, zero, 0, [17_000_000], [0], {
        mortgageByYear: [3_000_000], region: 'no',
      });
      expect(p[0].wealthTax).toBe(47_400);
    });
  });
});
