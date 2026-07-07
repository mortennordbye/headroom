import { describe, it, expect } from 'vitest';
import { accountMonthlyTotals, monthlyColumnTotals } from './monthlySpend';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2), date: '2026-06-05', description: 'x', amount: 100, kind: 'expense', ...o,
});
const months = ['2026-05', '2026-06', '2026-07'];

describe('accountMonthlyTotals', () => {
  it('sums expenses per account per month, sorted by total desc', () => {
    const rows = accountMonthlyTotals([
      tx({ account: 'a', accountName: 'Card', date: '2026-05-03', amount: 100 }),
      tx({ account: 'a', accountName: 'Card', date: '2026-06-10', amount: 250 }),
      tx({ account: 'b', accountName: 'Savings', date: '2026-06-01', amount: 50 }),
    ], {}, months);
    expect(rows[0]).toEqual({ key: 'a', label: 'Card', totals: [100, 250, 0], sum: 350 });
    expect(rows[1]).toEqual({ key: 'b', label: 'Savings', totals: [0, 50, 0], sum: 50 });
  });

  it('keeps two accounts with the same holder name as separate rows (scope to specific account)', () => {
    const rows = accountMonthlyTotals([
      tx({ account: 'hb:1', accountName: 'Morten Victor Nordbye', date: '2026-06-02', amount: 100 }),
      tx({ account: 'hb:2', accountName: 'Morten Victor Nordbye', date: '2026-06-03', amount: 200 }),
    ], {}, months);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).sort()).toEqual(['hb:1', 'hb:2']);
  });

  it('merges only when accounts share a custom label', () => {
    const rows = accountMonthlyTotals([
      tx({ account: 'legacy:1', bank: 'Bank Norwegian', date: '2026-06-02', amount: 100 }),
      tx({ account: 'new:1', accountName: 'x', date: '2026-06-03', amount: 200 }),
    ], { 'legacy:1': 'BN-Kredittkort', 'new:1': 'BN-Kredittkort' }, months);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ key: 'BN-Kredittkort', label: 'BN-Kredittkort', totals: [0, 300, 0], sum: 300 });
  });

  it('excludes income and untagged (manual) rows', () => {
    const rows = accountMonthlyTotals([
      tx({ account: 'a', accountName: 'Card', date: '2026-06-01', amount: 100, kind: 'income' }),
      tx({ date: '2026-06-01', amount: 999 }), // no account
    ], {}, months);
    expect(rows).toHaveLength(0);
  });

  it('monthlyColumnTotals sums each month across accounts', () => {
    const rows = accountMonthlyTotals([
      tx({ account: 'a', accountName: 'A', date: '2026-05-01', amount: 100 }),
      tx({ account: 'b', accountName: 'B', date: '2026-05-01', amount: 50 }),
      tx({ account: 'a', accountName: 'A', date: '2026-07-01', amount: 25 }),
    ], {}, months);
    expect(monthlyColumnTotals(rows, 3)).toEqual([150, 0, 25]);
  });
});
