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
    expect(plan.overReason).toBe('percent');
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

describe('resolveAllocation — fixed-kroner rows', () => {
  const pctRow = (id: string, percent: number): SavingsAllocation =>
    ({ id, percent, destinationKind: 'portfolio' });
  const krRow = (id: string, amount: number): SavingsAllocation =>
    ({ id, percent: 0, mode: 'amount', amount, destinationKind: 'bufferAccount' });

  it('takes fixed rows off the top and splits only the rest by percent', () => {
    // 10 000 target, 2 000 pinned → the 50% row gets half of the remaining 8 000.
    const plan = resolveAllocation([krRow('a', 2000), pctRow('b', 50)], 10_000);
    expect(plan.rows.map(r => r.amount)).toEqual([2000, 4000]);
    expect(plan.totalAmount).toBe(6000);
    expect(plan.remainder).toBe(4000);
  });

  it('pays a fixed row its exact amount regardless of the percentages', () => {
    const plan = resolveAllocation([krRow('a', 1500), pctRow('b', 100)], 10_000);
    expect(plan.rows[0].amount).toBe(1500);
    expect(plan.rows[1].amount).toBe(8500);
    expect(plan.remainder).toBe(0);
  });

  it('never lets rounding drift a fixed row off its stated amount', () => {
    // Three 33.33% rows over an awkward remainder still leave 777 untouched.
    const plan = resolveAllocation(
      [krRow('a', 777), pctRow('b', 33.33), pctRow('c', 33.33), pctRow('d', 33.34)],
      10_001,
    );
    expect(plan.rows[0].amount).toBe(777);
    expect(plan.rows.slice(1).reduce((s, r) => s + r.amount, 0)).toBe(10_001 - 777);
  });

  it('flags over-allocation when fixed rows alone exceed the target', () => {
    const plan = resolveAllocation([krRow('a', 12_000)], 10_000);
    expect(plan.overAllocated).toBe(true);
    // 'fixed', not 'percent': the percentages are blameless, and telling the
    // user to adjust them points at the wrong control.
    expect(plan.overReason).toBe('fixed');
    expect(plan.rows[0].amount).toBe(12_000);
    expect(plan.remainder).toBe(-2000);
  });

  it('does not flag fixed rows that exactly consume the target', () => {
    const plan = resolveAllocation([krRow('a', 500), krRow('b', 500)], 1000);
    expect(plan.overReason).toBe(null);
    expect(plan.remainder).toBe(0);
  });

  it('still pays fixed rows when the target is zero, and reports the overdraw', () => {
    const plan = resolveAllocation([krRow('a', 500), pctRow('b', 50)], 0);
    expect(plan.rows.map(r => r.amount)).toEqual([500, 0]);
    expect(plan.remainder).toBe(-500);
  });

  it('treats a missing mode as percent, so stored data is unchanged', () => {
    const legacy = resolveAllocation([pctRow('a', 40), pctRow('b', 60)], 10_000);
    expect(legacy.rows.map(r => r.amount)).toEqual([4000, 6000]);
    expect(legacy.overAllocated).toBe(false);
  });

  it('guards a blank or NaN fixed amount as 0 rather than NaN', () => {
    const plan = resolveAllocation(
      [{ id: 'a', percent: 0, mode: 'amount', amount: NaN, destinationKind: 'bsu' }, pctRow('b', 50)],
      10_000,
    );
    expect(plan.rows[0].amount).toBe(0);
    expect(plan.rows[1].amount).toBe(5000);
  });
});

describe('resolveAllocation — rest rows', () => {
  const pctRow = (id: string, percent: number): SavingsAllocation =>
    ({ id, percent, destinationKind: 'portfolio' });
  const krRow = (id: string, amount: number): SavingsAllocation =>
    ({ id, percent: 0, mode: 'amount', amount, destinationKind: 'bufferAccount' });
  const restRow = (id: string): SavingsAllocation =>
    ({ id, percent: 0, mode: 'rest', destinationKind: 'bsu' });

  it('gives the rest row everything the fixed and percent rows leave', () => {
    // The shape from the bug report: two pinned transfers, and the remainder
    // into funds — with no percentage arithmetic asked of the user.
    const plan = resolveAllocation([krRow('a', 500), krRow('b', 500), restRow('c')], 15_552);
    expect(plan.rows.map(r => r.amount)).toEqual([500, 500, 14_552]);
    expect(plan.remainder).toBe(0);
    expect(plan.overReason).toBe(null);
  });

  it('leaves nothing unallocated alongside percentages that fall short', () => {
    const plan = resolveAllocation([pctRow('a', 60), restRow('b')], 10_000);
    expect(plan.rows.map(r => r.amount)).toEqual([6000, 4000]);
    expect(plan.remainder).toBe(0);
  });

  it('takes no percentage of its own, so the total still reads as the percent rows', () => {
    const plan = resolveAllocation([pctRow('a', 40), restRow('b')], 10_000);
    expect(plan.totalPercent).toBe(40);
    expect(plan.overReason).toBe(null);
  });

  it('gets 0 when the percentages already claim everything', () => {
    const plan = resolveAllocation([pctRow('a', 100), restRow('b')], 10_000);
    expect(plan.rows.map(r => r.amount)).toEqual([10_000, 0]);
  });

  it('gets 0 rather than a negative share when the plan is over-allocated', () => {
    const plan = resolveAllocation([pctRow('a', 130), restRow('b')], 10_000);
    expect(plan.rows[1].amount).toBe(0);
    expect(plan.overReason).toBe('percent');
  });

  it('splits evenly between several rest rows, to the exact krone', () => {
    const plan = resolveAllocation([restRow('a'), restRow('b'), restRow('c')], 10_000);
    expect(plan.rows.map(r => r.amount).sort()).toEqual([3333, 3333, 3334]);
    expect(plan.totalAmount).toBe(10_000);
  });

  it('resolves to 0 on a lean month without disturbing the fixed rows', () => {
    const plan = resolveAllocation([krRow('a', 500), restRow('b')], 0);
    expect(plan.rows.map(r => r.amount)).toEqual([500, 0]);
    expect(plan.overReason).toBe('fixed');
  });
});
