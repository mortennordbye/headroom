import { describe, it, expect } from 'vitest';
import { migrateMortgageBalance, migrateImportedMortgage, type MortgageSliceFields } from './mortgageSlices';
import type { HousingMode } from '../context/FinanceContext';

const NOW = '2026-10';
// The old homeowner/transition default, read only in legacy data.
const P = 3_000_000;

/** A legacy blob holding the balance in all three slices. */
function legacy(mode: HousingMode, houseDebt: number, homeowner: number, transition: number, asOf?: string): MortgageSliceFields {
  return {
    housingMode: mode,
    assets: { houseDebt },
    homeowner: { currentMortgageBalance: homeowner, ...(asOf ? { currentMortgageBalanceAsOf: asOf } : {}) },
    transition: { currentMortgageBalance: transition },
  };
}

/** The balance ended up on assets.houseDebt and the old copies are gone. */
function expectMigrated(d: MortgageSliceFields, balance: number) {
  expect(d.assets?.houseDebt).toBe(balance);
  if (d.homeowner) expect(d.homeowner).not.toHaveProperty('currentMortgageBalance');
  if (d.transition) expect(d.transition).not.toHaveProperty('currentMortgageBalance');
}

describe('migrateMortgageBalance: drifted legacy blobs, the active mode wins', () => {
  it('homeowner: the homeowner slice wins', () => {
    const out = migrateMortgageBalance(legacy('homeowner', 3_400_000, 3_200_000, 3_100_000, '2026-01'), NOW);
    expectMigrated(out, 3_200_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe('2026-01');
  });

  it('transitioning: the transition slice wins', () => {
    expectMigrated(migrateMortgageBalance(legacy('transitioning', 3_400_000, 3_200_000, 3_100_000, '2026-01'), NOW), 3_100_000);
  });

  it('first_buyer: assets.houseDebt wins, and no balance date is stamped', () => {
    const out = migrateMortgageBalance(legacy('first_buyer', 3_400_000, 3_200_000, 3_100_000), NOW);
    expectMigrated(out, 3_400_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBeUndefined();
  });

  it('a missing mode reads as first_buyer', () => {
    const d = legacy('first_buyer', 1_000_000, 2_000_000, 2_000_000);
    delete d.housingMode;
    expectMigrated(migrateMortgageBalance(d, NOW), 1_000_000);
  });

  it('keeps the other fields of each slice', () => {
    const d = {
      housingMode: 'homeowner' as const,
      assets: { houseDebt: 1, houseValue: 5 },
      homeowner: { currentMortgageBalance: 2, currentMortgageBalanceAsOf: '2026-01', rente: 4 },
      transition: { currentMortgageBalance: 3, currentHouseValue: 5 },
      other: 'x',
    };
    expect(migrateMortgageBalance(d, NOW)).toEqual({
      housingMode: 'homeowner',
      assets: { houseDebt: 2, houseValue: 5 },
      homeowner: { currentMortgageBalanceAsOf: '2026-01', rente: 4 },
      transition: { currentHouseValue: 5 },
      other: 'x',
    });
  });
});

describe('migrateMortgageBalance: the untouched legacy placeholder never wins', () => {
  it('homeowner with the unstamped placeholder: assets.houseDebt wins and the date is stamped', () => {
    const out = migrateMortgageBalance(legacy('homeowner', 2_000_000, P, P), NOW);
    expectMigrated(out, 2_000_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('transitioning with the unstamped placeholder: assets.houseDebt wins', () => {
    expectMigrated(migrateMortgageBalance(legacy('transitioning', 2_000_000, P, P), NOW), 2_000_000);
  });

  it('first_buyer with no house: 0', () => {
    expectMigrated(migrateMortgageBalance(legacy('first_buyer', 0, P, P), NOW), 0);
  });

  it('a stamped 3 000 000 is a real balance and wins', () => {
    expectMigrated(migrateMortgageBalance(legacy('homeowner', 0, P, P, '2026-05'), NOW), P);
  });

  // #218's stampLegacyTerm stamped the untouched placeholder too, so a stamp no
  // longer proves the placeholder was written. A different real value wins.
  it('transitioning, stamped homeowner placeholder: the real 2.5M on Assets survives', () => {
    expectMigrated(migrateMortgageBalance(legacy('transitioning', 2_500_000, P, P, '2026-06'), NOW), 2_500_000);
  });

  it('homeowner, stamped placeholder: the real 2.5M on Assets survives', () => {
    expectMigrated(migrateMortgageBalance(legacy('homeowner', 2_500_000, P, P, '2026-06'), NOW), 2_500_000);
  });

  it('transitioning: the transition placeholder is not made real by the homeowner stamp', () => {
    expectMigrated(migrateMortgageBalance(legacy('transitioning', 0, 2_200_000, P, '2026-06'), NOW), 2_200_000);
  });

  it('an active slice that is not the placeholder still wins over Assets', () => {
    expectMigrated(migrateMortgageBalance(legacy('transitioning', 2_500_000, P, 2_400_000, '2026-06'), NOW), 2_400_000);
  });
});

describe('migrateMortgageBalance: current-shape data', () => {
  it('a loan of exactly 3 000 000 is kept as entered', () => {
    const d = { housingMode: 'homeowner' as const, assets: { houseDebt: P }, homeowner: { currentMortgageBalanceAsOf: '2026-05' } };
    expect(migrateMortgageBalance(d, NOW)).toBe(d);
  });

  it.each<[HousingMode, string | undefined]>([
    ['homeowner', '2026-05'],
    ['transitioning', '2026-05'],
    ['first_buyer', undefined],
  ])('%s: comes back as the same object', (mode, asOf) => {
    const d = { housingMode: mode, assets: { houseDebt: 2_500_000 }, homeowner: asOf ? { currentMortgageBalanceAsOf: asOf } : {}, transition: { currentHouseValue: 1 } };
    expect(migrateMortgageBalance(d, NOW)).toBe(d);
  });

  it('an owner mode without a balance date gets one (as on a mode switch)', () => {
    const d: MortgageSliceFields = { housingMode: 'transitioning', assets: { houseDebt: 1 }, homeowner: {} };
    const out = migrateMortgageBalance(d, NOW);
    expect(out).not.toBe(d);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('leaves absent slices absent', () => {
    const d = { housingMode: 'homeowner' as const, assets: { houseDebt: 7 } };
    expect(migrateMortgageBalance(d, NOW)).toBe(d);
  });
});

describe('migrateMortgageBalance: idempotence', () => {
  it.each<HousingMode>(['homeowner', 'transitioning', 'first_buyer'])('%s: a second pass returns the same object', (mode) => {
    for (const d of [legacy(mode, 3_400_000, 3_200_000, 3_100_000), legacy(mode, 0, P, P), legacy(mode, 1, 2, 3, '2026-01')]) {
      const once = migrateMortgageBalance(d, NOW);
      expect(migrateMortgageBalance(once, NOW)).toBe(once);
    }
  });

  it('survives a JSON round-trip: a migrated blob reloads unchanged', () => {
    const once = migrateMortgageBalance(legacy('transitioning', 3_400_000, 3_200_000, 3_100_000), NOW);
    const reloaded = JSON.parse(JSON.stringify(once)) as MortgageSliceFields;
    expect(migrateMortgageBalance(reloaded, '2027-03')).toBe(reloaded);
    expect(reloaded).toEqual(once);
  });
});

describe('migrateMortgageBalance: malformed input', () => {
  it('a negative balance clamps to 0', () => {
    expectMigrated(migrateMortgageBalance(legacy('homeowner', 1_000_000, -5, -5, '2026-01'), NOW), 0);
    expectMigrated(migrateMortgageBalance(legacy('first_buyer', -9, P, P), NOW), 0);
  });

  it.each<[unknown]>([['2026'], ['2026-13'], ['2026-06-01'], [202606], ['garbage']])('%s is not a balance date', (asOf) => {
    const d = legacy('homeowner', 0, P, P);
    (d.homeowner as Record<string, unknown>).currentMortgageBalanceAsOf = asOf;
    const out = migrateMortgageBalance(d, NOW);
    expectMigrated(out, 0);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('an unknown housing mode reads as first_buyer', () => {
    const d = { ...legacy('first_buyer', 1_000_000, 2_000_000, 2_000_000), housingMode: 'renter' as unknown as HousingMode };
    const out = migrateMortgageBalance(d, NOW);
    expectMigrated(out, 1_000_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBeUndefined();
  });

  it('homeowner with no Assets and only the placeholder: no debt is created', () => {
    const d: MortgageSliceFields = {
      housingMode: 'homeowner', homeowner: { currentMortgageBalance: P }, transition: { currentMortgageBalance: P },
    };
    const out = migrateMortgageBalance(d, NOW);
    expect(out.assets).toBeUndefined();
    expect(out.homeowner).toEqual({ currentMortgageBalanceAsOf: NOW });
    expect(out.transition).toEqual({});
  });

  it('homeowner with no Assets and a real balance: the balance moves onto assets', () => {
    const d: MortgageSliceFields = { housingMode: 'homeowner', homeowner: { currentMortgageBalance: 2_100_000 } };
    const out = migrateMortgageBalance(d, NOW);
    expect(out.assets).toEqual({ houseDebt: 2_100_000 });
    expect(out.homeowner).toEqual({ currentMortgageBalanceAsOf: NOW });
  });
});

describe('migrateImportedMortgage: an imported balance takes precedence', () => {
  const current: MortgageSliceFields = {
    housingMode: 'homeowner',
    assets: { houseDebt: 2_000_000 },
    homeowner: { currentMortgageBalanceAsOf: '2026-01' },
    transition: { currentHouseValue: 4_000_000 },
  };

  it('an assets-only import sets the balance and stamps it now', () => {
    const out = migrateImportedMortgage(current, { assets: { houseDebt: 1_500_000 } }, NOW);
    expectMigrated(out, 1_500_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe(NOW);
  });

  it('a current-shape import keeps its own balance date', () => {
    const out = migrateImportedMortgage(current, {
      assets: { houseDebt: 1_500_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-04' },
    }, NOW);
    expectMigrated(out, 1_500_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe('2026-04');
  });

  it('a legacy transition-only import moves the balance', () => {
    const out = migrateImportedMortgage(current, { transition: { currentMortgageBalance: 1_700_000 } }, NOW);
    expectMigrated(out, 1_700_000);
  });

  it('a legacy homeowner-only import moves the balance and keeps its date', () => {
    const out = migrateImportedMortgage(current, { homeowner: { currentMortgageBalance: 1_800_000, currentMortgageBalanceAsOf: '2026-03' } }, NOW);
    expectMigrated(out, 1_800_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe('2026-03');
  });

  it('an imported untouched placeholder does not overwrite the stored balance', () => {
    const out = migrateImportedMortgage(current, { homeowner: { currentMortgageBalance: P } }, NOW);
    expectMigrated(out, 2_000_000);
  });

  it('a full legacy import migrates on its own terms, with its own mode', () => {
    const out = migrateImportedMortgage(current, legacy('transitioning', 2_500_000, P, P, '2026-06'), NOW);
    expect(out.housingMode).toBe('transitioning');
    expectMigrated(out, 2_500_000);
  });

  it('an import without mortgage fields leaves the state as it is', () => {
    const out = migrateImportedMortgage(current, {}, NOW);
    expect(out).toEqual(current);
    expect(out.assets).toBe(current.assets);
    expect(out.homeowner).toBe(current.homeowner);
  });

  it('an imported homeowner slice without a balance keeps the current balance date', () => {
    const out = migrateImportedMortgage(current, { homeowner: { currentMortgageBalanceAsOf: '2025-02' } }, NOW);
    expectMigrated(out, 2_000_000);
    expect(out.homeowner?.currentMortgageBalanceAsOf).toBe('2026-01');
  });

  it('an imported assets slice without houseDebt keeps the current balance', () => {
    const out = migrateImportedMortgage(current, { assets: {} }, NOW);
    expectMigrated(out, 2_000_000);
  });

  it('an imported unknown mode keeps the current one', () => {
    const out = migrateImportedMortgage(current, { housingMode: 'renter' as unknown as HousingMode }, NOW);
    expect(out.housingMode).toBe('homeowner');
  });
});
