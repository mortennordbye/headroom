import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SECOND_HOME_SCENARIO,
  CAPITAL_INCOME_RATE_PCT,
  calcPurchaseCosts,
  calcRentalIncomeTax,
  calcRentalCashflow,
  calcWealthTaxImpact,
  calcPropertyCapitalGains,
  calcBrrr,
  stressRate,
  projectValue,
  scenarioLoan,
  summarizeScenario,
  calcPortfolio,
  type SecondHomeScenario,
} from './secondHome';

const scenario = (over: Partial<SecondHomeScenario> = {}): SecondHomeScenario => ({
  id: 's1',
  name: 'Test',
  ...DEFAULT_SECOND_HOME_SCENARIO,
  ...over,
});

describe('calcPurchaseCosts', () => {
  it('applies dokumentavgift as a percentage of price plus flat fees', () => {
    const c = calcPurchaseCosts(4_000_000, 2.5, 585, 0);
    expect(c.dokumentavgift).toBe(100_000);
    expect(c.tinglysing).toBe(585);
    expect(c.total).toBe(100_585);
  });

  it('clamps negative inputs to zero', () => {
    const c = calcPurchaseCosts(-100, -2, -50, -10);
    expect(c.total).toBe(0);
  });
});

describe('stressRate', () => {
  it('adds 3pp to the contract rate', () => {
    expect(stressRate(5.5)).toBeCloseTo(8.5);
  });
  it('floors at 7% when the contract rate is low', () => {
    expect(stressRate(2)).toBe(7);
  });
});

describe('calcRentalIncomeTax', () => {
  it('taxes net capital income at 22% after costs and interest', () => {
    // net = 200_000 − 40_000 − 60_000 = 100_000 → 22% = 22_000
    expect(calcRentalIncomeTax(200_000, 40_000, 60_000, 22)).toBe(22_000);
  });

  it('defaults the rate to the tax-year capital-income rate (22)', () => {
    expect(CAPITAL_INCOME_RATE_PCT).toBe(22);
    expect(calcRentalIncomeTax(100_000, 0, 0)).toBe(22_000);
  });

  it('returns 0 tax when the net is a loss', () => {
    expect(calcRentalIncomeTax(50_000, 40_000, 60_000)).toBe(0);
  });
});

describe('calcRentalCashflow', () => {
  it('computes gross/net yield and after-tax cashflow', () => {
    const s = scenario({ purchasePrice: 4_000_000, monthlyRent: 15_000, vacancyPct: 0, monthlyOperatingCosts: 3_000 });
    const cf = calcRentalCashflow(s, 3_000_000);
    expect(cf.grossAnnualRent).toBe(180_000);
    expect(cf.effectiveRent).toBe(180_000);
    expect(cf.grossYieldPct).toBeCloseTo(4.5); // 180k / 4M
    expect(cf.annualOperatingCosts).toBe(36_000);
    expect(cf.netOperatingIncome).toBe(144_000);
    // NOI 144k / (4M + purchase costs) ~ just under 3.6%
    expect(cf.netYieldPct).toBeGreaterThan(3);
    expect(cf.netYieldPct).toBeLessThan(3.6);
    expect(cf.annualInterest).toBeGreaterThan(0);
    expect(cf.afterTaxAnnualCashflow).toBe(cf.preTaxAnnualCashflow - cf.rentalIncomeTax);
    expect(cf.afterTaxMonthlyCashflow).toBeCloseTo(cf.afterTaxAnnualCashflow / 12);
  });

  it('applies vacancy to the effective rent', () => {
    const cf = calcRentalCashflow(scenario({ monthlyRent: 10_000, vacancyPct: 10 }), 0);
    expect(cf.grossAnnualRent).toBe(120_000);
    expect(cf.effectiveRent).toBeCloseTo(108_000);
  });

  it('guards yields to 0 when the price is 0', () => {
    const cf = calcRentalCashflow(scenario({ purchasePrice: 0 }), 0);
    expect(cf.grossYieldPct).toBe(0);
    expect(cf.netYieldPct).toBe(0);
  });

  it('has no debt service when there is no loan', () => {
    const cf = calcRentalCashflow(scenario(), 0);
    expect(cf.annualInterest).toBe(0);
    expect(cf.annualPrincipal).toBe(0);
    expect(cf.annualDebtService).toBe(0);
  });
});

describe('calcWealthTaxImpact', () => {
  it('values a secondary home at 100% of market value net of debt', () => {
    const w = calcWealthTaxImpact(4_000_000, 3_000_000, 0.85);
    expect(w.addedTaxableWealth).toBe(1_000_000);
    expect(w.marginalWealthTax).toBeCloseTo(8_500);
  });

  it('floors negative added wealth to 0 tax', () => {
    const w = calcWealthTaxImpact(2_000_000, 3_000_000, 1);
    expect(w.addedTaxableWealth).toBe(-1_000_000);
    expect(w.marginalWealthTax).toBe(0);
  });
});

