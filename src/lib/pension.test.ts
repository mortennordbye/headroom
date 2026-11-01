import { describe, it, expect } from 'vitest';
import { otpAnnualContribution, otpBonusShareToDate, otpPensionableIncome, otpProjectedPensionableIncome, pensionFutureValue, projectPensionWealth } from './pension';

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

describe('otpAnnualContribution', () => {
  it('takes the percentage of pay below 12G', () => {
    expect(otpAnnualContribution(600_000, 5, 2026)).toBeCloseTo(30_000, 6);
  });

  it('caps the contribution base at 12G', () => {
    // 12 × 136,549 = 1,638,588; 5% of that, not of 2M.
    expect(otpAnnualContribution(2_000_000, 5, 2026)).toBeCloseTo(81_929.4, 6);
  });

  it('returns 0 for non-positive income', () => {
    expect(otpAnnualContribution(-1, 5, 2026)).toBe(0);
  });
});

describe('otpPensionableIncome', () => {
  const bonuses = [
    { date: '2026-03-15', amount: 50_000, type: 'annual' as const },
    { date: '2026-09-01', amount: 20_000, type: 'performance' as const },
    { date: '2026-06-10', amount: 40_000, type: 'holiday_pay' as const },
    { date: '2025-12-20', amount: 99_000, type: 'annual' as const },
  ];

  it('leaves bonuses out when the scheme bases OTP on fixed pay', () => {
    expect(otpPensionableIncome(600_000, bonuses, 2026, false)).toBe(600_000);
  });

  it('adds bonuses paid in the contribution year, not holiday pay or other years', () => {
    expect(otpPensionableIncome(600_000, bonuses, 2026, true)).toBe(670_000);
  });

  it('feeds the 12G cap: bonuses lift the base only up to 12G', () => {
    // 1.6M fixed + 70k bonus = 1.67M, above 12G (1,638,588 in 2026).
    const base = otpPensionableIncome(1_600_000, bonuses, 2026, true);
    expect(otpAnnualContribution(base, 5, 2026)).toBeCloseTo(81_929.4, 6);
  });

  it('ignores non-positive or NaN bonus amounts and a negative fixed gross', () => {
    const bad = [
      { date: '2026-01-01', amount: Number.NaN, type: 'annual' as const },
      { date: '2026-01-01', amount: -5_000, type: 'other' as const },
    ];
    expect(otpPensionableIncome(-1, bad, 2026, true)).toBe(0);
  });
});

describe('otpPensionableIncome — bad entries', () => {
  it('skips a bonus with no date instead of throwing', () => {
    const bad = [{ amount: 10_000, type: 'annual' as const } as unknown as { date: string; amount: number; type: 'annual' }];
    expect(otpPensionableIncome(500_000, bad, 2026, true)).toBe(500_000);
  });
});

describe('otpProjectedPensionableIncome', () => {
  const bonuses = [
    { date: '2025-03-01', amount: 40_000, type: 'annual' as const },
    { date: '2025-05-01', amount: 25_000, type: 'signing' as const },
    { date: '2025-06-01', amount: 30_000, type: 'holiday_pay' as const },
    { date: '2025-12-01', amount: 10_000, type: 'profit_share' as const },
    { date: '2026-02-01', amount: 200_000, type: 'annual' as const },
  ];

  it('is fixed pay alone with bonuses off', () => {
    expect(otpProjectedPensionableIncome(600_000, bonuses, 2026, false)).toBe(600_000);
  });

  it('adds last full year\'s bonuses, without signing bonuses or holiday pay, and ignores this year\'s', () => {
    expect(otpProjectedPensionableIncome(600_000, bonuses, 2026, true)).toBe(650_000);
  });
});

describe('otpBonusShareToDate', () => {
  const bonuses = [
    { date: '2026-03-10', amount: 100_000, type: 'annual' as const },
    { date: '2026-06-10', amount: 40_000, type: 'holiday_pay' as const },
    { date: '2026-09-10', amount: 60_000, type: 'performance' as const },
    { date: '2025-11-10', amount: 70_000, type: 'annual' as const },
  ];

  it('counts this year\'s bonuses dated up to the month, not holiday pay or other years', () => {
    expect(otpBonusShareToDate(600_000, bonuses, 5, '2026-02')).toBe(0);
    expect(otpBonusShareToDate(600_000, bonuses, 5, '2026-03')).toBe(5_000);
    expect(otpBonusShareToDate(600_000, bonuses, 5, '2026-08')).toBe(5_000);
    expect(otpBonusShareToDate(600_000, bonuses, 5, '2026-12')).toBe(8_000);
  });

  it('only fills the room under 12G left by the full year\'s fixed pay', () => {
    // 2026 cap 1 638 588: fixed 1 600 000 leaves 38 588 of room.
    expect(otpBonusShareToDate(1_600_000, bonuses, 5, '2026-12')).toBeCloseTo(38_588 * 0.05, 6);
    expect(otpBonusShareToDate(2_000_000, bonuses, 5, '2026-12')).toBe(0);
  });

  it('plus twelve fixed twelfths gives the capped yearly contribution', () => {
    const total = otpAnnualContribution(1_600_000, 5, 2026) + otpBonusShareToDate(1_600_000, bonuses, 5, '2026-12');
    expect(total).toBeCloseTo(otpAnnualContribution(otpPensionableIncome(1_600_000, bonuses, 2026, true), 5, 2026), 6);
  });
});
