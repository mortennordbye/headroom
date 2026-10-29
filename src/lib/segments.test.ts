import { describe, it, expect } from 'vitest';
import { isTransactionSegment, oneOffSpend, withoutOneOffs } from './segments';
import { excludedTransferIds } from './transferRules';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (over: Partial<DailyTransaction>): DailyTransaction =>
  ({ id: 'x', date: '2026-07-10', description: 'Giro', amount: 26_000, kind: 'expense', ...over });

describe('segments', () => {
  it('accepts only the known segments', () => {
    expect(isTransactionSegment('transfer')).toBe(true);
    expect(isTransactionSegment('oneOff')).toBe(true);
    expect(isTransactionSegment('fast')).toBe(false);
    expect(isTransactionSegment(undefined)).toBe(false);
  });

  it('leaves one-offs out of the normal month', () => {
    const rows = [tx({ id: 'a' }), tx({ id: 'b', segment: 'oneOff' }), tx({ id: 'c', segment: 'transfer' })];
    expect(withoutOneOffs(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('totals the spending marked as one-offs', () => {
    const rows = [
      tx({ id: 'a', amount: 100 }),
      tx({ id: 'b', segment: 'oneOff' }),
      tx({ id: 'c', segment: 'oneOff', kind: 'income', amount: 5000 }),
    ];
    expect(oneOffSpend(rows)).toBe(26_000);
  });

  it('returns the same array when there are no one-offs', () => {
    const rows = [tx({ id: 'a' })];
    expect(withoutOneOffs(rows)).toBe(rows);
  });

  it('treats a row marked as a transfer like a matched transfer, in either direction', () => {
    const rows = [
      tx({ id: 'out', segment: 'transfer' }),
      tx({ id: 'in', kind: 'income', segment: 'transfer' }),
      tx({ id: 'spend' }),
    ];
    expect([...excludedTransferIds(rows, [])].sort()).toEqual(['in', 'out']);
  });
});
