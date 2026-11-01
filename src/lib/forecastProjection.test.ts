import { describe, it, expect } from 'vitest';
import { projectForecast, forecastMortgage, type ForecastInputs, type EffectiveScenario } from './forecastProjection';
import { currentMortgage, annualMortgageInterest } from './existingMortgage';
import { calcTaxByRegion } from './norwegianTax';
import { calcAmortizationSchedule, calcHouseEquityByYear, calcMortgageBalanceByYear } from './calculations';

const inputs: ForecastInputs = {
  currentGross: 600000,
  mortgage: { balance: 2000000, ratePct: 5, termYears: 25, amortises: true },
  region: 'generic',
  customTaxRatePct: 30, // flat 30% net → net = 70% of gross in generic mode
  ipsAnnualContribution: 0,
  startYear: 2026,
  startHomeValue: 3000000,
  houseGrowthPct: 2,
  startShares: 500000,
  startOtherAssets: 300000,
  debts: [],
};

const NO_MORTGAGE = { balance: 0, ratePct: 0, termYears: 0, amortises: false };

const scenario = (over: Partial<EffectiveScenario> = {}): EffectiveScenario => ({
  raisePct: 4, savingsPct: 20, returnPct: 6, inflationPct: 3, years: 10, extraMonthly: 0, ...over,
});

describe('projectForecast — holiday pay above salary', () => {
  const no: ForecastInputs = { ...inputs, region: 'no', mortgage: NO_MORTGAGE };
  it('taxes year 0 on salary plus the given surplus', () => {
    const rows = projectForecast({ ...no, startHolidaySurplus: 12_000, feriepengesatsPct: 12 }, scenario({ years: 1 }));
    expect(rows[0].net).toBe(Math.round(calcTaxByRegion(600_000 + 12_000, 'no', 30, 0, 0).netAnnual));
    expect(rows[0].gross).toBe(600_000);
  });
  it('derives later years from this and last year\'s projected salary', () => {
    const rows = projectForecast({ ...no, feriepengesatsPct: 12 }, scenario({ years: 1, raisePct: 0 }));
    // Flat salary on the 12% rate: 12% of it minus five weeks' fratrekk.
    const surplus = 600_000 * 0.12 - (600_000 * 5) / 52;
    expect(rows[1].net).toBe(Math.round(calcTaxByRegion(600_000 + surplus, 'no', 30, 0, 0).netAnnual));
  });
  it('adds nothing outside Norway or without a rate', () => {
    const plain = projectForecast(no, scenario({ years: 1 }));
    expect(plain[1].net).toBe(Math.round(calcTaxByRegion(plain[1].gross, 'no', 30, 0, 0).netAnnual));
    const generic = projectForecast({ ...inputs, mortgage: NO_MORTGAGE, feriepengesatsPct: 12 }, scenario({ years: 1 }));
    expect(generic[1].net).toBe(Math.round(generic[1].gross * 0.7));
  });
});

