import { describe, it, expect } from 'vitest';
import { projectForecast, type ForecastInputs, type EffectiveScenario } from './forecastProjection';
import { calcTaxByRegion } from './norwegianTax';

const inputs: ForecastInputs = {
  currentGross: 600000,
  totalEquity: 1000000,
  startingMortgage: 2000000,
  mortgageRatePct: 5,
  annualMortgagePayment: 140000,
  region: 'generic',
  customTaxRatePct: 30, // flat 30% net → net = 70% of gross in generic mode
  ipsAnnualContribution: 0,
  startYear: 2026,
  startHomeValue: 3000000,
  houseGrowthPct: 2,
  startShares: 500000,
  startOtherAssets: 300000,
  nonMortgageDebt: 0,
};

const scenario = (over: Partial<EffectiveScenario> = {}): EffectiveScenario => ({
  raisePct: 4, savingsPct: 20, returnPct: 6, inflationPct: 3, years: 10, extraMonthly: 0, ...over,
});

describe('projectForecast', () => {
  it('returns years+1 rows starting at the current year with no year-0 growth', () => {
    const rows = projectForecast(inputs, scenario({ years: 10 }));
    expect(rows).toHaveLength(11);
    expect(rows[0].yearLabel).toBe(2026);
    expect(rows[10].yearLabel).toBe(2036);
    // Year 0: net worth is unchanged from equity, salary unchanged from gross.
    expect(rows[0].netWorth).toBe(1000000);
    expect(rows[0].gross).toBe(600000);
  });

  it('grows salary by the raise each year after year 0', () => {
    const rows = projectForecast(inputs, scenario({ raisePct: 4 }));
    expect(rows[1].gross).toBe(Math.round(600000 * 1.04));
    expect(rows[2].gross).toBe(Math.round(600000 * 1.04 * 1.04));
  });

  it('compounds net worth by return plus the savings contribution', () => {
    const rows = projectForecast(inputs, scenario({ returnPct: 6, savingsPct: 20, raisePct: 0 }));
    // Year 1 (raise 0 → gross flat): net uses the entering mortgage interest as a
    // deduction; contribution is 20% of it; net worth compounds by the return.
    const mortgageInterestY1 = 2000000 * 0.05;
    const netY1 = calcTaxByRegion(600000, 'generic', 30, 0, mortgageInterestY1).netAnnual;
    expect(rows[1].netWorth).toBe(Math.round(1000000 * 1.06 + netY1 * 0.2));
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
    // 0.64M above the 1.76M bunnfradrag → 6 400/yr at the first bracket.
    const noTaxDrift: EffectiveScenario = { raisePct: 0, savingsPct: 0, returnPct: 0, inflationPct: 0, years: 2, extraMonthly: 0 };
    const noInputs: ForecastInputs = {
      ...inputs, region: 'no', totalEquity: 3000000, startingMortgage: 0,
      startHomeValue: 0, startShares: 3000000, startOtherAssets: 0, nonMortgageDebt: 0,
    };

    it('charges no tax at year 0 and reduces net worth from year 1 on', () => {
      const rows = projectForecast(noInputs, noTaxDrift);
      expect(rows[0].netWorth).toBe(3000000);   // today, pre-deduction
      expect(rows[0].wealthTax).toBe(0);
      expect(rows[1].wealthTax).toBe(6400);      // 0.64M × 1.0%, charged this year
      expect(rows[1].netWorth).toBe(2993600);    // 3.0M − 6 400
      expect(rows[2].netWorth).toBeLessThan(rows[1].netWorth);
    });

    it('is a no-op in the generic region', () => {
      const rows = projectForecast({ ...noInputs, region: 'generic' }, noTaxDrift);
      expect(rows.every(r => r.wealthTax === 0)).toBe(true);
      expect(rows.every(r => r.netWorth === 3000000)).toBe(true);
    });

    it('leaves a below-bunnfradrag household untaxed', () => {
      const rows = projectForecast({ ...noInputs, totalEquity: 1000000, startShares: 1000000 }, noTaxDrift);
      expect(rows.every(r => r.wealthTax === 0)).toBe(true);
    });
  });
});
