import { describe, it, expect } from 'vitest';
import {
  calcEmployerCost,
  calcBillingRate,
  calcBilledRate,
  calcFairGross,
  calcBillableHours,
  DEFAULT_EMPLOYER_COST_CONFIG,
  DEFAULT_BILLING_CONFIG,
} from './employerCost';

describe('calcEmployerCost', () => {
  it('levies payroll tax on the combined base (salary + feriepenger + employer OTP)', () => {
    // 1 000 000 gross, 12% feriepenger, 5% employer pension, 14.1% AGA, 90k overhead:
    // base = 1 000 000 + 120 000 + 50 000 = 1 170 000; AGA = 164 970.
    const b = calcEmployerCost(1_000_000, 5, DEFAULT_EMPLOYER_COST_CONFIG);
    expect(b.feriepenger).toBe(120_000);
    expect(b.employerPension).toBe(50_000);
    expect(b.payrollTaxBase).toBe(1_170_000);
    expect(b.payrollTax).toBeCloseTo(164_970, 5);
    expect(b.overhead).toBe(90_000);
    expect(b.totalEmployerCost).toBeCloseTo(1_424_970, 5);
    expect(b.loadingPct).toBeCloseTo(42.497, 3);
  });

  it('adds percentage overhead on top of the flat amount', () => {
    const b = calcEmployerCost(1_000_000, 0, { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadPct: 5 });
    expect(b.overhead).toBe(90_000 + 50_000);
  });

  it('clamps negative inputs to zero instead of producing negative costs', () => {
    const b = calcEmployerCost(-500_000, -5, { feriepengesatsPct: -1, payrollTaxPct: -1, overheadAnnual: -1, overheadPct: -1 });
    expect(b.gross).toBe(0);
    expect(b.totalEmployerCost).toBe(0);
    expect(b.loadingPct).toBe(0);
  });
});

describe('calcBillingRate', () => {
  const COST = 1_424_970;

  it('derives billable hours from work hours × utilization and prices in the margin', () => {
    // 1950 × 80% = 1560 h; margin is share of REVENUE: rate = breakEven / (1 − 0.30).
    const r = calcBillingRate(COST, DEFAULT_BILLING_CONFIG);
    expect(r.billableHoursPerYear).toBe(1560);
    expect(r.breakEvenHourly).toBeCloseTo(COST / 1560, 6);
    expect(r.targetHourly).toBeCloseTo(r.breakEvenHourly / 0.7, 6);
    expect(r.dailyRate).toBeCloseTo(r.targetHourly * 7.5, 6);
    expect(r.annualRevenueAtTarget).toBeCloseTo(r.targetHourly * 1560, 4);
    expect(r.profitAnnual).toBeCloseTo(r.annualRevenueAtTarget - COST, 4);
    // 30% of revenue ≙ ~42.9% markup on cost — the other framing must agree.
    expect(r.markupOnCostPct).toBeCloseTo((1 / 0.7 - 1) * 100, 4);
    // Margin-of-revenue invariant: profit / revenue = 30%.
    expect(r.profitAnnual / r.annualRevenueAtTarget).toBeCloseTo(0.30, 6);
  });

  it('clamps the margin below 100% so the rate cannot blow up to Infinity', () => {
    const r = calcBillingRate(COST, { ...DEFAULT_BILLING_CONFIG, targetMarginPct: 100 });
    expect(Number.isFinite(r.targetHourly)).toBe(true);
    expect(r.targetHourly).toBeCloseTo(r.breakEvenHourly / 0.05, 4); // clamped at 95%
  });

  it('lets a positive billableHoursOverride win over work×utilization', () => {
    const r = calcBillingRate(COST, { ...DEFAULT_BILLING_CONFIG, billableHoursOverride: 1000 });
    expect(r.billableHoursPerYear).toBe(1000);
  });

  it('returns the empty breakdown when there are no billable hours', () => {
    const r = calcBillingRate(COST, { ...DEFAULT_BILLING_CONFIG, workHoursPerYear: 0 });
    expect(r.billableHoursPerYear).toBe(0);
    expect(r.targetHourly).toBe(0);
  });
});

describe('calcBillableHours', () => {
  it('uses work hours × utilization unless a positive override is set', () => {
    expect(calcBillableHours(DEFAULT_BILLING_CONFIG)).toBe(1560);
    expect(calcBillableHours({ ...DEFAULT_BILLING_CONFIG, billableHoursOverride: 1200 })).toBe(1200);
    expect(calcBillableHours({ ...DEFAULT_BILLING_CONFIG, billableHoursOverride: 0 })).toBe(1560);
  });
});

describe('calcBilledRate', () => {
  const cost = calcEmployerCost(1_000_000, 5, DEFAULT_EMPLOYER_COST_CONFIG); // 1 424 970

  it('shows what the employer keeps at the billed rate', () => {
    // 1 200 kr/t × 1560 h = 1 872 000 revenue; profit = 1 872 000 − 1 424 970.
    const r = calcBilledRate(1200, 1560, cost.totalEmployerCost);
    expect(r.annualRevenue).toBe(1_872_000);
    expect(r.employerProfit).toBeCloseTo(447_030, 5);
    expect(r.marginPct).toBeCloseTo((447_030 / 1_872_000) * 100, 6);
    expect(r.profitPerHour).toBeCloseTo(447_030 / 1560, 6);
  });

  it('reports a loss when the rate does not cover the cost', () => {
    expect(calcBilledRate(500, 1560, cost.totalEmployerCost).employerProfit).toBeLessThan(0);
  });

  it('stays finite with no billable hours', () => {
    const r = calcBilledRate(1200, 0, cost.totalEmployerCost);
    expect(r.annualRevenue).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.profitPerHour).toBe(0);
  });

  it('agrees with calcBillingRate: billing at the target rate yields the target margin', () => {
    const target = calcBillingRate(cost.totalEmployerCost, DEFAULT_BILLING_CONFIG);
    expect(calcBilledRate(target.targetHourly, 1560, cost.totalEmployerCost).marginPct).toBeCloseTo(30, 6);
  });
});

describe('calcFairGross', () => {
  it('finds the salary at which the employer keeps exactly the target margin', () => {
    const g = calcFairGross(1200, 1560, 5, DEFAULT_EMPLOYER_COST_CONFIG, 30);
    // Round-trip: the fair salary's full cost must equal revenue × (1 − 30%).
    expect(calcEmployerCost(g, 5, DEFAULT_EMPLOYER_COST_CONFIG).totalEmployerCost).toBeCloseTo(1_872_000 * 0.7, 4);
  });

  it('round-trips with percentage overhead too', () => {
    const cfg = { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadPct: 5 };
    const g = calcFairGross(1500, 1500, 2, cfg, 20);
    expect(calcEmployerCost(g, 2, cfg).totalEmployerCost).toBeCloseTo(1500 * 1500 * 0.8, 4);
  });

  it('is the inverse of the salary → rate direction', () => {
    const cost = calcEmployerCost(924_000, 5, DEFAULT_EMPLOYER_COST_CONFIG);
    const rate = calcBillingRate(cost.totalEmployerCost, DEFAULT_BILLING_CONFIG).targetHourly;
    expect(calcFairGross(rate, 1560, 5, DEFAULT_EMPLOYER_COST_CONFIG, 30)).toBeCloseTo(924_000, 4);
  });

  it('floors at zero when the rate cannot cover the fixed overhead', () => {
    expect(calcFairGross(50, 1560, 5, DEFAULT_EMPLOYER_COST_CONFIG, 30)).toBe(0);
  });
});
