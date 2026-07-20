import { describe, it, expect } from 'vitest';
import { isSpend, monthlyCashflow } from './monthlyCashflow';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-06-15',
  description: 'x',
  amount: 0,
  ...over,
});

describe('isSpend', () => {
  it('counts expenses and treats a missing kind as spend', () => {
    expect(isSpend(tx({ kind: 'expense' }))).toBe(true);
    expect(isSpend(tx({}))).toBe(true);
  });

  it('excludes income', () => {
    expect(isSpend(tx({ kind: 'income' }))).toBe(false);
  });
});

describe('monthlyCashflow', () => {
  const months = ['2026-05', '2026-06'];
  const txs = [
    tx({ date: '2026-06-03', amount: 200, kind: 'expense' }),
    tx({ date: '2026-06-20', amount: 300 }), // no kind → spend
    tx({ date: '2026-06-10', amount: 5000, kind: 'income' }), // ignored
    tx({ date: '2026-05-01', amount: 100, kind: 'expense' }),
    tx({ date: '2026-04-01', amount: 999, kind: 'expense' }), // outside window
  ];

  it('sums only spend into variable, per month', () => {
    const rows = monthlyCashflow(months, txs, {}, 40000, 10000);
    expect(rows.map(r => r.variable)).toEqual([100, 500]);
  });

  it('uses the manual income override when set, else the fallback', () => {
    const rows = monthlyCashflow(months, txs, { '2026-06': 50000 }, 40000, 10000);
    expect(rows[0].income).toBe(40000); // May → fallback
    expect(rows[1].income).toBe(50000); // June → override
  });

  it('adds fixed expenses to variable and computes net', () => {
    const rows = monthlyCashflow(months, txs, {}, 40000, 10000);
    // June: expenses = 10000 + 500 = 10500; net = 40000 - 10500
    expect(rows[1].expenses).toBe(10500);
    expect(rows[1].net).toBe(29500);
  });

  it('computes the savings rate as a rounded percent of income', () => {
    const rows = monthlyCashflow(['2026-06'], [tx({ date: '2026-06-01', amount: 500, kind: 'expense' })], {}, 40000, 10000);
    // (40000 - 10500) / 40000 * 100 = 73.75
    expect(rows[0].rate).toBe(73.8);
  });

  it('reports a zero rate when income is non-positive (no divide-by-zero)', () => {
    const rows = monthlyCashflow(['2026-06'], [], {}, 0, 5000);
    expect(rows[0].rate).toBe(0);
    expect(rows[0].net).toBe(-5000);
  });
});

describe('monthlyCashflow — measured months', () => {
  it('marks a month with no logged spend as unmeasured', () => {
    // 2026-05 has no transactions at all: its rate is an artefact of the fixed
    // total, not a real savings month.
    const rows = monthlyCashflow(['2026-05', '2026-06'], [tx({ date: '2026-06-02', amount: 100, kind: 'expense' })], {}, 40000, 10000);
    expect(rows[0].measured).toBe(false);
    expect(rows[1].measured).toBe(true);
  });

  it('counts an income-only month as unmeasured', () => {
    const rows = monthlyCashflow(['2026-06'], [tx({ date: '2026-06-02', amount: 5000, kind: 'income' })], {}, 40000, 10000);
    expect(rows[0].measured).toBe(false);
  });
});

describe('monthlyCashflow — envelope reconciliation', () => {
  const fixedExpenses = [
    { id: 'e1', name: 'Strøm', amount: 1000, type: 'fixed' as const, match: 'stroem' },
  ];

  it('charges a budgeted bill once when its own payment is imported', () => {
    const txs = [tx({ date: '2026-06-05', amount: 900, kind: 'expense', description: 'stroem AS' })];
    // Without the rows: 1000 budget + 900 payment = 1900 (double count).
    expect(monthlyCashflow(['2026-06'], txs, {}, 40000, 1000)[0].expenses).toBe(1900);
    // With them: the 900 draws down the 1000 envelope → 1000.
    expect(monthlyCashflow(['2026-06'], txs, {}, 40000, 1000, null, fixedExpenses)[0].expenses).toBe(1000);
  });

  it('adds the overspend when the real payment exceeds the budget', () => {
    const txs = [tx({ date: '2026-06-05', amount: 1300, kind: 'expense', description: 'stroem AS' })];
    // 1000 budget + 300 over = 1300.
    expect(monthlyCashflow(['2026-06'], txs, {}, 40000, 1000, null, fixedExpenses)[0].expenses).toBe(1300);
  });

  it('still adds spend that no envelope claims', () => {
    const txs = [
      tx({ date: '2026-06-05', amount: 900, kind: 'expense', description: 'stroem AS' }),
      tx({ date: '2026-06-06', amount: 450, kind: 'expense', description: 'unrelated shop' }),
    ];
    // 1000 envelope + 450 unenveloped.
    expect(monthlyCashflow(['2026-06'], txs, {}, 40000, 1000, null, fixedExpenses)[0].expenses).toBe(1450);
  });
});

