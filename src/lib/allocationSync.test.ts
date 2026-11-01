import { describe, it, expect } from 'vitest';
import { allocationSyncPlan } from './allocationSync';
import type { AllocationRow } from './savingsAllocation';
import type { FixedExpense, Saving } from '../context/FinanceContext';

const row = (p: Partial<AllocationRow> & Pick<AllocationRow, 'id' | 'amount' | 'destinationKind'>): AllocationRow =>
  ({ percent: 0, ...p });

const saving = (p: Partial<Saving> & Pick<Saving, 'id' | 'amount' | 'destinationKind'>): Saving =>
  ({ name: 'S', ...p });

describe('allocationSyncPlan', () => {
  it('rewrites the amount of a kr saving that drifted from its row', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'portfolio' })];
    const savings = [saving({ id: 's', amount: 2500, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' })];
    expect(allocationSyncPlan(rows, savings, [], 40000)).toEqual([
      { id: 's', kind: 'saving', rowId: 'a', field: 'amount', from: 2500, to: 3000 },
    ]);
  });

  it('rewrites the percent of a % saving to the share of the base its row now implies', () => {
    const rows = [row({ id: 'a', amount: 5000, destinationKind: 'bsu' })];
    const savings = [saving({ id: 's', amount: 4000, mode: 'percent', percent: 10, destinationKind: 'bsu', allocationId: 'a' })];
    expect(allocationSyncPlan(rows, savings, [], 40000)).toEqual([
      { id: 's', kind: 'saving', rowId: 'a', field: 'percent', from: 10, to: 12.5 },
    ]);
  });

  it('takes a % share of the base left after the paydown changes in the same sync', () => {
    const rows = [
      row({ id: 'a', amount: 3800, destinationKind: 'bsu' }),
      row({ id: 'm', amount: 2000, destinationKind: 'mortgage' }),
    ];
    const savings = [saving({ id: 's', amount: 0, mode: 'percent', percent: 1, destinationKind: 'bsu', allocationId: 'a' })];
    const expenses: FixedExpense[] = [{ id: 'e', name: 'M', amount: 0, destinationKind: 'mortgage', allocationId: 'm' }];
    // 40 000 base, 2 000 more paydown leaves 38 000; 3 800 of that is 10 %.
    expect(allocationSyncPlan(rows, savings, expenses, 40000)).toContainEqual(
      { id: 's', kind: 'saving', rowId: 'a', field: 'percent', from: 1, to: 10 },
    );
  });

  it('rewrites the amount of a mortgage or debt expense linked to its row', () => {
    const rows = [
      row({ id: 'm', amount: 2000, destinationKind: 'mortgage' }),
      row({ id: 'd', amount: 800, destinationKind: 'debt', debtId: 'debt-1' }),
    ];
    const expenses: FixedExpense[] = [
      { id: 'e1', name: 'M', amount: 1500, destinationKind: 'mortgage', allocationId: 'm' },
      { id: 'e2', name: 'D', amount: 800, destinationKind: 'debt', debtId: 'debt-1', allocationId: 'd' },
    ];
    expect(allocationSyncPlan(rows, [], expenses, 40000)).toEqual([
      { id: 'e1', kind: 'expense', rowId: 'm', field: 'amount', from: 1500, to: 2000 },
    ]);
  });

  it('never touches rows without an allocationId, even at the same destination', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'portfolio' })];
    const savings = [saving({ id: 's', amount: 100, mode: 'amount', destinationKind: 'portfolio' })];
    const expenses: FixedExpense[] = [{ id: 'e', name: 'M', amount: 1, destinationKind: 'mortgage' }];
    expect(allocationSyncPlan(rows, savings, expenses, 40000)).toEqual([]);
  });

  it('skips links to a deleted row and rows retargeted since activation', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'bsu' })];
    const savings = [
      saving({ id: 's1', amount: 100, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' }),
      saving({ id: 's2', amount: 100, mode: 'amount', destinationKind: 'portfolio', allocationId: 'gone' }),
    ];
    expect(allocationSyncPlan(rows, savings, [], 40000)).toEqual([]);
  });

  it('leaves rest savings alone and returns nothing when everything matches', () => {
    const rows = [
      row({ id: 'a', amount: 3000, destinationKind: 'portfolio' }),
      row({ id: 'b', amount: 4000, destinationKind: 'bsu', mode: 'rest' }),
    ];
    const savings = [
      saving({ id: 's1', amount: 3000, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' }),
      saving({ id: 's2', amount: 1, mode: 'rest', destinationKind: 'bsu', allocationId: 'b' }),
    ];
    expect(allocationSyncPlan(rows, savings, [], 40000)).toEqual([]);
  });

  it('skips a % saving when the base is zero (no share to take)', () => {
    const rows = [row({ id: 'a', amount: 5000, destinationKind: 'bsu' })];
    const savings = [saving({ id: 's', amount: 0, mode: 'percent', percent: 10, destinationKind: 'bsu', allocationId: 'a' })];
    expect(allocationSyncPlan(rows, savings, [], 0)).toEqual([]);
  });
});
