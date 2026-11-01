import { describe, it, expect } from 'vitest';
import { findInternalTransferIds } from './transfers';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2), date: '2026-07-05', description: 'x', amount: 100, kind: 'expense', ...o,
});

describe('findInternalTransferIds', () => {
  it('matches an opposite-kind equal-amount pair across two accounts within the window', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-06' });
    const ids = findInternalTransferIds([out, inn]);
    expect(ids.has('e1')).toBe(true);
    expect(ids.has('i1')).toBe(true);
  });

  it('ignores a pair on the same account (not a transfer between two accounts)', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'A', kind: 'income', amount: 5000, date: '2026-07-05' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('ignores amounts that differ', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000 });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5001 });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('ignores pairs outside the date window', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-01' });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-10' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('skips ambiguous matches (two equal-amount incomes for one expense)', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const i1 = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-05' });
    const i2 = tx({ id: 'i2', account: 'C', kind: 'income', amount: 5000, date: '2026-07-06' });
    expect(findInternalTransferIds([out, i1, i2]).size).toBe(0);
  });

  it('requires both legs to come from a connected account (manual rows never match)', () => {
    const out = tx({ id: 'e1', kind: 'expense', amount: 5000, date: '2026-07-05' }); // no account
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-05' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('matches two independent transfers without cross-claiming income legs', () => {
    const rows = [
      tx({ id: 'e1', account: 'A', kind: 'expense', amount: 1000, date: '2026-07-05' }),
      tx({ id: 'i1', account: 'B', kind: 'income', amount: 1000, date: '2026-07-05' }),
      tx({ id: 'e2', account: 'A', kind: 'expense', amount: 2000, date: '2026-07-08' }),
      tx({ id: 'i2', account: 'B', kind: 'income', amount: 2000, date: '2026-07-08' }),
    ];
    const ids = findInternalTransferIds(rows);
    expect([...ids].sort()).toEqual(['e1', 'e2', 'i1', 'i2']);
  });
});
