import { describe, it, expect } from 'vitest';
import { retirementIncomeInTodaysKroner } from './retirementIncome';

describe('retirementIncomeInTodaysKroner', () => {
  const base = {
    folketrygdAnnual: 250_000,
    afpAnnual: 50_000,
    otpAnnualPayout: 120_000,
    ipsAnnualPayout: 30_000,
    yearsToRetire: 25,
    inflationPct: 3,
  };

  it('discounts OTP/IPS but leaves folketrygd and AFP at today\'s G', () => {
    const r = retirementIncomeInTodaysKroner(base);
    const factor = Math.pow(1.03, 25);
    expect(r.folketrygd).toBe(250_000);
    expect(r.afp).toBe(50_000);
    expect(r.otp).toBeCloseTo(120_000 / factor, 6);
    expect(r.ips).toBeCloseTo(30_000 / factor, 6);
    // 300,000 + 150,000 / 2.0938 = 371,641, not the nominal mix of 450,000.
    expect(r.gross).toBeCloseTo(300_000 + 150_000 / factor, 6);
    expect(Math.round(r.gross)).toBe(371_641);
  });

  it('is the plain sum with no years left', () => {
    expect(retirementIncomeInTodaysKroner({ ...base, yearsToRetire: 0 }).gross).toBe(450_000);
  });
});
