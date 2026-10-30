import { describe, it, expect } from 'vitest';
import { projectForecast, type ForecastInputs, type EffectiveScenario } from './forecastProjection';
import { calcTaxByRegion } from './norwegianTax';
import { calcHouseEquityByYear } from './calculations';

const inputs: ForecastInputs = {
  currentGross: 600000,
  startingMortgage: 2000000,
  mortgageRatePct: 5,
  annualMortgagePayment: 140000,
  region: 'generic',
  customTaxRatePct: 30, // flat 30% net → net = 70% of gross in generic mode
  ipsAnnualContribution: 0,
  startYear: 2026,
  startHomeValue: 3000000,
  startHomeDebt: 2000000,
  homeDebtTermYears: 25,
  houseGrowthPct: 2,
  startShares: 500000,
  startOtherAssets: 300000,
  debts: [],
};

const scenario = (over: Partial<EffectiveScenario> = {}): EffectiveScenario => ({
  raisePct: 4, savingsPct: 20, returnPct: 6, inflationPct: 3, years: 10, extraMonthly: 0, ...over,
});

describe('projectForecast — co-owned home', () => {
  // Year-1 wealth tax is assessed on year 0's ending composition. Only the home,
  // no shares/other/debt, Norway: half of a 16 MNOK home (8 M share, no growth).
  const home: ForecastInputs = {
    ...inputs, region: 'no', startingMortgage: 0, annualMortgagePayment: 0,
    startHomeValue: 8_000_000, startHomeDebt: 0, houseGrowthPct: 0,
    startShares: 0, startOtherAssets: 0,
  };
  const s = scenario({ years: 1, returnPct: 0, savingsPct: 0 });
  it('applies the 70 % threshold to the whole home when homeOwnShare < 1', () => {
    const tax = projectForecast({ ...home, homeOwnShare: 0.5 }, s)[1].wealthTax;
    const solo = projectForecast(home, s)[1].wealthTax;
    expect(solo).toBe(1_000);          // 8 M as a whole home → valued 2.0 M
    expect(tax).toBeGreaterThan(solo); // half of 16 M → (14M × 0.25 + 2M × 0.7) / 2 = 2.45 M
    expect(tax).toBeCloseTo((2_450_000 - 1_900_000) * 0.01, -2);
  });
});

