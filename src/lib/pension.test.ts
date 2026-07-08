import { describe, it, expect } from 'vitest';
import { pensionFutureValue, projectPensionWealth } from './pension';

describe('pensionFutureValue', () => {
  it('returns the starting balance for zero or negative years', () => {
    expect(pensionFutureValue(100000, 5000, 5, 0)).toBe(100000);
    expect(pensionFutureValue(100000, 5000, 5, -3)).toBe(100000);
  });

  it('accumulates linearly at a ~0% rate', () => {
    expect(pensionFutureValue(100000, 5000, 0, 4)).toBe(120000);
  });

  it('matches the iterative recurrence next = prev*(1+r) + contribution', () => {
    const start = 200000, contrib = 30000, ratePct = 6, years = 10;
    let bal = start;
    for (let i = 0; i < years; i++) bal = bal * (1 + ratePct / 100) + contrib;
    expect(pensionFutureValue(start, contrib, ratePct, years)).toBeCloseTo(bal, 6);
  });
});

describe('projectPensionWealth', () => {
  const params = {
    otpBalance: 300000, ipsBalance: 50000,
    otpAnnualContribution: 40000, ipsAnnualContribution: 15000,
    otpGrowthRate: 5, ipsGrowthRate: 4,
    yearsToRetire: 20, startYear: 2026,
  };

  it('starts at year 0 with today\'s balances and spans to retirement inclusive', () => {
    const series = projectPensionWealth(params);
    expect(series).toHaveLength(21);
    expect(series[0]).toEqual({ year: 2026, otp: 300000, ips: 50000, total: 350000 });
    expect(series[series.length - 1].year).toBe(2046);
  });

  it('has total equal to the rounded sum of the raw otp and ips', () => {
    const series = projectPensionWealth(params);
    for (const p of series) {
      // total is rounded from the unrounded sum, so it is within 1 of otp+ips
      expect(Math.abs(p.total - (p.otp + p.ips))).toBeLessThanOrEqual(1);
    }
  });

  it('final balances match pensionFutureValue', () => {
    const series = projectPensionWealth(params);
    const last = series[series.length - 1];
    expect(last.otp).toBe(Math.round(pensionFutureValue(params.otpBalance, params.otpAnnualContribution, params.otpGrowthRate, 20)));
    expect(last.ips).toBe(Math.round(pensionFutureValue(params.ipsBalance, params.ipsAnnualContribution, params.ipsGrowthRate, 20)));
  });

  it('returns a single year when already at retirement', () => {
    const series = projectPensionWealth({ ...params, yearsToRetire: 0 });
    expect(series).toHaveLength(1);
    expect(series[0].total).toBe(350000);
  });
});
