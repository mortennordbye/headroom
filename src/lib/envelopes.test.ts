import { describe, it, expect } from 'vitest';
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import {
  reconcile, createEnvelopeLedger, runningEnvelopeBalance,
  suggestCategoryForExpenseName, suggestEnvelopeLinks, NEAR_THRESHOLD,
} from './envelopes';

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

describe('reconcile', () => {
  it('returns nothing when no fixed expense is linked to a category', () => {
    const r = reconcile(
      [fe({ name: 'Boliglån', amount: 18000 }), fe({ name: 'Forsikring', amount: 160 })],
      [tx({ amount: 500, category: 'groceries' })],
      '2026-07',
    );
    expect(r.envelopes).toEqual([]);
    expect(r.envelopedCategories.size).toBe(0);
    expect(r.totals).toEqual({ budgeted: 0, actual: 0, overspent: 0, unused: 0 });
  });

  it('treats a linked expense with no transactions as a pure reservation (non-syncer case)', () => {
    const r = reconcile([fe({ id: 'm', name: 'Mat', amount: 6000, category: 'groceries' })], [], '2026-07');
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]).toMatchObject({
      category: 'groceries', expenseIds: ['m'], budgeted: 6000,
      actual: 0, remaining: 6000, overspent: 0, unused: 6000, status: 'under',
    });
  });

  it('computes an under-budget envelope', () => {
    const r = reconcile(
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      [tx({ amount: 4000, category: 'groceries' })],
      '2026-07',
    );
    expect(r.byCategory.get('groceries')).toMatchObject({
      actual: 4000, remaining: 2000, overspent: 0, unused: 2000, status: 'under',
    });
  });

  it('flags "near" once spend crosses the near threshold', () => {
    const r = reconcile(
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      [tx({ amount: 6000 * NEAR_THRESHOLD, category: 'groceries' })],
      '2026-07',
    );
    expect(r.byCategory.get('groceries')!.status).toBe('near');
  });

  it('computes an over-budget envelope', () => {
    const r = reconcile(
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      [tx({ amount: 7000, category: 'groceries' })],
      '2026-07',
    );
    expect(r.byCategory.get('groceries')).toMatchObject({
      actual: 7000, remaining: -1000, overspent: 1000, unused: 0, status: 'over',
    });
  });

  it('folds several fixed expenses on the same category into one envelope', () => {
    const r = reconcile(
      [
        fe({ id: 'a', name: 'Mat', amount: 4000, category: 'groceries' }),
        fe({ id: 'b', name: 'Storhandel', amount: 2000, category: 'groceries' }),
      ],
      [tx({ amount: 5000, category: 'groceries' })],
      '2026-07',
    );
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]).toMatchObject({ budgeted: 6000, actual: 5000, remaining: 1000 });
    expect(r.envelopes[0].expenseIds).toEqual(['a', 'b']);
  });

  it('excludes income and other-month spend from the actual', () => {
    const r = reconcile(
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      [
        tx({ date: '2026-07-02', amount: 1000, category: 'groceries' }),
        tx({ date: '2026-07-03', amount: 9000, category: 'groceries', kind: 'income' }), // income → ignored
        tx({ date: '2026-06-30', amount: 500, category: 'groceries' }),                  // prior month
      ],
      '2026-07',
    );
    expect(r.byCategory.get('groceries')!.actual).toBe(1000);
  });

  it('ignores spend in categories that are not enveloped', () => {
    const r = reconcile(
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      [tx({ amount: 800, category: 'dining' })],
      '2026-07',
    );
    expect(r.byCategory.get('groceries')!.actual).toBe(0);
    expect(r.envelopedCategories.has('dining')).toBe(false);
  });

  it('aggregates totals across envelopes and sorts biggest budget first', () => {
    const r = reconcile(
      [
        fe({ name: 'Mat', amount: 6000, category: 'groceries' }),
        fe({ name: 'Servering', amount: 2000, category: 'dining' }),
      ],
      [tx({ amount: 7000, category: 'groceries' }), tx({ amount: 500, category: 'dining' })],
      '2026-07',
    );
    expect(r.envelopes.map((e) => e.category)).toEqual(['groceries', 'dining']);
    expect(r.totals).toEqual({ budgeted: 8000, actual: 7500, overspent: 1000, unused: 1500 });
  });
});

describe('createEnvelopeLedger', () => {
  const ledgerFor = (expenses: FixedExpense[]) =>
    createEnvelopeLedger(reconcile(expenses, [], '2026-07'));

  it('covers spend within the envelope, then spills the excess day-accurately', () => {
    const ledger = ledgerFor([fe({ name: 'Mat', amount: 6000, category: 'groceries' })]);
    expect(ledger.draw(tx({ amount: 4000, category: 'groceries' }))).toEqual({ covered: 4000, spillover: 0 });
    // Envelope has 2000 left; a 3000 spend covers 2000 and spills 1000.
    expect(ledger.draw(tx({ amount: 3000, category: 'groceries' }))).toEqual({ covered: 2000, spillover: 1000 });
    // Fully exhausted; further spend spills in full.
    expect(ledger.draw(tx({ amount: 500, category: 'groceries' }))).toEqual({ covered: 0, spillover: 500 });
  });

  it('splits a single transaction that overruns the envelope', () => {
    const ledger = ledgerFor([fe({ name: 'Mat', amount: 6000, category: 'groceries' })]);
    expect(ledger.draw(tx({ amount: 7000, category: 'groceries' }))).toEqual({ covered: 6000, spillover: 1000 });
  });

  it('spills non-enveloped expenses in full', () => {
    const ledger = ledgerFor([fe({ name: 'Mat', amount: 6000, category: 'groceries' })]);
    expect(ledger.draw(tx({ amount: 800, category: 'dining' }))).toEqual({ covered: 0, spillover: 800 });
    expect(ledger.draw(tx({ amount: 300, category: undefined }))).toEqual({ covered: 0, spillover: 300 });
  });

  it('draws nothing for income rows', () => {
    const ledger = ledgerFor([fe({ name: 'Mat', amount: 6000, category: 'groceries' })]);
    expect(ledger.draw(tx({ amount: 9000, category: 'groceries', kind: 'income' }))).toEqual({ covered: 0, spillover: 0 });
  });

  it('tracks two envelopes independently', () => {
    const ledger = ledgerFor([
      fe({ name: 'Mat', amount: 6000, category: 'groceries' }),
      fe({ name: 'Servering', amount: 1000, category: 'dining' }),
    ]);
    expect(ledger.draw(tx({ amount: 6500, category: 'groceries' }))).toEqual({ covered: 6000, spillover: 500 });
    expect(ledger.draw(tx({ amount: 400, category: 'dining' }))).toEqual({ covered: 400, spillover: 0 });
  });
});