describe('projectForecast — co-owned home', () => {
  // Year-1 wealth tax is assessed on year 0's ending composition. Only the home,
  // no shares/other/debt, Norway: half of a 16 MNOK home (8 M share, no growth).
  const home: ForecastInputs = {
    ...inputs, region: 'no', mortgage: NO_MORTGAGE,
    startHomeValue: 8_000_000, houseGrowthPct: 0,
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
    // Year 1 (raise 0 → gross flat): net deducts the interest actually paid that
    // year on the amortising schedule; contribution is 20% of it; only the
    // financial assets compound by the return.
    const mortgageInterestY1 = calcAmortizationSchedule(2000000, 5, 25)[1].interestPaid;
    const netY1 = calcTaxByRegion(600000, 'generic', 30, 0, mortgageInterestY1).netAnnual;
    expect(rows[1].financial).toBe(Math.round(800000 * 1.06 + netY1 * 0.2));
  });

  it("year 0's rentefradrag is the app's year-one interest, so its net equals the Salary/Budget net", () => {
    const m = currentMortgage('homeowner', { houseDebt: 2_000_000 }, {
      currentMortgageBalance: 2_000_000, rente: 5, nedbetalingstid: 25,
      nedbetalingstidAsOf: '2026-01', currentMortgageBalanceAsOf: '2026-01',
    }, undefined, '2026-10');
    const rows = projectForecast({ ...inputs, region: 'no', mortgage: forecastMortgage(m) }, scenario());
    const appNet = calcTaxByRegion(600000, 'no', 30, 0, annualMortgageInterest(m)).netAnnual;
    expect(rows[0].net).toBe(Math.round(appNet));
    // Later years deduct less as the loan amortises.
    const y2 = projectForecast({ ...inputs, region: 'no', mortgage: forecastMortgage(m) }, scenario({ raisePct: 0 }));
    expect(y2[2].net).toBeLessThan(y2[1].net);
  });

  it('grows home equity like calcHouseEquityByYear, not at the investment return', () => {
    // Home 5M, mortgage 3M at 5 % over 25 years, house growth 3 %, nothing else.
    const home: ForecastInputs = {
      ...inputs, region: 'no', mortgage: { balance: 3_000_000, ratePct: 5, termYears: 25, amortises: true },
      startHomeValue: 5_000_000,
      houseGrowthPct: 3, startShares: 0, startOtherAssets: 0,
    };
    const rows = projectForecast(home, scenario({ returnPct: 0, savingsPct: 0, years: 10 }));
    const equity = calcHouseEquityByYear(5_000_000, 3_000_000, 3, 5, 25, 10);
    expect(rows[0].netWorth).toBe(2_000_000);
    expect(Math.abs(rows[10].netWorth - equity[10])).toBeLessThanOrEqual(1);
  });

  it('nets non-mortgage debt out of net worth and the wealth-tax base', () => {
    // 4M listed shares and a 1M student loan: today's net worth is 3M. All assets
    // are shares, so gjeldsreduksjon values the debt at 80 % too: the year-1 wealth
    // tax is on 4M × 80 % − 1M × 80 % = 2.4M, 0.5M above the bunnfradrag.
    const withDebt: ForecastInputs = {
      ...inputs, region: 'no', mortgage: NO_MORTGAGE,
      startHomeValue: 0, startShares: 4_000_000, startOtherAssets: 0,
      debts: [{ id: 's', name: 'Student loan', type: 'student', balance: 1_000_000, rate: 4, minPayment: 6_000 }],
    };
    const rows = projectForecast(withDebt, scenario({ returnPct: 0, savingsPct: 0, years: 2 }));
    expect(rows[0].netWorth).toBe(3_000_000);
    expect(rows[1].wealthTax).toBe(5_000);
    // The loan is paid down at its minimums, so net worth rises net of the tax.
    expect(rows[1].netWorth).toBeGreaterThan(rows[0].netWorth - 5_000);
  });

  it('pays the mortgage down toward zero and never below', () => {
    const rows = projectForecast(inputs, scenario({ years: 40 }));
    expect(rows[1].mortgage).toBeLessThan(rows[0].mortgage);
    expect(rows[rows.length - 1].mortgage).toBe(0);
  });

  it('deflates real net worth by the inflation assumption', () => {
    const rows = projectForecast(inputs, scenario({ inflationPct: 3, years: 5 }));
    const y5 = rows[5];
    // Within a krone: netWorthReal deflates the unrounded net worth.
    expect(Math.abs(y5.netWorthReal - y5.netWorth / Math.pow(1.03, 5))).toBeLessThanOrEqual(1);
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
      ...inputs, region: 'no', mortgage: NO_MORTGAGE,
      startHomeValue: 0, startShares: 3000000, startOtherAssets: 0, debts: [],
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

describe('projectForecast — one mortgage series', () => {
  it('the mortgage tile and the net-worth home debt are the same series in the owner modes', () => {
    const rows = projectForecast(inputs, scenario({ years: 25 }));
    expect(rows.map((r) => r.mortgage)).toEqual(rows.map((r) => r.homeDebt));
    expect(rows.map((r) => r.homeDebt)).toEqual(calcMortgageBalanceByYear(2_000_000, 5, 25, 25));
  });

  it('deducts the interest actually paid in the year on the amortising schedule', () => {
    const rows = projectForecast(inputs, scenario({ years: 2, raisePct: 0 }));
    const interest = calcAmortizationSchedule(2_000_000, 5, 25)[2].interestPaid;
    expect(rows[2].net).toBe(Math.round(calcTaxByRegion(600000, 'generic', 30, 0, interest).netAnnual));
  });

  it('a first buyer\'s Assets debt is held flat, with no tile and no deduction', () => {
    const firstBuyer: ForecastInputs = {
      ...inputs, mortgage: { balance: 3_400_000, ratePct: 0, termYears: 0, amortises: false },
      startHomeValue: 4_800_000,
    };
    const rows = projectForecast(firstBuyer, scenario({ years: 10, raisePct: 0 }));
    expect(rows.every((r) => r.homeDebt === 3_400_000)).toBe(true);
    expect(rows.every((r) => r.mortgage === 0)).toBe(true);
    expect(rows[1].net).toBe(Math.round(calcTaxByRegion(600000, 'generic', 30, 0, 0).netAnnual));
  });
});

describe('Dashboard and Forecast project the same home equity', () => {
  // The Dashboard: calcHouseEquityByYear on `currentMortgage`. The Forecast:
  // projectForecast with only the home (no financial assets, no savings, no
  // other debt, generic region), so its net worth is the home equity.
  const assets = { houseDebt: 3_000_000, coOwners: [{ id: 'c', name: 'S', ownershipPct: 50, since: '2020-01' }] };
  const homeowner = {
    currentMortgageBalance: 3_000_000, rente: 4.5, nedbetalingstid: 22,
    nedbetalingstidAsOf: '2025-10', currentMortgageBalanceAsOf: '2025-10',
  };
  it.each(['homeowner', 'transitioning', 'first_buyer'] as const)('%s', (mode) => {
    const m = currentMortgage(mode, assets, homeowner, { currentMortgageBalance: 3_000_000 }, '2026-10');
    const myValue = 5_000_000 * 0.5;
    const dashboard = calcHouseEquityByYear(myValue, m.balance, 3, m.ratePct, m.paymentTermMonths / 12, 15);
    const rows = projectForecast({
      ...inputs, mortgage: forecastMortgage(m), startHomeValue: myValue, houseGrowthPct: 3,
      startShares: 0, startOtherAssets: 0, debts: [], homeOwnShare: 0.5,
    }, scenario({ years: 15, savingsPct: 0, returnPct: 0 }));
    rows.forEach((r, y) => expect(Math.abs(r.netWorth - dashboard[y])).toBeLessThanOrEqual(1));
  });
});