describe('calcPropertyCapitalGains', () => {
  it('taxes the gain at 22% net of costs and improvements', () => {
    // gain = 5.5M − 4M − 100k − 200k − (5.5M×3%=165k) = 1_035_000
    const g = calcPropertyCapitalGains(5_500_000, 4_000_000, 100_000, 200_000, 3, 22);
    expect(g.saleCosts).toBe(165_000);
    expect(g.gain).toBe(1_035_000);
    expect(g.tax).toBeCloseTo(227_700);
    expect(g.netProceeds).toBeCloseTo(5_500_000 - 165_000 - 227_700);
  });

  it('yields 0 tax on a loss', () => {
    const g = calcPropertyCapitalGains(3_000_000, 4_000_000, 100_000, 0, 3);
    expect(g.gain).toBeLessThan(0);
    expect(g.tax).toBe(0);
  });
});

describe('calcBrrr', () => {
  it('computes cash-out and capital left in after a revalue', () => {
    // price 4M, 25% equity → equity 1M, loan 3M. reno 500k. ARV 5M, refi 75% → 3.75M
    const r = calcBrrr(scenario({ purchasePrice: 4_000_000, equityShare: 0.25, renovationCost: 500_000, afterRepairValue: 5_000_000, refinanceLtvPct: 75 }));
    expect(r.initialEquity).toBe(1_000_000);
    expect(r.initialLoan).toBe(3_000_000);
    expect(r.maxRefiLoan).toBe(3_750_000);
    expect(r.cashOut).toBe(750_000); // 3.75M − 3M
    // cashInvested = 1M equity + purchase costs + 500k reno
    expect(r.capitalLeftIn).toBeCloseTo(r.cashInvested - 750_000);
    expect(r.postRefiLtvPct).toBe(75);
  });

  it('floors cash-out at 0 when ARV is below cost', () => {
    const r = calcBrrr(scenario({ purchasePrice: 4_000_000, equityShare: 0.25, afterRepairValue: 3_000_000, refinanceLtvPct: 75 }));
    expect(r.maxRefiLoan).toBe(2_250_000); // below the 3M initial loan
    expect(r.cashOut).toBe(0);
    expect(r.capitalLeftIn).toBe(r.cashInvested);
  });

  it('guards post-refi LTV to 0 when ARV is 0', () => {
    const r = calcBrrr(scenario({ afterRepairValue: 0 }));
    expect(r.postRefiLtvPct).toBe(0);
  });
});

describe('projectValue', () => {
  it('compounds forward at the annual rate', () => {
    expect(projectValue(1_000_000, 3, 10)).toBeCloseTo(1_343_916.379, 0);
  });
});

describe('scenarioLoan', () => {
  it('uses the purchase loan after equity for a rental', () => {
    expect(scenarioLoan(scenario({ strategy: 'rent', purchasePrice: 4_000_000, equityShare: 0.25 }))).toBe(3_000_000);
  });
  it('uses the refinanced balance for BRRR', () => {
    // ARV 5M × 75% refi = 3.75M
    expect(scenarioLoan(scenario({ strategy: 'brrr', afterRepairValue: 5_000_000, refinanceLtvPct: 75 }))).toBe(3_750_000);
  });
});

describe('summarizeScenario', () => {
  it('rolls up loan, cash needed, yield and LTV', () => {
    const sum = summarizeScenario(scenario({ purchasePrice: 4_000_000, equityShare: 0.25, monthlyRent: 15_000, vacancyPct: 0 }));
    expect(sum.loan).toBe(3_000_000);
    expect(sum.ltvPct).toBeCloseTo(75);
    expect(sum.grossYieldPct).toBeCloseTo(4.5);
    // cash needed = 1M equity + purchase costs (100_585)
    expect(sum.cashNeeded).toBeCloseTo(1_100_585);
  });
});

describe('calcPortfolio', () => {
  it('stacks only committed scenarios onto existing debt', () => {
    const scenarios = [
      scenario({ id: 'a', committed: true, purchasePrice: 4_000_000, equityShare: 0.25 }),   // loan 3M
      scenario({ id: 'b', committed: true, purchasePrice: 2_000_000, equityShare: 0.25 }),   // loan 1.5M
      scenario({ id: 'c', committed: false, purchasePrice: 5_000_000, equityShare: 0.25 }),  // ignored
    ];
    // existing debt 2M, income 900k → 5× = 4.5M cap
    const p = calcPortfolio(scenarios, 900_000, 2_000_000);
    expect(p.committedCount).toBe(2);
    expect(p.totalLoan).toBe(4_500_000);          // 3M + 1.5M
    expect(p.cumulativeDebt).toBe(6_500_000);     // + 2M existing
    expect(p.dtiRatio).toBeCloseTo(6_500_000 / 900_000);
    expect(p.borrowingHeadroom).toBe(0);          // already over the 5× cap
  });

  it('reports positive headroom when under the cap', () => {
    const p = calcPortfolio([scenario({ committed: true, purchasePrice: 2_000_000, equityShare: 0.5 })], 1_000_000, 0);
    // loan 1M, cap 5M → headroom 4M
    expect(p.totalLoan).toBe(1_000_000);
    expect(p.borrowingHeadroom).toBe(4_000_000);
  });

  it('is all-zero when nothing is committed', () => {
    const p = calcPortfolio([scenario({ committed: false })], 900_000, 0);
    expect(p.committedCount).toBe(0);
    expect(p.totalLoan).toBe(0);
    expect(p.combinedMonthlyCashflow).toBe(0);
  });
});
