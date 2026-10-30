import { describe, it, expect } from 'vitest';
import { reconcileMortgageSlices, PLACEHOLDER_MORTGAGE_BALANCE, type MortgageSliceFields } from './mortgageSlices';
import type { HousingMode } from '../context/FinanceContext';

const NOW = '2026-10';
const P = PLACEHOLDER_MORTGAGE_BALANCE;

function blob(mode: HousingMode, houseDebt: number, homeowner: number, transition: number, asOf?: string): MortgageSliceFields {
  return {
    housingMode: mode,
    assets: { houseDebt },
    homeowner: { currentMortgageBalance: homeowner, ...(asOf ? { currentMortgageBalanceAsOf: asOf } : {}) },
    transition: { currentMortgageBalance: transition },
  };
}

const balances = (d: MortgageSliceFields) =>
  [d.assets?.houseDebt, d.homeowner?.currentMortgageBalance, d.transition?.currentMortgageBalance];

describe('reconcileMortgageSlices: drifted old blobs, the active mode wins', () => {
  it('homeowner: the homeowner slice wins', () => {
    const out = reconcileMortgageSlices(blob('homeowner', 3_400_000, 3_200_000, 3_100_000, '2026-01'), NOW);
    expect(balances(out)).toEqual([3_200_000, 3_200_000, 3_200_000]);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe('2026-01');
  });

  it('transitioning: the transition slice wins', () => {
    const out = reconcileMortgageSlices(blob('transitioning', 3_400_000, 3_200_000, 3_100_000, '2026-01'), NOW);
    expect(balances(out)).toEqual([3_100_000, 3_100_000, 3_100_000]);
  });

  it('first_buyer: assets.houseDebt wins, and no balance date is stamped', () => {
    const out = reconcileMortgageSlices(blob('first_buyer', 3_400_000, 3_200_000, 3_100_000), NOW);
    expect(balances(out)).toEqual([3_400_000, 3_400_000, 3_400_000]);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBeUndefined();
  });

  it('a missing mode reads as first_buyer', () => {
    const d = blob('first_buyer', 1_000_000, 2_000_000, 2_000_000);
    delete d.housingMode;
    expect(balances(reconcileMortgageSlices(d, NOW))).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });
});

describe('reconcileMortgageSlices: the untouched placeholder never wins', () => {
  it('homeowner with the unstamped placeholder: assets.houseDebt wins and the date is stamped', () => {
    const out = reconcileMortgageSlices(blob('homeowner', 2_000_000, P, P), NOW);
    expect(balances(out)).toEqual([2_000_000, 2_000_000, 2_000_000]);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('transitioning with the unstamped placeholder: assets.houseDebt wins', () => {
    const out = reconcileMortgageSlices(blob('transitioning', 2_000_000, P, P), NOW);
    expect(balances(out)).toEqual([2_000_000, 2_000_000, 2_000_000]);
  });

  it('first_buyer with no house: the placeholders drop to 0', () => {
    const out = reconcileMortgageSlices(blob('first_buyer', 0, P, P), NOW);
    expect(balances(out)).toEqual([0, 0, 0]);
  });

  it('a stamped 3 000 000 is a real balance and wins', () => {
    const out = reconcileMortgageSlices(blob('homeowner', 0, P, P, '2026-05'), NOW);
    expect(balances(out)).toEqual([P, P, P]);
  });
});

describe('reconcileMortgageSlices: agreeing blobs and idempotence', () => {
  it.each<[HousingMode, string | undefined]>([
    ['homeowner', '2026-05'],
    ['transitioning', '2026-05'],
    ['first_buyer', undefined],
  ])('%s: agreeing slices come back as the same object', (mode, asOf) => {
    const d = blob(mode, 2_500_000, 2_500_000, 2_500_000, asOf);
    expect(reconcileMortgageSlices(d, NOW)).toBe(d);
  });

  it('an owner mode without a balance date gets one even when the slices agree', () => {
    const d = blob('homeowner', 2_500_000, 2_500_000, 2_500_000);
    const out = reconcileMortgageSlices(d, NOW);
    expect(out).not.toBe(d);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it.each<HousingMode>(['homeowner', 'transitioning', 'first_buyer'])('%s: a second pass returns the same object', (mode) => {
    for (const d of [blob(mode, 3_400_000, 3_200_000, 3_100_000), blob(mode, 0, P, P), blob(mode, 1, 2, 3, '2026-01')]) {
      const once = reconcileMortgageSlices(d, NOW);
      expect(reconcileMortgageSlices(once, NOW)).toBe(once);
    }
  });

  it('survives a JSON round-trip: a reconciled blob reloads unchanged', () => {
    const once = reconcileMortgageSlices(blob('transitioning', 3_400_000, 3_200_000, 3_100_000), NOW);
    const reloaded = JSON.parse(JSON.stringify(once)) as MortgageSliceFields;
    expect(reconcileMortgageSlices(reloaded, '2027-03')).toBe(reloaded);
    expect(reloaded).toEqual(once);
  });

  it('keeps the other fields of each slice', () => {
    const d = {
      housingMode: 'homeowner' as const,
      assets: { houseDebt: 1, houseValue: 5 },
      homeowner: { currentMortgageBalance: 2, currentMortgageBalanceAsOf: '2026-01', rente: 4 },
      transition: { currentMortgageBalance: 3, currentHouseValue: 5 },
      other: 'x',
    };
    expect(reconcileMortgageSlices(d, NOW)).toEqual({
      housingMode: 'homeowner',
      assets: { houseDebt: 2, houseValue: 5 },
      homeowner: { currentMortgageBalance: 2, currentMortgageBalanceAsOf: '2026-01', rente: 4 },
      transition: { currentMortgageBalance: 2, currentHouseValue: 5 },
      other: 'x',
    });
  });

  it('leaves absent slices absent', () => {
    const out = reconcileMortgageSlices({ housingMode: 'homeowner', assets: { houseDebt: 7 } }, NOW);
    expect(out).toEqual({ housingMode: 'homeowner', assets: { houseDebt: 7 } });
  });
});

describe('switching housing mode (changeHousingMode runs the same reconcile)', () => {
  it('an untouched first buyer switching to homeowner gets no phantom 3 MNOK', () => {
    const out = reconcileMortgageSlices({ ...blob('first_buyer', 0, P, P), housingMode: 'homeowner' }, NOW);
    expect(balances(out)).toEqual([0, 0, 0]);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('an untouched first buyer switching to transitioning gets no phantom 3 MNOK', () => {
    const out = reconcileMortgageSlices({ ...blob('first_buyer', 0, P, P), housingMode: 'transitioning' }, NOW);
    expect(balances(out)).toEqual([0, 0, 0]);
  });

  it('a first buyer with a house on Assets carries that debt into homeowner', () => {
    const out = reconcileMortgageSlices({ ...blob('first_buyer', 2_400_000, P, P), housingMode: 'homeowner' }, NOW);
    expect(balances(out)).toEqual([2_400_000, 2_400_000, 2_400_000]);
  });

  it('a homeowner balance that was written is kept on the switch back to homeowner', () => {
    const out = reconcileMortgageSlices({ ...blob('first_buyer', 2_000_000, 2_100_000, 2_000_000, '2026-02'), housingMode: 'homeowner' }, NOW);
    expect(balances(out)).toEqual([2_100_000, 2_100_000, 2_100_000]);
  });
});
