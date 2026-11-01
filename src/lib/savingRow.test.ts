import { describe, it, expect } from 'vitest';
import { savingRow, vehicleBalance, balanceAssetsForMonth, goalNamesLabel, type VehicleAssets } from './savingRow';
import type { Goal, Saving } from '../context/FinanceContext';

const goal = (over: Partial<Goal>): Goal => ({ id: 'g1', name: 'Trip', target: 30000, source: 'savingsAccount', ...over });

const live: VehicleAssets = {
  savingsAccounts: [{ id: 'a1', name: 'Trip', balance: 1200 }, { id: 'a2', name: 'Bad', balance: NaN }],
  bufferAccount: 5000,
  bsu: 0,
  portfolio: 80000,
};

const toAccount = (id?: string): Pick<Saving, 'destinationKind' | 'savingsAccountId'> =>
  ({ destinationKind: 'savingsAccount', savingsAccountId: id });

describe('savingRow kind', () => {
  it('marks a savings account a goal is funded from as a goal pot', () => {
    const g = goal({ savingsAccountId: 'a1' });
    const row = savingRow(toAccount('a1'), [g], live, live);
    expect(row.kind).toBe('goal');
    expect(row.goals).toEqual([g]);
    expect(row.account?.name).toBe('Trip');
  });

  it('lists every goal funded from the same account', () => {
    const goals = [goal({ savingsAccountId: 'a1' }), goal({ id: 'g2', name: 'Car', savingsAccountId: 'a1' })];
    expect(savingRow(toAccount('a1'), goals, live, live).goals.map(g => g.id)).toEqual(['g1', 'g2']);
  });

  it('treats an unlinked savings account as a plain account', () => {
    const goals = [goal({ savingsAccountId: 'other' }), goal({ id: 'g2', source: 'manual', savingsAccountId: 'a1' })];
    expect(savingRow(toAccount('a1'), goals, live, live).kind).toBe('account');
  });

  it('does not call a deleted account a goal pot, even when a goal still points at it', () => {
    const row = savingRow(toAccount('gone'), [goal({ savingsAccountId: 'gone' })], live, live);
    expect(row).toEqual({ kind: 'account', goals: [], accountMissing: true, balance: null });
    expect(savingRow(toAccount(undefined), [], live, live).accountMissing).toBe(true);
  });

  it('keeps scalar-source goals off the single-balance rows', () => {
    const goals = [goal({ source: 'bsu' }), goal({ source: 'portfolio' }), goal({ source: 'bufferAccount' })];
    expect(savingRow({ destinationKind: 'bufferAccount' }, goals, live, live)).toMatchObject({ kind: 'buffer', goals: [] });
    expect(savingRow({ destinationKind: 'bsu' }, goals, live, live)).toMatchObject({ kind: 'bsu', goals: [] });
    expect(savingRow({ destinationKind: 'portfolio' }, goals, live, live)).toMatchObject({ kind: 'invested', goals: [] });
  });

  it('falls back to a neutral account row for an unknown kind', () => {
    const odd = { destinationKind: 'crypto' } as unknown as Saving;
    expect(savingRow(odd, [], live, live)).toEqual({ kind: 'account', goals: [], accountMissing: false, balance: null });
  });
});

describe('savingRow balance', () => {
  it('reads the balance of each destination', () => {
    expect(savingRow(toAccount('a1'), [], live, live).balance).toBe(1200);
    expect(savingRow({ destinationKind: 'bufferAccount' }, [], live, live).balance).toBe(5000);
    expect(savingRow({ destinationKind: 'bsu' }, [], live, live).balance).toBe(0);
    expect(savingRow({ destinationKind: 'portfolio' }, [], live, live).balance).toBe(80000);
  });

  it('is null for a non-finite balance or when no month assets apply', () => {
    expect(savingRow(toAccount('a2'), [], live, live).balance).toBeNull();
    expect(savingRow({ destinationKind: 'portfolio' }, [], live, null).balance).toBeNull();
    expect(savingRow(toAccount('a1'), [], live, null).balance).toBeNull();
  });

  it('reads a past month from that month’s assets, not live state', () => {
    const past: VehicleAssets = { savingsAccounts: [{ id: 'a1', name: 'Trip', balance: 400 }], bufferAccount: 1000, bsu: 0, portfolio: 0 };
    expect(savingRow(toAccount('a1'), [], live, past).balance).toBe(400);
    expect(savingRow({ destinationKind: 'bufferAccount' }, [], live, past).balance).toBe(1000);
    // Account opened after that month: no balance then.
    expect(savingRow(toAccount('a1'), [], live, { ...past, savingsAccounts: [] }).balance).toBeNull();
  });
});

describe('vehicleBalance', () => {
  it('guards a missing or non-finite figure', () => {
    expect(vehicleBalance('savingsAccount', 'a1', live)).toBe(1200);
    expect(vehicleBalance('savingsAccount', 'a2', live)).toBeNull();
    expect(vehicleBalance('savingsAccount', 'a1', { ...live, savingsAccounts: undefined })).toBeNull();
    expect(vehicleBalance('portfolio', undefined, { ...live, portfolio: undefined as unknown as number })).toBeNull();
  });
});

describe('balanceAssetsForMonth', () => {
  const snap: VehicleAssets = { ...live, bufferAccount: 1 };
  const snapshots = { '2026-09': { assets: snap } };

  it('uses live assets for the current month', () => {
    expect(balanceAssetsForMonth('2026-11', '2026-11', live, snapshots)).toBe(live);
  });

  it('uses the snapshot for a past month, and nothing when there is none', () => {
    expect(balanceAssetsForMonth('2026-09', '2026-11', live, snapshots)).toBe(snap);
    expect(balanceAssetsForMonth('2026-10', '2026-11', live, snapshots)).toBeNull();
  });

  it('shows nothing for a future month', () => {
    expect(balanceAssetsForMonth('2026-12', '2026-11', live, { '2026-12': { assets: snap } })).toBeNull();
  });
});

describe('goalNamesLabel', () => {
  it('names one goal, or the first plus a count', () => {
    expect(goalNamesLabel([])).toBe('');
    expect(goalNamesLabel([{ name: 'Car' }])).toBe('Car');
    expect(goalNamesLabel([{ name: 'Car' }, { name: 'Trip' }, { name: 'Bike' }])).toBe('Car +2');
  });
});
