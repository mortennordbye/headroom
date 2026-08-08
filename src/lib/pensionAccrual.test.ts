import { describe, it, expect } from 'vitest';
import { pensionAccrualRules, isPensionRuleId, type PensionAccrualInput } from './pensionAccrual';

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

describe('isPensionRuleId', () => {
  it('recognises the two synthesized ids and nothing else', () => {
    expect(isPensionRuleId('pension:otp')).toBe(true);
    expect(isPensionRuleId('pension:ips')).toBe(true);
    expect(isPensionRuleId('some-expense-id')).toBe(false);
  });
});
