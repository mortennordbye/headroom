import { describe, it, expect } from 'vitest';
import type { DailyTransaction } from '../context/FinanceContext';
import { topSpendInsight } from './insights';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36),
  date: '2026-07-05',
  description: 'x',
  amount: 100,
  kind: 'expense',
  ...over,
});

const PRIOR = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

describe('topSpendInsight', () => {
  it('returns null when there is no spend anywhere', () => {
    expect(topSpendInsight([], '2026-07', PRIOR)).toBeNull();
  });

  it('surfaces a category that dropped well below its trailing average', () => {
    const txs: DailyTransaction[] = [
      // groceries ~1000/mo for six months, then 500 this month → 50% less
      ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 1000, category: 'groceries' })),
      tx({ date: '2026-07-10', amount: 500, category: 'groceries' }),
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR)!;
    expect(r.kind).toBe('category-delta');
    expect(r.category).toBe('groceries');
    expect(r.direction).toBe('less');
    expect(r.pct).toBe(50);
    expect(r.amount).toBe(500);
  });

  it('picks the biggest deviation when several categories move', () => {
    const txs: DailyTransaction[] = [
      ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 1000, category: 'groceries' })),
      ...PRIOR.map((m) => tx({ date: `${m}-11`, amount: 1000, category: 'dining' })),
      tx({ date: '2026-07-10', amount: 1100, category: 'groceries' }), // +10%
      tx({ date: '2026-07-11', amount: 2000, category: 'dining' }),    // +100%
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR)!;
    expect(r.category).toBe('dining');
    expect(r.direction).toBe('more');
    expect(r.pct).toBe(100);
  });

  it('ignores tiny categories below the significance floor', () => {
    const txs: DailyTransaction[] = [
      ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 50, category: 'subscriptions' })),
      tx({ date: '2026-07-10', amount: 200, category: 'subscriptions' }), // 300% but avg < 300 kr
      ...PRIOR.map((m) => tx({ date: `${m}-12`, amount: 4000, category: 'housing' })),
      tx({ date: '2026-07-12', amount: 4000, category: 'housing' }),      // flat
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR);
    // subscriptions filtered (avg too small), housing flat → no category-delta;
    // total this month (4200) vs avg (4050) is within the delta floor → fallback.
    expect(r?.kind).toBe('top-category');
    expect(r?.category).toBe('housing');
  });

  it('flags a category that dropped out entirely this month', () => {
    const txs: DailyTransaction[] = [
      ...PRIOR.map((m) => tx({ date: `${m}-11`, amount: 400, category: 'transport' })),
      // no transport in July → 100% drop, the strongest swing
      ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 400, category: 'groceries' })),
      tx({ date: '2026-07-10', amount: 700, category: 'groceries' }), // +75%
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR)!;
    expect(r.category).toBe('transport');
    expect(r.direction).toBe('less');
    expect(r.pct).toBe(100);
  });

  it('falls back to the overall total when moves are spread thin across categories', () => {
    // Five categories each nudge up +150 (below the 200 kr per-category floor),
    // so none qualifies alone, but the total jump (+750) clears the floor.
    const cats = ['groceries', 'transport', 'dining', 'shopping', 'entertainment'] as const;
    const txs: DailyTransaction[] = [
      ...PRIOR.flatMap((m) => cats.map((c) => tx({ date: `${m}-10`, amount: 400, category: c }))),
      ...cats.map((c) => tx({ date: '2026-07-10', amount: 550, category: c })),
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR)!;
    expect(r.kind).toBe('total-delta');
    expect(r.direction).toBe('more');
    expect(r.amount).toBe(2750);
  });

  it('excludes income from spend math', () => {
    const txs: DailyTransaction[] = [
      ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 1000, category: 'groceries' })),
      tx({ date: '2026-07-10', amount: 1000, category: 'groceries' }),
      tx({ date: '2026-07-15', amount: 50000, category: 'income', kind: 'income' }),
    ];
    const r = topSpendInsight(txs, '2026-07', PRIOR);
    // groceries flat, income ignored → nothing notable → top-category groceries
    expect(r?.kind).toBe('top-category');
    expect(r?.category).toBe('groceries');
  });
});
