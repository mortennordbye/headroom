import { describe, it, expect } from 'vitest';
import { migrateSavingsAccounts, migrateSnapshotSavings } from './savingsMigration';
import type { Assets, BalanceSnapshot } from '../context/FinanceContext';

const base: Assets = {
  portfolio: 0, unrealizedGain: 0, taxRate: 30, bsu: 0, savings: 0, savingsAccounts: [],
  houseValue: 0, houseDebt: 0, crypto: 0, cryptoUnrealizedGain: 0, cryptoTaxRate: 22, bufferAccount: 0,
};

describe('migrateSavingsAccounts', () => {
  it('cleans a present array (valid id/name/number balance)', () => {
    const out = migrateSavingsAccounts({ ...base, savingsAccounts: [{ id: 'a', name: 'S', balance: 100 }] });
    expect(out).toEqual([{ id: 'a', name: 'S', balance: 100 }]);
  });

  it('coerces a comma-decimal string balance and back-fills a missing id/name', () => {
    const out = migrateSavingsAccounts({
      ...base,
      savingsAccounts: [{ balance: '1000,50' }] as unknown as Assets['savingsAccounts'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Sparekonto');
    expect(out[0].balance).toBeCloseTo(1000.5); // parseFloat on comma→dot
    expect(typeof out[0].id).toBe('string');
  });

  it('migrates a nonzero legacy scalar when the array is absent OR empty', () => {
    expect(migrateSavingsAccounts({ ...base, savings: 5000, savingsAccounts: [] }))
      .toEqual([{ id: expect.any(String), name: 'Sparekonto', balance: 5000 }]);
    expect(migrateSavingsAccounts({ ...base, savings: 5000, savingsAccounts: undefined as unknown as [] }))
      .toEqual([{ id: expect.any(String), name: 'Sparekonto', balance: 5000 }]);
  });

  it('returns [] when there is neither an array nor a positive scalar', () => {
    expect(migrateSavingsAccounts({ ...base, savings: 0, savingsAccounts: [] })).toEqual([]);
  });
});

describe('migrateSnapshotSavings', () => {
  it('zeroes the scalar and migrates savingsAccounts inside each snapshot, leaving the rest intact', () => {
    const snap = {
      assets: { ...base, savings: 3000, savingsAccounts: [] },
      housingMode: 'homeowner',
    } as unknown as BalanceSnapshot;
    const out = migrateSnapshotSavings({ '2026-01': snap });
    expect(out['2026-01'].assets.savings).toBe(0);
    expect(out['2026-01'].assets.savingsAccounts).toEqual([{ id: expect.any(String), name: 'Sparekonto', balance: 3000 }]);
    expect(out['2026-01'].housingMode).toBe('homeowner');
  });

  it('leaves a snapshot with no assets untouched', () => {
    const snap = { housingMode: 'first_buyer' } as unknown as BalanceSnapshot;
    const out = migrateSnapshotSavings({ '2026-01': snap });
    expect(out['2026-01']).toBe(snap);
  });
});
