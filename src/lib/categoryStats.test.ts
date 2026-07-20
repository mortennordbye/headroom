import { describe, it, expect } from 'vitest';
import type { DailyTransaction } from '../context/FinanceContext';
import {
  spendByCategory, totalSpend, categoryMoM, monthlyCategoryTotals, budgetProgress,
} from './categoryStats';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36),
  date: '2026-07-05',
  description: 'x',
  amount: 100,
  kind: 'expense',
  ...over,
});

const SET: DailyTransaction[] = [
  tx({ date: '2026-07-03', amount: 742, category: 'groceries' }),
  tx({ date: '2026-07-06', amount: 200, category: 'groceries' }),
  tx({ date: '2026-07-09', amount: 850, category: 'transport' }),
  tx({ date: '2026-07-12', amount: 640, category: 'dining' }),
  tx({ date: '2026-07-15', amount: 5000, category: 'income', kind: 'income' }), // must be ignored
  tx({ date: '2026-06-20', amount: 500, category: 'groceries' }),               // prior month
  tx({ date: '2026-07-18', amount: 90, category: 'Mat' }),                      // legacy free-text
];

describe('spendByCategory', () => {
  it('sums expenses per category for the month, income excluded, biggest first', () => {
    const r = spendByCategory(SET, '2026-07');
    expect(r).toEqual([
      { category: 'groceries', amount: 942 },
      { category: 'transport', amount: 850 },
      { category: 'dining', amount: 640 },
      { category: 'Mat', amount: 90 },
    ]);
    expect(r.find((x) => x.category === 'income')).toBeUndefined();
  });

  // Regression: a row categorised 'income' but carrying kind:'expense' (a mis-signed
  // import, or a refund the user recategorised) used to count as spend, putting an
  // "Inntekt" bar in the spend breakdown and inflating the month total.
  it('excludes the income category even when the row is marked kind:"expense"', () => {
    const txs = [
      tx({ date: '2026-07-01', amount: 499, category: 'income', kind: 'expense' }),
      tx({ date: '2026-07-02', amount: 300, category: 'groceries' }),
    ];
    expect(spendByCategory(txs, '2026-07')).toEqual([{ category: 'groceries', amount: 300 }]);
    expect(totalSpend(txs, '2026-07')).toBe(300);
  });

  it('buckets an uncategorized expense under "other"', () => {
    const r = spendByCategory([tx({ date: '2026-07-01', amount: 50, category: undefined })], '2026-07');
    expect(r).toEqual([{ category: 'other', amount: 50 }]);
  });
});

describe('totalSpend', () => {
  it('sums only that month\'s expenses', () => {
    expect(totalSpend(SET, '2026-07')).toBe(742 + 200 + 850 + 640 + 90);
    expect(totalSpend(SET, '2026-06')).toBe(500);
  });
});

describe('categoryMoM', () => {
  it('computes signed percentage change vs the prior month', () => {
    const r = categoryMoM(SET, '2026-07', '2026-06');
    const groceries = r.find((x) => x.category === 'groceries')!;
    expect(groceries.current).toBe(942);
    expect(groceries.previous).toBe(500);
    expect(groceries.pct).toBeCloseTo(88.4, 1);
  });

  it('reports null pct for a category with no prior spend (no divide-by-zero)', () => {
    const transport = categoryMoM(SET, '2026-07', '2026-06').find((x) => x.category === 'transport')!;
    expect(transport.previous).toBe(0);
    expect(transport.pct).toBeNull();
  });
});

describe('monthlyCategoryTotals', () => {
  it('shapes canonical per-category totals across an ordered month range', () => {
    const rows = monthlyCategoryTotals(SET, ['2026-06', '2026-07']);
    expect(rows[0]).toMatchObject({ month: '2026-06', groceries: 500, total: 500 });
    // July: legacy 'Mat' (90) folds into 'other'; income excluded.
    expect(rows[1]).toMatchObject({ month: '2026-07', groceries: 942, transport: 850, dining: 640, other: 90 });
    expect(rows[1].total).toBe(742 + 200 + 850 + 640 + 90);
  });

  it('omits zero-value category keys and returns a row per requested month', () => {
    const rows = monthlyCategoryTotals(SET, ['2026-05', '2026-06', '2026-07']);
    expect(rows.map((r) => r.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(rows[0]).toEqual({ month: '2026-05', total: 0 }); // empty month
    expect('transport' in rows[0]).toBe(false);
  });
});

describe('budgetProgress', () => {
  it('reports actual-vs-budget only for categories with a positive budget', () => {
    const r = budgetProgress(SET, '2026-07', { groceries: 1000, transport: 500, health: 300 });
    expect(r.find((x) => x.category === 'groceries')).toMatchObject({ budget: 1000, spent: 942, over: false });
    const transport = r.find((x) => x.category === 'transport')!;
    expect(transport).toMatchObject({ budget: 500, spent: 850, over: true });
    expect(transport.pct).toBe(170);
    // health has a budget but no spend → still listed at 0 spent
    expect(r.find((x) => x.category === 'health')).toMatchObject({ spent: 0, over: false });
    // dining has spend but no budget → excluded
    expect(r.find((x) => x.category === 'dining')).toBeUndefined();
  });
});