describe('projectForecast', () => {
  it('returns years+1 rows starting at the current year with no year-0 growth', () => {
    const rows = projectForecast(inputs, scenario({ years: 10 }));
    expect(rows).toHaveLength(11);
    expect(rows[0].yearLabel).toBe(2026);
    expect(rows[10].yearLabel).toBe(2036);
    // Year 0: net worth is today's (0.8M financial + 3M home − 2M mortgage),
    // salary unchanged from gross.
    expect(rows[0].netWorth).toBe(1800000);
    expect(rows[0].gross).toBe(600000);
  });

  it('grows salary by the raise each year after year 0', () => {
    const rows = projectForecast(inputs, scenario({ raisePct: 4 }));
    expect(rows[1].gross).toBe(Math.round(600000 * 1.04));
    expect(rows[2].gross).toBe(Math.round(600000 * 1.04 * 1.04));
  });

  it('compounds financial assets by return plus the savings contribution', () => {
    const rows = projectForecast(inputs, scenario({ returnPct: 6, savingsPct: 20, raisePct: 0 }));
    // Year 1 (raise 0 → gross flat): net uses the entering mortgage interest as a
    // deduction; contribution is 20% of it; only the financial assets compound by
    // the return.
    const mortgageInterestY1 = 2000000 * 0.05;
    const netY1 = calcTaxByRegion(600000, 'generic', 30, 0, mortgageInterestY1).netAnnual;
    expect(rows[1].financial).toBe(Math.round(800000 * 1.06 + netY1 * 0.2));
  });

  it('grows home equity like calcHouseEquityByYear, not at the investment return', () => {
    // Home 5M, mortgage 3M at 5 % over 25 years, house growth 3 %, nothing else.
    const home: ForecastInputs = {
      ...inputs, region: 'no', startingMortgage: 3_000_000,
      startHomeValue: 5_000_000, startHomeDebt: 3_000_000, homeDebtTermYears: 25,
      houseGrowthPct: 3, startShares: 0, startOtherAssets: 0,
    };
    const rows = projectForecast(home, scenario({ returnPct: 0, savingsPct: 0, years: 10 }));
    const equity = calcHouseEquityByYear(5_000_000, 3_000_000, 3, 5, 25, 10);
    expect(rows[0].netWorth).toBe(2_000_000);
    expect(Math.abs(rows[10].netWorth - equity[10])).toBeLessThanOrEqual(1);
  });

  it('nets non-mortgage debt out of net worth and the wealth-tax base', () => {
    // 4M listed shares and a 1M student loan: today's net worth is 3M, and the
    // year-1 wealth tax is on 4M × 80 % − 1M = 2.2M, 0.3M above the bunnfradrag.
    const withDebt: ForecastInputs = {
      ...inputs, region: 'no', startingMortgage: 0, annualMortgagePayment: 0,
      startHomeValue: 0, startHomeDebt: 0, startShares: 4_000_000, startOtherAssets: 0,
      debts: [{ id: 's', name: 'Student loan', type: 'student', balance: 1_000_000, rate: 4, minPayment: 6_000 }],
    };
    const rows = projectForecast(withDebt, scenario({ returnPct: 0, savingsPct: 0, years: 2 }));
    expect(rows[0].netWorth).toBe(3_000_000);
    expect(rows[1].wealthTax).toBe(3_000);
    // The loan is paid down at its minimums, so net worth rises net of the tax.
    expect(rows[1].netWorth).toBeGreaterThan(rows[0].netWorth - 3_000);
  });

  it('pays the mortgage down toward zero and never below', () => {
    const rows = projectForecast(inputs, scenario({ years: 40 }));
    expect(rows[1].mortgage).toBeLessThan(rows[0].mortgage);
    expect(rows[rows.length - 1].mortgage).toBe(0);
  });

  it('deflates real net worth by the inflation assumption', () => {
    const rows = projectForecast(inputs, scenario({ inflationPct: 3, years: 5 }));
    const y5 = rows[5];
    expect(y5.netWorthReal).toBe(Math.round(y5.netWorth / Math.pow(1.03, 5)));
    expect(y5.netWorthReal).toBeLessThan(y5.netWorth);
  });

  it('a higher return scenario ends richer than a lower one (A/B compare)', () => {
    const a = projectForecast(inputs, scenario({ returnPct: 8 }));
    const b = projectForecast(inputs, scenario({ returnPct: 4 }));
    expect(a[a.length - 1].netWorth).toBeGreaterThan(b[b.length - 1].netWorth);
  });

  describe('wealth tax (formuesskatt)', () => {
    // All-financial, all listed shares → valued at 80%. 3M shares = 2.4M valued,
    // 0.5M above the 2026 1.9M bunnfradrag → 5 000/yr at the first bracket.
    const noTaxDrift: EffectiveScenario = { raisePct: 0, savingsPct: 0, returnPct: 0, inflationPct: 0, years: 2, extraMonthly: 0 };
    const noInputs: ForecastInputs = {
      ...inputs, region: 'no', startingMortgage: 0,
      startHomeValue: 0, startHomeDebt: 0, startShares: 3000000, startOtherAssets: 0, debts: [],
    };

    it('charges no tax at year 0 and reduces net worth from year 1 on', () => {
      const rows = projectForecast(noInputs, noTaxDrift);
      expect(rows[0].netWorth).toBe(3000000);   // today, pre-deduction
      expect(rows[0].wealthTax).toBe(0);
      expect(rows[1].wealthTax).toBe(5000);      // 0.5M × 1.0%, charged this year
      expect(rows[1].netWorth).toBe(2995000);    // 3.0M − 5 000
      expect(rows[2].netWorth).toBeLessThan(rows[1].netWorth);
    });

    it('is a no-op in the generic region', () => {
      const rows = projectForecast({ ...noInputs, region: 'generic' }, noTaxDrift);
      expect(rows.every(r => r.wealthTax === 0)).toBe(true);
      expect(rows.every(r => r.netWorth === 3000000)).toBe(true);
    });

    it('leaves a below-bunnfradrag household untaxed', () => {
      const rows = projectForecast({ ...noInputs, startShares: 1000000 }, noTaxDrift);
      expect(rows.every(r => r.wealthTax === 0)).toBe(true);
    });
  });
});
