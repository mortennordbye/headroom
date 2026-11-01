import { describe, it, expect } from 'vitest';
import { isSpend, monthlyCashflow } from './monthlyCashflow';
import type { CashflowSavings } from './savingsMatch';
import type { DailyTransaction, FixedExpense, Saving } from '../context/FinanceContext';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-06-15',
  description: 'x',
  amount: 0,
  ...over,
});

const saving = (over: Partial<Saving>): Saving => ({
  id: Math.random().toString(36).slice(2),
  name: 'Sparing',
  amount: 0,
  destinationKind: 'savingsAccount',
  ...over,
});

/** Savings for `monthlyCashflow`: matchable every month, nothing netted unless given. */
const plan = (forMonth: (m: string) => Saving[], netted: DailyTransaction[] = []): CashflowSavings => ({
  forMonth: (m) => ({ savings: forMonth(m), matchable: true }),
  netted,
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

describe('monthlyCashflow — per-month fixed expenses', () => {
  const may = [{ id: 'e1', name: 'Strøm', amount: 800, type: 'fixed' as const, match: 'stroem' }];
  const june = [{ id: 'e1', name: 'Strøm', amount: 1000, type: 'fixed' as const, match: 'stroem' }];
  const byMonth: Record<string, typeof may> = { '2026-05': may, '2026-06': june };
  const listFor = (m: string) => byMonth[m];
  const totalFor = (m: string) => byMonth[m].reduce((s, e) => s + e.amount, 0) + 200; // + savings

  it('reconciles each month against its own fixed expenses and total', () => {
    const txs = [
      tx({ date: '2026-05-05', amount: 700, kind: 'expense', description: 'stroem AS' }),
      tx({ date: '2026-06-05', amount: 1100, kind: 'expense', description: 'stroem AS' }),
    ];
    const rows = monthlyCashflow(['2026-05', '2026-06'], txs, {}, 40000, totalFor, null, listFor);
    // May: the 800 envelope covers the 700 payment, plus 200 savings.
    expect(rows[0].expenses).toBe(1000);
    // June: the 1000 envelope plus 100 overspend, plus 200 savings.
    expect(rows[1].expenses).toBe(1300);
  });

  it('keeps savings out of spending when passed as savingsFor instead of in the total', () => {
    const txs = [tx({ date: '2026-06-05', amount: 1100, kind: 'expense', description: 'stroem AS' })];
    const fixedOnly = (m: string) => byMonth[m].reduce((s, e) => s + e.amount, 0);
    const rows = monthlyCashflow(['2026-05', '2026-06'], txs, {}, 40000, fixedOnly, null, listFor, plan(() => [saving({ amount: 200 })]));
    // June: the 1000 envelope plus 100 overspend is spending; the 200 is saved.
    expect(rows[1].expenses).toBe(1100);
    expect(rows[1].saved).toBe(200);
    // Net is unchanged from the old "savings inside expenses" shape.
    expect(rows[1].net).toBe(40000 - 1300);
  });
});

describe('monthlyCashflow — savings as their own series', () => {
  const months = ['2026-05', '2026-06'];
  const txs = [
    tx({ date: '2026-06-03', amount: 200, kind: 'expense' }),
    tx({ date: '2026-06-20', amount: 300 }),
    tx({ date: '2026-05-01', amount: 100, kind: 'expense' }),
  ];

  it('reports savings apart from spending when savingsFor is given', () => {
    const rows = monthlyCashflow(months, txs, {}, 40000, 10000, undefined, undefined, plan((m) => (m === '2026-06' ? [saving({ amount: 3000 })] : [])));
    // June: spending stays 10000 + 500; the 3000 saved is its own figure.
    expect(rows[1].expenses).toBe(10500);
    expect(rows[1].saved).toBe(3000);
    // Net is what is left after spending and saving.
    expect(rows[1].net).toBe(26500);
    // The rate counts the saving as retained: (40000 - 10500) / 40000.
    expect(rows[1].rate).toBe(73.8);
    expect(rows[0].saved).toBe(0);
  });

  it('reports zero saved without savingsFor, and guards a NaN or negative saving', () => {
    expect(monthlyCashflow(months, txs, {}, 40000, 10000).every(r => r.saved === 0)).toBe(true);
    const rows = monthlyCashflow(months, txs, {}, 40000, 10000, undefined, undefined, plan((m) => [saving({ amount: m === '2026-05' ? NaN : -50 })]));
    expect(rows.map(r => r.saved)).toEqual([0, 0]);
    expect(rows[1].net).toBe(29500);
  });
});

describe('monthlyCashflow — a one-legged savings transfer', () => {
  const month = ['2026-06'];
  const buffer = [saving({ id: 's1', name: 'Buffer', amount: 3000 })];
  const leg = (over: Partial<DailyTransaction> = {}) =>
    tx({ date: '2026-06-25', amount: 3000, kind: 'expense', account: 'brukskonto', description: 'Til: 1234.56.78901 Buffer', ...over });
  const shop = tx({ date: '2026-06-03', amount: 500, kind: 'expense', description: 'Kiwi' });
  const run = (txs: DailyTransaction[], savings: CashflowSavings = plan(() => buffer), fixed?: FixedExpense[]) =>
    monthlyCashflow(month, txs, {}, 40000, fixed ? fixed.reduce((s, e) => s + e.amount, 0) : 10000, null, fixed, savings)[0];

  it('counts the outgoing leg once, as saved, and keeps expenses = fixed + variable', () => {
    const row = run([leg(), shop]);
    expect(row.variable).toBe(500);
    expect(row.expenses).toBe(10500);
    expect(row.saved).toBe(3000);
    expect(row.net).toBe(40000 - 10500 - 3000);
  });

  it('does not count a month whose only rows are matched legs as measured', () => {
    expect(run([leg()]).measured).toBe(false);
    expect(run([leg(), shop]).measured).toBe(true);
  });

  it('counts what the row actually moved when it is within 1 %', () => {
    const row = run([leg({ amount: 2990 })]);
    expect(row.expenses).toBe(10000);
    expect(row.saved).toBe(2990);
  });

  it('leaves the row as spending when the month is not matchable', () => {
    const guess: CashflowSavings = { forMonth: () => ({ savings: buffer, matchable: false }), netted: [] };
    const row = run([leg()], guess);
    expect(row.expenses).toBe(13000);
    expect(row.saved).toBe(3000);
  });

  it('does not let a netted leg claim a second same-sized row', () => {
    // The saving's real leg was netted as a transfer; another same-sized row
    // to the same name that month must stay spending.
    const netted = [leg({ id: 'n1', description: 'Til: 1234.56.78901 Buffer' })];
    const second = leg({ id: 'c1', description: 'Til: 9999.88.77777 Buffer' });
    const row = run([second], plan(() => buffer, netted));
    expect(row.expenses).toBe(13000);
    expect(row.saved).toBe(3000);
  });

  it('leaves a row a fixed-expense envelope owns to that envelope', () => {
    const fixed: FixedExpense[] = [{ id: 'e1', name: 'Husleie', amount: 3000, type: 'fixed', match: '1234.56.78901' }];
    const row = run([leg()], plan(() => buffer), fixed);
    expect(row.expenses).toBe(3000);
    expect(row.saved).toBe(3000);
  });

  it('reconciles alongside fixed-expense envelopes without double counting', () => {
    const fixed: FixedExpense[] = [{ id: 'e1', name: 'Strøm', amount: 1000, type: 'fixed', match: 'stroem' }];
    const row = run([leg(), tx({ date: '2026-06-05', amount: 900, kind: 'expense', description: 'stroem AS' })], plan(() => buffer), fixed);
    expect(row.variable).toBe(900);
    expect(row.expenses).toBe(1000);
    expect(row.saved).toBe(3000);
  });
});
