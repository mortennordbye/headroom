import { describe, it, expect } from 'vitest';
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import { detectRecurring } from './recurring';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36),
  date: '2026-07-05',
  description: 'x',
  amount: 100,
  kind: 'expense',
  ...over,
});

const fe = (over: Partial<FixedExpense>): FixedExpense => ({
  id: Math.random().toString(36),
  name: 'x',
  amount: 1000,
  ...over,
});

// Three consecutive months of the same merchant at the same amount.
const monthly = (merchant: string, amount: number, months: string[], extra?: Partial<DailyTransaction>) =>
  months.map((m) => tx({ merchant, amount, date: `${m}-12`, ...extra }));

describe('detectRecurring', () => {
  it('flags a merchant seen at a steady amount across 3 recent months', () => {
    const txs = monthly('Netflix', 129, ['2026-05', '2026-06', '2026-07']);
    const out = detectRecurring(txs, [], '2026-07');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'netflix', label: 'Netflix', amount: 129, months: 3 });
  });

  it('ignores a merchant seen in only 2 months', () => {
    const txs = monthly('Spotify', 119, ['2026-06', '2026-07']);
    expect(detectRecurring(txs, [], '2026-07')).toEqual([]);
  });

  it('ignores income even if it recurs', () => {
    const txs = monthly('Employer', 40000, ['2026-05', '2026-06', '2026-07'], { kind: 'income' });
    expect(detectRecurring(txs, [], '2026-07')).toEqual([]);
  });

  it('ignores a merchant whose amounts vary beyond the tolerance band', () => {
    const txs = [
      tx({ merchant: 'Rema', amount: 200, date: '2026-05-03' }),
      tx({ merchant: 'Rema', amount: 900, date: '2026-06-03' }),
      tx({ merchant: 'Rema', amount: 500, date: '2026-07-03' }),
    ];
    expect(detectRecurring(txs, [], '2026-07')).toEqual([]);
  });

  it('skips merchants already covered by a fixed-expense match pattern', () => {
    const txs = monthly('Netflix', 129, ['2026-05', '2026-06', '2026-07']);
    const expenses = [fe({ name: 'Streaming', match: 'netflix' })];
    expect(detectRecurring(txs, expenses, '2026-07')).toEqual([]);
  });

  it('uses the median amount and the most common category', () => {
    const txs = [
      tx({ merchant: 'Gym', amount: 400, date: '2026-05-01', category: 'health' }),
      tx({ merchant: 'Gym', amount: 420, date: '2026-06-01', category: 'health' }),
      tx({ merchant: 'Gym', amount: 500, date: '2026-07-01', category: 'shopping' }),
    ];
    const out = detectRecurring(txs, [], '2026-07');
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(420);
    expect(out[0].category).toBe('health');
  });

  it('excludes occurrences outside the 4-month lookback window', () => {
    // Same merchant in Jan/Feb (old) + one recent month → only 1 recent month.
    const txs = monthly('Old', 100, ['2026-01', '2026-02', '2026-07']);
    expect(detectRecurring(txs, [], '2026-07')).toEqual([]);
  });

  it('falls back to description when no merchant is set', () => {
    const txs = monthly('', 250, ['2026-05', '2026-06', '2026-07']).map((t) => ({ ...t, merchant: undefined, description: 'Rent split' }));
    const out = detectRecurring(txs, [], '2026-07');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'rent split', label: 'Rent split', amount: 250 });
  });
});