describe('runningEnvelopeBalance', () => {
  const days = ['2026-07-01', '2026-07-02', '2026-07-03'];
  const recon = (expenses: FixedExpense[], txs: DailyTransaction[]) =>
    reconcile(expenses, txs, '2026-07');

  it('excludes envelope-covered spend from the balance but subtracts spillover', () => {
    const expenses = [fe({ name: 'Mat', amount: 6000, category: 'groceries' })];
    const txs = [
      tx({ date: '2026-07-01', amount: 4000, category: 'groceries' }), // fully covered
      tx({ date: '2026-07-02', amount: 3000, category: 'groceries' }), // 2000 covered, 1000 spills
      tx({ date: '2026-07-03', amount: 500, category: 'dining' }),     // non-enveloped → discretionary
    ];
    const pts = runningEnvelopeBalance(days, txs, 1000, recon(expenses, txs));
    // day1: +1000 budget, 0 discretionary → 1000
    // day2: +1000 budget, 1000 spillover → 1000
    // day3: +1000 budget, 500 discretionary → 1500
    expect(pts.map((p) => p.discretionary)).toEqual([0, 1000, 500]);
    expect(pts.map((p) => Math.round(p.balance))).toEqual([1000, 1000, 1500]);
    // `spent` still reports the raw expense total per day.
    expect(pts.map((p) => p.spent)).toEqual([4000, 3000, 500]);
  });

  it('matches legacy behaviour when nothing is enveloped', () => {
    const txs = [
      tx({ date: '2026-07-01', amount: 300, category: 'groceries' }),
      tx({ date: '2026-07-02', amount: 200, category: 'dining' }),
    ];
    const pts = runningEnvelopeBalance(days, txs, 1000, recon([], txs));
    expect(pts.map((p) => Math.round(p.balance))).toEqual([700, 1500, 2500]);
  });

  it('adds income to the balance and never draws it from an envelope', () => {
    const expenses = [fe({ name: 'Mat', amount: 6000, category: 'groceries' })];
    const txs = [
      tx({ date: '2026-07-01', amount: 5000, category: 'groceries', kind: 'income' }),
      tx({ date: '2026-07-02', amount: 100, category: 'groceries' }),
    ];
    const pts = runningEnvelopeBalance(days, txs, 0, recon(expenses, txs));
    expect(pts.map((p) => p.income)).toEqual([5000, 0, 0]);
    expect(pts.map((p) => p.discretionary)).toEqual([0, 0, 0]); // grocery spend covered
    expect(pts.map((p) => Math.round(p.balance))).toEqual([5000, 5000, 5000]);
  });
});

describe('suggestCategoryForExpenseName', () => {
  it('maps common Norwegian fixed-expense names to a category', () => {
    expect(suggestCategoryForExpenseName('Mat')).toBe('groceries');
    expect(suggestCategoryForExpenseName('Strøm')).toBe('utilities');
    expect(suggestCategoryForExpenseName('Mobil')).toBe('utilities');
    expect(suggestCategoryForExpenseName('Trening')).toBe('health');
    expect(suggestCategoryForExpenseName('Servering')).toBe('dining');
  });

  it('returns undefined for names with no confident match', () => {
    expect(suggestCategoryForExpenseName('Boliglån')).toBeUndefined();
    expect(suggestCategoryForExpenseName('Forsikring')).toBeUndefined();
  });
});

describe('suggestEnvelopeLinks', () => {
  it('suggests linking an unlinked expense whose category has real spend', () => {
    const s = suggestEnvelopeLinks(
      [fe({ id: 'm', name: 'Mat', amount: 6000 }), fe({ name: 'Boliglån', amount: 18000 })],
      [tx({ amount: 437, category: 'groceries' })],
      '2026-07',
    );
    expect(s).toEqual([{ expenseId: 'm', expenseName: 'Mat', category: 'groceries', spent: 437 }]);
  });

  it('stays silent for non-syncers (no spend in the matched category)', () => {
    const s = suggestEnvelopeLinks([fe({ name: 'Mat', amount: 6000 })], [], '2026-07');
    expect(s).toEqual([]);
  });

  it('does not re-suggest a category already covered by an envelope', () => {
    const s = suggestEnvelopeLinks(
      [
        fe({ name: 'Mat', amount: 6000, category: 'groceries' }), // already linked
        fe({ name: 'Storhandel', amount: 1000 }),                 // also groceries
      ],
      [tx({ amount: 900, category: 'groceries' })],
      '2026-07',
    );
    expect(s).toEqual([]);
  });
});
