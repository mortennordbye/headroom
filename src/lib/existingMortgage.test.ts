import { describe, it, expect } from 'vitest';
import { existingMortgage, annualMortgageInterest } from './existingMortgage';
import { calcAmortizationSchedule } from './calculations';

const HOMEOWNER = { currentMortgageBalance: 3000000, rente: 5.5, nedbetalingstid: 25 };
const TRANSITION = { currentMortgageBalance: 2000000 };
const yearOne = (balance: number, rate: number, years: number) =>
  calcAmortizationSchedule(balance, rate, years)[0].interestPaid;

describe('existingMortgage', () => {
  it('first_buyer owes nothing: the planned loan is not a debt yet', () => {
    const m = existingMortgage('first_buyer', HOMEOWNER, TRANSITION, 1);
    expect(m.balance).toBe(0);
    expect(annualMortgageInterest(m)).toBe(0);
  });

  it('a missing mode is first_buyer (the default)', () => {
    expect(annualMortgageInterest(existingMortgage(undefined, HOMEOWNER, TRANSITION, 1))).toBe(0);
  });

  it('homeowner: the current mortgage at its rate and term', () => {
    const m = existingMortgage('homeowner', HOMEOWNER, TRANSITION, 1);
    expect(m).toEqual({ balance: 3000000, ratePct: 5.5, termYears: 25 });
    expect(annualMortgageInterest(m)).toBeCloseTo(yearOne(3000000, 5.5, 25), 6);
  });

  it('transitioning: the current home loan, balance from the transition slice', () => {
    const m = existingMortgage('transitioning', HOMEOWNER, TRANSITION, 1);
    expect(m).toEqual({ balance: 2000000, ratePct: 5.5, termYears: 25 });
    expect(annualMortgageInterest(m)).toBeCloseTo(yearOne(2000000, 5.5, 25), 6);
  });

  it('transitioning without a transition slice falls back to the homeowner balance', () => {
    expect(existingMortgage('transitioning', HOMEOWNER, undefined, 1).balance).toBe(3000000);
  });

  it('takes the user\'s debt share in both modes that owe a mortgage', () => {
    expect(existingMortgage('homeowner', HOMEOWNER, TRANSITION, 0.5).balance).toBe(1500000);
    expect(existingMortgage('transitioning', HOMEOWNER, TRANSITION, 0.5).balance).toBe(1000000);
    const half = annualMortgageInterest(existingMortgage('homeowner', HOMEOWNER, TRANSITION, 0.5));
    expect(half).toBeCloseTo(yearOne(3000000, 5.5, 25) / 2, 6);
  });

  it('missing or broken fields give 0 interest, never NaN', () => {
    for (const m of [
      existingMortgage('homeowner', undefined, undefined, 1),
      existingMortgage('homeowner', { currentMortgageBalance: NaN, rente: 5, nedbetalingstid: 25 }, undefined, 1),
      existingMortgage('homeowner', { currentMortgageBalance: 1e6, rente: 0, nedbetalingstid: 25 }, undefined, 1),
      existingMortgage('homeowner', { currentMortgageBalance: 1e6, rente: 5, nedbetalingstid: 0 }, undefined, 1),
      existingMortgage('homeowner', { currentMortgageBalance: -5, rente: 5, nedbetalingstid: 25 }, undefined, 1),
      existingMortgage('homeowner', HOMEOWNER, undefined, NaN),
    ]) {
      expect(Number.isFinite(m.balance)).toBe(true);
      expect(annualMortgageInterest(m)).toBe(0);
    }
  });
});
