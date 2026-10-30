import { describe, it, expect } from 'vitest';
import { currentMortgage, annualMortgageInterest } from './existingMortgage';
import { calcAmortizationSchedule } from './calculations';
import { PLACEHOLDER_MORTGAGE_BALANCE } from './mortgageSlices';

const NOW = '2026-10';
const ASSETS = { houseDebt: 2_000_000 };
const HOMEOWNER = {
  currentMortgageBalance: 2_000_000, rente: 5, nedbetalingstid: 25,
  nedbetalingstidAsOf: '2026-01', currentMortgageBalanceAsOf: '2026-01',
};
const TRANSITION = { currentMortgageBalance: 2_000_000 };
const yearOne = (balance: number, rate: number, years: number) =>
  calcAmortizationSchedule(balance, rate, years)[0].interestPaid;

describe('currentMortgage', () => {
  it('homeowner: the current loan, priced over the term as of the balance date', () => {
    expect(currentMortgage('homeowner', ASSETS, HOMEOWNER, TRANSITION, NOW)).toEqual({
      fullBalance: 2_000_000, balance: 2_000_000, ratePct: 5,
      paymentTermMonths: 300, remainingMonths: 291, balanceAsOf: '2026-01', amortises: true,
    });
  });

  it('transitioning: the same current loan, rate and term from the homeowner slice', () => {
    expect(currentMortgage('transitioning', ASSETS, HOMEOWNER, TRANSITION, NOW)).toEqual(
      currentMortgage('homeowner', ASSETS, HOMEOWNER, TRANSITION, NOW),
    );
  });

  it('first_buyer: the Assets debt, held flat, with no rate or term', () => {
    expect(currentMortgage('first_buyer', { houseDebt: 1_500_000 }, HOMEOWNER, TRANSITION, NOW)).toEqual({
      fullBalance: 1_500_000, balance: 1_500_000, ratePct: 0,
      paymentTermMonths: 0, remainingMonths: 0, balanceAsOf: null, amortises: false,
    });
    expect(currentMortgage(undefined, { houseDebt: 1_500_000 }, HOMEOWNER, TRANSITION, NOW).amortises).toBe(false);
  });

  it('drifted slices: the active mode wins, as on load', () => {
    const assets = { houseDebt: 3_400_000 };
    const h = { ...HOMEOWNER, currentMortgageBalance: 3_200_000 };
    const tr = { currentMortgageBalance: 3_100_000 };
    expect(currentMortgage('homeowner', assets, h, tr, NOW).fullBalance).toBe(3_200_000);
    expect(currentMortgage('transitioning', assets, h, tr, NOW).fullBalance).toBe(3_100_000);
    expect(currentMortgage('first_buyer', assets, h, tr, NOW).fullBalance).toBe(3_400_000);
  });

  it('placeholder defaults never win over the Assets debt', () => {
    const h = { currentMortgageBalance: PLACEHOLDER_MORTGAGE_BALANCE, rente: 5.5, nedbetalingstid: 25 };
    const tr = { currentMortgageBalance: PLACEHOLDER_MORTGAGE_BALANCE };
    expect(currentMortgage('homeowner', { houseDebt: 0 }, h, tr, NOW).fullBalance).toBe(0);
    expect(currentMortgage('transitioning', { houseDebt: 1_000_000 }, h, tr, NOW).fullBalance).toBe(1_000_000);
  });

  it('an old blob without stamps: the balance counts as of the month asked about', () => {
    const h = { currentMortgageBalance: 2_000_000, rente: 5, nedbetalingstid: 20 };
    const m = currentMortgage('homeowner', { houseDebt: 2_000_000 }, h, undefined, NOW);
    expect(m).toMatchObject({ fullBalance: 2_000_000, paymentTermMonths: 240, remainingMonths: 240, balanceAsOf: NOW });
  });

  it('a balance entered 12 months ago is priced over the term it had then, not rolled forward', () => {
    const h = { ...HOMEOWNER, nedbetalingstidAsOf: '2025-10', currentMortgageBalanceAsOf: '2025-10' };
    const m = currentMortgage('homeowner', ASSETS, h, TRANSITION, NOW);
    expect(m.fullBalance).toBe(2_000_000);
    expect(m.paymentTermMonths).toBe(300);
    expect(m.remainingMonths).toBe(288);
  });

  it('the share is read at the month asked about', () => {
    const assets = { houseDebt: 2_000_000, coOwners: [{ id: 'c', name: 'S', ownershipPct: 50, since: '2026-06' }] };
    expect(currentMortgage('homeowner', assets, HOMEOWNER, TRANSITION, NOW).balance).toBe(1_000_000);
    expect(currentMortgage('homeowner', assets, HOMEOWNER, TRANSITION, '2026-05').balance).toBe(2_000_000);
    expect(currentMortgage('homeowner', assets, HOMEOWNER, TRANSITION, NOW).fullBalance).toBe(2_000_000);
  });

  it('missing or broken fields give finite numbers, never NaN', () => {
    for (const m of [
      currentMortgage('homeowner', undefined, undefined, undefined, NOW),
      currentMortgage('homeowner', { houseDebt: NaN }, { currentMortgageBalance: NaN, rente: NaN }, undefined, NOW),
      currentMortgage('transitioning', null, null, null, NOW),
      currentMortgage('homeowner', { houseDebt: -5 }, { currentMortgageBalance: -5, rente: 5, nedbetalingstid: 25 }, undefined, NOW),
    ]) {
      for (const v of [m.fullBalance, m.balance, m.ratePct, m.paymentTermMonths, m.remainingMonths]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(annualMortgageInterest(m)).toBe(0);
    }
  });
});

describe('annualMortgageInterest', () => {
  it('year-one interest on the share, in both owner modes', () => {
    for (const mode of ['homeowner', 'transitioning'] as const) {
      expect(annualMortgageInterest(currentMortgage(mode, ASSETS, HOMEOWNER, TRANSITION, NOW)))
        .toBeCloseTo(yearOne(2_000_000, 5, 25), 6);
    }
    const half = { ...ASSETS, coOwners: [{ id: 'c', name: 'S', ownershipPct: 50 }] };
    expect(annualMortgageInterest(currentMortgage('homeowner', half, HOMEOWNER, TRANSITION, NOW)))
      .toBeCloseTo(yearOne(2_000_000, 5, 25) / 2, 6);
  });

  it('none for a first buyer, even with debt on Assets', () => {
    expect(annualMortgageInterest(currentMortgage('first_buyer', ASSETS, HOMEOWNER, TRANSITION, NOW))).toBe(0);
  });
});
