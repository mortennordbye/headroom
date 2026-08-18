import { describe, it, expect } from 'vitest';
import { migrateSavingsAccounts, migrateSnapshotSavings, partitionSavings, mergeStoredSavings } from './savingsMigration';
import type { Assets, BalanceSnapshot, FixedExpense, Saving } from '../context/FinanceContext';

const base: Assets = {
  portfolio: 0, unrealizedGain: 0, taxRate: 30, bsu: 0, bsuAnnualContribution: 0, savings: 0, savingsAccounts: [],
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

describe('partitionSavings', () => {
  // A stored row from before the split: it may carry any of the savings-only
  // fields, which no longer exist on `FixedExpense`.
  const row = (over: Record<string, unknown>): FixedExpense =>
    ({ id: 'x', name: 'x', amount: 100, ...over }) as FixedExpense;

  it('files a savings destination stored as a spending type under savings', () => {
    const { expenses, savings } = partitionSavings([
      row({ id: 'a', name: 'Aksjer og fond', amount: 13444, type: 'fixed', destinationKind: 'portfolio' }),
      row({ id: 'b', name: 'Ferie/Gaver', amount: 500, type: 'fixed', destinationKind: 'savingsAccount', savingsAccountId: 's1' }),
    ]);
    expect(expenses).toEqual([]);
    expect(savings.map(s => s.id)).toEqual(['a', 'b']);
    expect(savings[1]).toMatchObject({
      id: 'b', name: 'Ferie/Gaver', amount: 500, destinationKind: 'savingsAccount', savingsAccountId: 's1',
    });
  });

  it('covers every savings destination, and no others', () => {
    for (const k of ['savingsAccount', 'bufferAccount', 'portfolio', 'bsu'] as const) {
      expect(partitionSavings([row({ type: 'fixed', destinationKind: k })]).savings).toHaveLength(1);
    }
    // A paydown is not a saving: a FixedExpense holds the gross payment, most of
    // which is interest, so filing it as retained would overstate the rate.
    for (const k of ['mortgage', 'debt'] as const) {
      const out = partitionSavings([row({ type: 'fixed', destinationKind: k })]);
      expect(out.savings).toEqual([]);
      expect(out.expenses[0].destinationKind).toBe(k);
    }
  });

  it('keeps an ordinary expense and an untyped legacy row as expenses', () => {
    const { expenses, savings } = partitionSavings([
      row({ id: 'p', type: 'subscription' }),
      row({ id: 'l' }),
    ]);
    expect(savings).toEqual([]);
    expect(expenses.map(e => e.id)).toEqual(['p', 'l']);
    expect(expenses[0].type).toBe('subscription');
    expect(expenses[1].type).toBeUndefined();
  });

  it('files a row typed saving with no destination under the portfolio', () => {
    const { savings } = partitionSavings([row({ type: 'saving' })]);
    expect(savings[0].destinationKind).toBe('portfolio');
  });

  it('translates the sizing fields onto mode/percent', () => {
    const [pct] = partitionSavings([row({ destinationKind: 'portfolio', amountPercent: 12.5 })]).savings;
    expect(pct).toMatchObject({ mode: 'percent', percent: 12.5 });
    const [rest] = partitionSavings([row({ destinationKind: 'portfolio', amountRest: true })]).savings;
    expect(rest).toMatchObject({ mode: 'rest' });
    expect(rest.percent).toBeUndefined();
    const [amt] = partitionSavings([row({ destinationKind: 'portfolio' })]).savings;
    expect(amt).toMatchObject({ mode: 'amount' });
    // 'rest' wins over a stray percentage, matching the old isPercentSavings guard.
    const [both] = partitionSavings([row({ destinationKind: 'bsu', amountRest: true, amountPercent: 9 })]).savings;
    expect(both.mode).toBe('rest');
  });

  it('carries the pause flag and the buffer-builder target across', () => {
    const [sv] = partitionSavings([
      row({ destinationKind: 'bufferAccount', automationPaused: true, bufferTargetAmount: 90000, lastPostedMonth: '2026-05' }),
    ]).savings;
    expect(sv).toMatchObject({ paused: true, bufferTargetAmount: 90000, lastPostedMonth: '2026-05' });
  });

  it('strips savings-only fields off a row that stays an expense', () => {
    const [e] = partitionSavings([
      row({ type: 'fixed', amountPercent: 20, savingsAccountId: 's1', bufferTargetAmount: 1000 }),
    ]).expenses;
    expect(e).not.toHaveProperty('amountPercent');
    expect(e).not.toHaveProperty('savingsAccountId');
    expect(e).not.toHaveProperty('bufferTargetAmount');
  });

  it('is idempotent — the expense half holds no savings left to extract', () => {
    const input = [
      row({ id: 'a', type: 'saving', destinationKind: 'portfolio' }),
      row({ id: 'b', type: 'fixed' }),
    ];
    const once = partitionSavings(input);
    const twice = partitionSavings(once.expenses);
    expect(twice.savings).toEqual([]);
    expect(twice.expenses).toEqual(once.expenses);
  });

  // The invariant the whole migration rests on: a row lands in exactly one array
  // with its amount untouched, so every total built from expenses + savings is
  // the same number it was before the split.
  it('moves no money — the two halves sum to the input', () => {
    const input = [
      row({ id: 'a', amount: 16500, type: 'fixed' }),
      row({ id: 'b', amount: 13444, type: 'fixed', destinationKind: 'portfolio' }),
      row({ id: 'c', amount: 500, type: 'saving', destinationKind: 'savingsAccount', savingsAccountId: 's1' }),
      row({ id: 'd', amount: 3200, type: 'fixed', destinationKind: 'mortgage' }),
      row({ id: 'e', amount: 650, type: 'insurance' }),
    ];
    const { expenses, savings } = partitionSavings(input);
    const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);
    expect(expenses.length + savings.length).toBe(input.length);
    expect(sum(expenses) + sum(savings)).toBe(sum(input));
    // And each id appears exactly once across the two.
    expect([...expenses, ...savings].map(r => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('mergeStoredSavings', () => {
  it('concatenates an already-split savings array with anything still inline', () => {
    const stored: Saving[] = [{ id: 's1', name: 'Buffer', amount: 2000, destinationKind: 'bufferAccount' }];
    const inline = [{ id: 'x', name: 'Fond', amount: 900, type: 'saving', destinationKind: 'portfolio' } as unknown as FixedExpense];
    expect(mergeStoredSavings(stored, inline).map(s => s.id)).toEqual(['s1', 'x']);
  });

  it('handles either side being absent', () => {
    expect(mergeStoredSavings(undefined, undefined)).toEqual([]);
    expect(mergeStoredSavings([], [])).toEqual([]);
  });
});
