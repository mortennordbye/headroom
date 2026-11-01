import { describe, it, expect } from 'vitest';
import { pensionAccrualRules, isPensionRuleId, type PensionAccrualInput } from './pensionAccrual';
import { computeAutomationPostings } from './automation';

const LABELS = { otp: 'OTP', ips: 'IPS' };

const input = (over: Partial<PensionAccrualInput> = {}): PensionAccrualInput => ({
  otpAutoPost: true,
  ipsAutoPost: true,
  otpEmployerPct: 5,
  otpEmployeePct: 2,
  ipsAnnualContribution: 15_000,
  pensionableIncome: 600_000,
  currentMonth: '2026-07',
  ...over,
});

describe('pensionAccrualRules', () => {
  it('derives the OTP monthly amount from income × (employer + employee) %', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false }), LABELS);
    // 600 000 × 7% = 42 000/yr → 3 500/mo
    expect(otp.amount).toBe(3500);
    expect(otp.targetKind).toBe('pensionOtp');
    expect(otp.id).toBe('pension:otp');
  });

  it('caps the OTP base at 12G', () => {
    const [otp] = pensionAccrualRules(
      input({ ipsAutoPost: false, pensionableIncome: 2_000_000, otpEmployerPct: 5, otpEmployeePct: 0 }),
      LABELS,
    );
    // 12 × 136 549 × 5% = 81 929.4/yr
    expect(otp.amount).toBeCloseTo(81_929.4 / 12, 6);
  });

  it('derives the IPS monthly amount from the yearly contribution', () => {
    const [ips] = pensionAccrualRules(input({ otpAutoPost: false }), LABELS);
    expect(ips.amount).toBe(1250);            // 15 000 / 12
    expect(ips.targetKind).toBe('pensionIps');
  });

  it('emits both rules when both are enabled', () => {
    expect(pensionAccrualRules(input(), LABELS).map(r => r.id))
      .toEqual(['pension:otp', 'pension:ips']);
  });

  it('emits nothing when both toggles are off', () => {
    expect(pensionAccrualRules(input({ otpAutoPost: false, ipsAutoPost: false }), LABELS)).toEqual([]);
  });

  it('omits OTP when there is no salary yet, rather than posting a zero', () => {
    const rules = pensionAccrualRules(input({ pensionableIncome: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:ips']);
  });

  it('omits OTP when both percentages are zero', () => {
    const rules = pensionAccrualRules(input({ otpEmployerPct: 0, otpEmployeePct: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:ips']);
  });

  it('omits IPS when the yearly contribution is zero', () => {
    const rules = pensionAccrualRules(input({ ipsAnnualContribution: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:otp']);
  });

  it('carries the stored lastPostedMonth through as the double-apply guard', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false, otpLastPostedMonth: '2026-05' }), LABELS);
    expect(otp.lastPostedMonth).toBe('2026-05');
  });

  it('falls back to NEXT month when never posted, so it can never back-post a jump', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false }), LABELS);
    expect(otp.lastPostedMonth).toBeUndefined();
    expect(otp.startMonth).toBe('2026-08');
  });

  it('labels the rules for the catch-up prompt', () => {
    const rules = pensionAccrualRules(input(), LABELS);
    expect(rules.map(r => r.name)).toEqual(['OTP', 'IPS']);
  });
});

describe('pensionAccrualRules — OTP bonuses', () => {
  const bonuses = [
    { date: '2026-06-20', amount: 100_000, type: 'annual' as const },
    { date: '2026-09-15', amount: 50_000, type: 'performance' as const },
  ];
  const otpRule = (over: Partial<PensionAccrualInput>) =>
    pensionAccrualRules(input({ ipsAutoPost: false, bonuses, ...over }), LABELS)[0];
  const post = (over: Partial<PensionAccrualInput>, month: string) =>
    computeAutomationPostings([otpRule(over)], {
      savings: {}, scalars: { bufferAccount: 0, portfolio: 0, bsu: 0, pensionOtp: 0, pensionIps: 0 },
      mortgage: 0, mortgageRate: 0, debts: {}, housingMode: 'homeowner',
    }, month)[0];

  it('posts the bonus share in the month the bonus is dated, with the toggle on', () => {
    const rule = otpRule({ otpIncludesBonuses: true, otpLastPostedMonth: '2026-05', currentMonth: '2026-07' });
    expect(rule.amount).toBe(3500);                       // 600 000 × 7% / 12
    expect(rule.amountByMonth).toEqual({ '2026-06': 3500 + 7000 }); // + 100 000 × 7%
    expect(post({ otpIncludesBonuses: true, otpLastPostedMonth: '2026-05', currentMonth: '2026-07' }, '2026-07').newBalance)
      .toBe(3500 + 10_500);
  });

  it('posts no bonus with the toggle off, and none for a bonus dated after the month', () => {
    expect(otpRule({ otpLastPostedMonth: '2026-05' }).amountByMonth).toBeUndefined();
    // September's bonus is not in a July window.
    const rule = otpRule({ otpIncludesBonuses: true, otpLastPostedMonth: '2026-06', currentMonth: '2026-07' });
    expect(rule.amountByMonth).toBeUndefined();
  });

  it('never posts a bonus twice: months the stamp covers are outside the window', () => {
    const rule = otpRule({ otpIncludesBonuses: true, otpLastPostedMonth: '2026-06', currentMonth: '2026-09' });
    expect(rule.amountByMonth).toEqual({ '2026-09': 3500 + 3500 });
    expect(post({ otpIncludesBonuses: true, otpLastPostedMonth: '2026-06', currentMonth: '2026-09' }, '2026-09').newBalance)
      .toBe(3 * 3500 + 3500);
  });

  it('keeps the 12G cap across the year: a bonus only fills the room under 12G', () => {
    // 2026 cap 1 638 588. Fixed 1 600 000 leaves 38 588 of room; the June bonus
    // uses all of it, the September one gets nothing.
    const over = { otpIncludesBonuses: true, pensionableIncome: 1_600_000, otpEmployerPct: 5, otpEmployeePct: 0,
      otpLastPostedMonth: '2025-12', currentMonth: '2026-12' };
    const rule = otpRule(over);
    expect(rule.amountByMonth?.['2026-06']).toBeCloseTo(80_000 / 12 + 38_588 * 0.05, 6);
    expect(rule.amountByMonth?.['2026-09']).toBeUndefined();
    // Twelve months sum to 5% of 12G.
    expect(post(over, '2026-12').newBalance).toBe(Math.round(81_929.4));
  });

  it('prices each month of a catch-up across New Year on its own year', () => {
    const rule = otpRule({ pensionableIncome: 2_000_000, otpEmployerPct: 5, otpEmployeePct: 0,
      bonuses: [], otpLastPostedMonth: '2025-11', currentMonth: '2026-01' });
    expect(rule.amount).toBeCloseTo(12 * 136_549 * 0.05 / 12, 6);
    expect(rule.amountByMonth).toEqual({ '2025-12': 12 * 130_160 * 0.05 / 12 });
  });
});

describe('isPensionRuleId', () => {
  it('recognises the two synthesized ids and nothing else', () => {
    expect(isPensionRuleId('pension:otp')).toBe(true);
    expect(isPensionRuleId('pension:ips')).toBe(true);
    expect(isPensionRuleId('some-expense-id')).toBe(false);
  });
});
