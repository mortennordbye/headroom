import { describe, it, expect } from 'vitest';
import {
  resolveAllocation, isCreatableRow, destinationKey,
  type SavingsAllocation, type AllocationRow,
} from './savingsAllocation';

const alloc = (percent: number, over: Partial<SavingsAllocation> = {}): SavingsAllocation => ({
  id: `a-${percent}-${over.destinationKind ?? 'portfolio'}-${over.savingsAccountId ?? over.debtId ?? ''}`,
  percent,
  destinationKind: 'portfolio',
  ...over,
});

describe('resolveAllocation', () => {
  it('splits the target by percentage', () => {
    const plan = resolveAllocation(
      [alloc(50), alloc(30, { destinationKind: 'bufferAccount' }), alloc(20, { destinationKind: 'bsu' })],
      10_000,
    );
    expect(plan.rows.map(r => r.amount)).toEqual([5000, 3000, 2000]);
    expect(plan.totalPercent).toBe(100);
    expect(plan.remainder).toBe(0);
  });

  it('sums EXACTLY to the target when the split does not divide evenly', () => {
    // 3 × 33.333…% of 10 000 — independent rounding would give 3333×3 = 9999.
    const plan = resolveAllocation(
      [alloc(100 / 3), alloc(100 / 3, { destinationKind: 'bsu' }), alloc(100 / 3, { destinationKind: 'bufferAccount' })],
      10_000,
    );
    expect(plan.totalAmount).toBe(10_000);
    expect(plan.remainder).toBe(0);
    expect(plan.rows.map(r => r.amount).sort()).toEqual([3333, 3333, 3334]);
  });

  it('reports the unallocated remainder when the percentages fall short of 100', () => {
    const plan = resolveAllocation([alloc(60)], 10_000);
    expect(plan.rows[0].amount).toBe(6000);
    expect(plan.remainder).toBe(4000);
    expect(plan.overAllocated).toBe(false);
  });

  it('flags over-allocation above 100%', () => {
    const plan = resolveAllocation([alloc(70), alloc(50, { destinationKind: 'bsu' })], 10_000);
    expect(plan.totalPercent).toBe(120);
    expect(plan.overAllocated).toBe(true);
  });

  it('resolves every row to 0 for a non-positive target but keeps the plan', () => {
    const plan = resolveAllocation([alloc(50), alloc(50, { destinationKind: 'bsu' })], 0);
    expect(plan.rows.map(r => r.amount)).toEqual([0, 0]);
    expect(plan.totalPercent).toBe(100);
    expect(plan.remainder).toBe(0);
  });

  it('treats a NaN or negative percent as 0 rather than poisoning the total', () => {
    const plan = resolveAllocation(
      [alloc(NaN as number), alloc(-10, { destinationKind: 'bsu' }), alloc(40, { destinationKind: 'bufferAccount' })],
      10_000,
    );
    expect(plan.rows.map(r => r.amount)).toEqual([0, 0, 4000]);
    expect(plan.totalPercent).toBe(40);
  });

  it('is empty-safe', () => {
    const plan = resolveAllocation([], 10_000);
    expect(plan).toMatchObject({ rows: [], totalPercent: 0, totalAmount: 0, remainder: 10_000 });
  });
});

describe('isCreatableRow', () => {
  const row = (over: Partial<AllocationRow>): AllocationRow =>
    ({ ...alloc(50), amount: 5000, ...over });

  it('accepts a scalar destination with a positive amount', () => {
    expect(isCreatableRow(row({ destinationKind: 'portfolio' }), [], [])).toBe(true);
  });

  it('rejects a zero-amount row', () => {
    expect(isCreatableRow(row({ amount: 0 }), [], [])).toBe(false);
  });

  it('requires a savings account that still exists', () => {
    const r = row({ destinationKind: 'savingsAccount', savingsAccountId: 'sav-1' });
    expect(isCreatableRow(r, ['sav-1'], [])).toBe(true);
    expect(isCreatableRow(r, ['sav-2'], [])).toBe(false);
  });

  it('requires a debt that still exists', () => {
    const r = row({ destinationKind: 'debt', debtId: 'd-1' });
    expect(isCreatableRow(r, [], ['d-1'])).toBe(true);
    expect(isCreatableRow(r, [], [])).toBe(false);
  });
});

describe('destinationKey', () => {
  it('separates the two id-bearing kinds and collapses the scalars', () => {
    expect(destinationKey({ destinationKind: 'savingsAccount', savingsAccountId: 'a' })).toBe('savingsAccount:a');
    expect(destinationKey({ destinationKind: 'savingsAccount', savingsAccountId: 'b' })).not
      .toBe(destinationKey({ destinationKind: 'savingsAccount', savingsAccountId: 'a' }));
    expect(destinationKey({ destinationKind: 'debt', debtId: 'd1' })).toBe('debt:d1');
    expect(destinationKey({ destinationKind: 'portfolio' })).toBe('portfolio');
  });
});
