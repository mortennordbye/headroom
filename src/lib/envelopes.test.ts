import { describe, it, expect } from 'vitest';
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import {
  reconcile, createEnvelopeLedger, runningEnvelopeBalance,
  discretionarySpendForMonth,
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

  // Behaviour change (deliberate): income used to be ADDED to the balance. That was
  // harmless while the app was manual-only — no income rows existed — but once bank
  // sync began importing the actual paycheck it double-counted, because dailyBudget
  // already derives from that same income. Income is still reported per day for
  // display; it just no longer moves the balance.
  it('reports income per day but never adds it to the balance', () => {
    const expenses = [fe({ name: 'Mat', amount: 6000, category: 'groceries' })];
    const txs = [
      tx({ date: '2026-07-01', amount: 5000, category: 'groceries', kind: 'income' }),
      tx({ date: '2026-07-02', amount: 100, category: 'groceries' }),
    ];
    const pts = runningEnvelopeBalance(days, txs, 0, recon(expenses, txs));
    expect(pts.map((p) => p.income)).toEqual([5000, 0, 0]);
    expect(pts.map((p) => p.discretionary)).toEqual([0, 0, 0]); // grocery spend covered
    expect(pts.map((p) => Math.round(p.balance))).toEqual([0, 0, 0]);
  });

  it('never draws income from an envelope', () => {
    const expenses = [fe({ name: 'Mat', amount: 200, category: 'groceries' })];
    const txs = [
      tx({ date: '2026-07-01', amount: 5000, category: 'groceries', kind: 'income' }),
      tx({ date: '2026-07-02', amount: 300, category: 'groceries' }),
    ];
    const pts = runningEnvelopeBalance(days, txs, 0, recon(expenses, txs));
    // The 5000 income row must not consume the 200 envelope: the 300 expense sees a
    // full envelope, so only 100 spills over.
    expect(pts.map((p) => p.discretionary)).toEqual([0, 100, 0]);
  });
});

describe('discretionarySpendForMonth', () => {
  it('ignores income rows — a salary deposit is not spending', () => {
    const total = discretionarySpendForMonth(
      [
        tx({ date: '2026-06-01', amount: 45000, kind: 'income' }), // salary
        tx({ date: '2026-06-10', amount: 800, category: 'dining' }),
      ],
      [],
      '2026-06',
    );
    expect(total).toBe(800);
  });

  it('only counts transactions in the requested month', () => {
    const total = discretionarySpendForMonth(
      [
        tx({ date: '2026-06-10', amount: 300, category: 'dining' }),
        tx({ date: '2026-07-10', amount: 999, category: 'dining' }), // next month
        tx({ date: '2026-05-31', amount: 500, category: 'dining' }), // prior month
      ],
      [],
      '2026-06',
    );
    expect(total).toBe(300);
  });

  it('excludes envelope-covered spend and counts only the spillover', () => {
    const total = discretionarySpendForMonth(
      [
        tx({ date: '2026-06-05', amount: 4000, category: 'groceries' }), // covered
        tx({ date: '2026-06-20', amount: 3000, category: 'groceries' }), // 2000 covered, 1000 spills
        tx({ date: '2026-06-25', amount: 500, category: 'dining' }),     // non-enveloped
      ],
      [fe({ name: 'Mat', amount: 6000, category: 'groceries' })],
      '2026-06',
    );
    expect(total).toBe(1500);
  });

  it('matches the running-balance pipeline the dashboard sums for the current month', () => {
    const expenses = [fe({ name: 'Mat', amount: 6000, category: 'groceries' })];
    const txs = [
      tx({ date: '2026-07-01', amount: 4000, category: 'groceries' }),
      tx({ date: '2026-07-02', amount: 3000, category: 'groceries' }),
      tx({ date: '2026-07-03', amount: 500, category: 'dining' }),
      tx({ date: '2026-07-03', amount: 45000, kind: 'income' }),
    ];
    const points = runningEnvelopeBalance(
      ['2026-07-01', '2026-07-02', '2026-07-03'],
      txs, 1000, reconcile(expenses, txs, '2026-07'),
    );
    const fromPipeline = points.reduce((sum, p) => sum + p.discretionary, 0);
    expect(discretionarySpendForMonth(txs, expenses, '2026-07')).toBe(fromPipeline);
  });

  it('returns 0 for a month with no transactions', () => {
    expect(discretionarySpendForMonth([], [fe({ name: 'Mat', amount: 6000, category: 'groceries' })], '2026-06')).toBe(0);
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

describe('pattern (match) envelopes', () => {
  it('draws down only transactions matching the fixed expense pattern — the Ruter case', () => {
    // Ruter budgeted 655; category "transport" also has a 2000 flight. Linking by
    // category would show over-budget; linking by pattern only counts Ruter.
    const r = reconcile(
      [fe({ id: 'ruter', name: 'Ruter', amount: 655, match: 'Ruter' })],
      [
        tx({ description: 'Ruter AS', amount: 600, category: 'transport' }),
        tx({ description: 'SAS Norway', amount: 2000, category: 'transport' }),
      ],
      '2026-07',
    );
    const env = r.byExpenseId.get('ruter')!;
    expect(env.actual).toBe(600);      // only the Ruter transaction
    expect(env.status).not.toBe('over');
    expect(env.remaining).toBe(55);
  });

  it('a pattern match wins over a category link and is excluded from the category envelope', () => {
    const r = reconcile(
      [
        fe({ id: 'loan', name: 'Boliglån', amount: 18000, match: 'Til:90467295445' }),
        fe({ id: 'housing', name: 'Felleskostnader', amount: 3000, category: 'housing' }),
      ],
      [
        tx({ description: 'Til:90467295445', amount: 17000, category: 'housing' }),
        tx({ description: 'OBOS felleskost', amount: 3000, category: 'housing' }),
      ],
      '2026-07',
    );
    expect(r.byExpenseId.get('loan')!.actual).toBe(17000);        // the loan
    expect(r.byCategory.get('housing')!.actual).toBe(3000);        // NOT 20000 — loan excluded
  });

  it('the ledger draws a matched transaction from its pattern envelope, spilling the rest', () => {
    const r = reconcile([fe({ id: 'ruter', name: 'Ruter', amount: 655, match: 'Ruter' })], [], '2026-07');
    const ledger = createEnvelopeLedger(r);
    expect(ledger.draw(tx({ description: 'Ruter', amount: 400 }))).toEqual({ covered: 400, spillover: 0 });
    expect(ledger.draw(tx({ description: 'Ruter', amount: 400 }))).toEqual({ covered: 255, spillover: 145 });
    // a non-matching transport transaction is not covered by the Ruter envelope
    expect(ledger.draw(tx({ description: 'SAS', amount: 500, category: 'transport' }))).toEqual({ covered: 0, spillover: 500 });
  });

  it('is not suggested for a category link once it has a match', () => {
    const suggestions = suggestEnvelopeLinks(
      [fe({ name: 'Ruter transport', amount: 655, match: 'Ruter' })],
      [tx({ amount: 600, category: 'transport' })],
      '2026-07',
    );
    expect(suggestions).toHaveLength(0);
  });
});
