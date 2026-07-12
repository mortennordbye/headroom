import { describe, it, expect } from 'vitest';
import { bufferBuilderIdsToRemove } from './bufferBuilder';
import type { FixedExpense } from '../context/FinanceContext';

const exp = (over: Partial<FixedExpense>): FixedExpense => ({ id: 'x', name: 'n', amount: 1000, ...over });

describe('bufferBuilderIdsToRemove', () => {
  it('returns a builder once the buffer reaches its target', () => {
    const e = exp({ id: 'b1', destinationKind: 'bufferAccount', bufferTargetAmount: 30_000 });
    expect(bufferBuilderIdsToRemove([e], 29_999)).toEqual([]);
    expect(bufferBuilderIdsToRemove([e], 30_000)).toEqual(['b1']);
    expect(bufferBuilderIdsToRemove([e], 45_000)).toEqual(['b1']);
  });

  it('ignores buffer contributions with no target set', () => {
    const e = exp({ id: 'b2', destinationKind: 'bufferAccount' });
    expect(bufferBuilderIdsToRemove([e], 999_999)).toEqual([]);
  });

  it('never touches other destinations or plain expenses', () => {
    const rows = [
      exp({ id: 's1', destinationKind: 'savingsAccount', savingsAccountId: 'sav-1', bufferTargetAmount: 10 }),
      exp({ id: 'd1', destinationKind: 'debt', debtId: 'debt-1' }),
      exp({ id: 'plain' }),
    ];
    expect(bufferBuilderIdsToRemove(rows, 999_999)).toEqual([]);
  });

  it('returns every matured builder', () => {
    const rows = [
      exp({ id: 'b1', destinationKind: 'bufferAccount', bufferTargetAmount: 10_000 }),
      exp({ id: 'b2', destinationKind: 'bufferAccount', bufferTargetAmount: 50_000 }),
    ];
    expect(bufferBuilderIdsToRemove(rows, 20_000)).toEqual(['b1']);
  });
});
