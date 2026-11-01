import { describe, it, expect } from 'vitest';
import type { BalanceSnapshot, DailyTransaction, FixedExpense, Saving } from '../context/FinanceContext';
import { cashflowSavingsForMonth, matchSavingsToTransactions } from './savingsMatch';
import { monthlyCashflow } from './monthlyCashflow';
import type { MonthSavingsInput } from './savingsRate';

const MONTH = '2026-10';
const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-10-25',
  description: 'x',
  amount: 3000,
  kind: 'expense',
  account: 'brukskonto',
  ...over,
});
const kr = (id: string, name: string, amount: number, over: Partial<Saving> = {}): Saving =>
  ({ id, name, amount, destinationKind: 'savingsAccount', ...over });
const ids = (savings: Saving[], txs: DailyTransaction[], opts = {}) =>
  matchSavingsToTransactions(savings, txs, MONTH, opts).map((m) => `${m.savingId}:${m.txId}`);

describe('matchSavingsToTransactions', () => {
  const buffer = [kr('s1', 'Buffer', 3000)];

  it('matches a row with a transfer signal that names the saving', () => {
    expect(ids(buffer, [tx({ id: 't1', description: 'Til: 1234.56.78901 Buffer' })])).toEqual(['s1:t1']);
    expect(ids(buffer, [tx({ id: 't1', description: 'Overføring 1234 56 78901 buffer' })])).toEqual(['s1:t1']);
  });

  it('never matches on a transfer signal alone', () => {
    expect(ids(buffer, [tx({ description: 'Nettgiro til: 1234.56.78901 snekker' })])).toEqual([]);
    expect(ids(buffer, [tx({ description: 'Til: Kredittkort', amount: 2980 })])).toEqual([]);
    expect(ids(buffer, [tx({ merchant: 'Vipps*Ola Nordmann', description: 'Til: Ola' })])).toEqual([]);
  });

  it('never matches on the name alone', () => {
    expect(ids(buffer, [tx({ description: 'Overføring buffer' })])).toEqual([]);
  });

  it('matches the name as a whole word only', () => {
    const bil = [kr('s1', 'Bil', 3000)];
    expect(ids(bil, [tx({ description: 'Til: 1234.56.78901 BILIA SERVICE OSLO' })])).toEqual([]);
    expect(ids(bil, [tx({ id: 't1', description: 'Til: 1234.56.78901 Bil' })])).toEqual(['s1:t1']);
    const ferie = [kr('s1', 'Ferie', 3000)];
    expect(ids(ferie, [tx({ description: 'Til: VING FERIEREISER' })])).toEqual([]);
  });

  it('holds the amount to 1 %, at least 1 kr', () => {
    expect(ids(buffer, [tx({ id: 't1', amount: 3030, description: 'Til: 1234.56.78901 Buffer' })])).toEqual(['s1:t1']);
    expect(ids(buffer, [tx({ amount: 3031, description: 'Til: 1234.56.78901 Buffer' })])).toEqual([]);
    const small = [kr('s1', 'Buffer', 50)];
    expect(ids(small, [tx({ id: 't1', amount: 51, description: 'Til: 1234.56.78901 Buffer' })])).toEqual(['s1:t1']);
  });

  it('resolves two same-sized savings by name', () => {
    const two = [kr('s1', 'Bil', 3000), kr('s2', 'Ferie', 3000)];
    const rows = [
      tx({ id: 't1', description: 'Til: 1111.22.33333 Bil' }),
      tx({ id: 't2', description: 'Til: 1111.22.44444 Ferie' }),
    ];
    expect(ids(two, rows).sort()).toEqual(['s1:t1', 's2:t2']);
  });

  it('matches none when two rows could be the one saving', () => {
    const rows = [
      tx({ description: 'Til: 1234.56.78901 Buffer' }),
      tx({ description: 'Til: 1234.56.78901 Buffer', date: '2026-10-26' }),
    ];
    expect(ids(buffer, rows)).toEqual([]);
  });

  it('matches none when one row names two same-sized savings', () => {
    const two = [kr('s1', 'Bil', 3000), kr('s2', 'Ferie', 3000)];
    expect(ids(two, [tx({ description: 'Til: 1111.22.33333 Bil og ferie' })])).toEqual([]);
  });

  it('skips a saving whose leg was already netted as a transfer that month', () => {
    const carpenter = tx({ id: 't1', description: 'Nettgiro til: 9999.88.77777 Buffer snekker' });
    const netted = [tx({ id: 'n1', description: 'Til: 1234.56.78901 Buffer', amount: 2995 })];
    expect(ids(buffer, [carpenter], { netted })).toEqual([]);
    // A netted row in another month says nothing about this one.
    expect(ids(buffer, [carpenter], { netted: [{ ...netted[0], date: '2026-09-25' }] })).toEqual(['s1:t1']);
  });

  it('skips paused savings, short names, income rows, other months and claimed rows', () => {
    const row = tx({ id: 't1', description: 'Til: 1234.56.78901 Buffer' });
    expect(ids([kr('s1', 'Buffer', 3000, { paused: true })], [row])).toEqual([]);
    expect(ids([kr('s1', 'BU', 3000)], [tx({ description: 'Til: 1234.56.78901 BU' })])).toEqual([]);
    expect(ids(buffer, [{ ...row, kind: 'income' }])).toEqual([]);
    expect(ids(buffer, [{ ...row, date: '2026-09-25' }])).toEqual([]);
    expect(ids(buffer, [row], { isClaimed: (t: DailyTransaction) => t.id === 't1' })).toEqual([]);
  });
});

describe('cashflowSavingsForMonth', () => {
  const NOW = '2026-10';
  const rent: FixedExpense[] = [{ id: 'rent', name: 'Rent', amount: 10000, type: 'fixed' }];
  const snap = (savings: Saving[]) => ({ fixedExpenses: rent, savings } as unknown as BalanceSnapshot);
  const data = (over: Partial<MonthSavingsInput> = {}): MonthSavingsInput => ({
    savings: [kr('s1', 'Buffer', 3000)],
    savingsTargetPercent: 50,
    savingsMonthOverrides: {},
    balanceSnapshots: {},
    fixedExpenses: rent,
    ...over,
  });

  it('is matchable only from the current month on, or in a month with a snapshot', () => {
    const d = data({ balanceSnapshots: { '2026-08': snap([kr('old', 'Gammel', 500)]) } });
    expect(cashflowSavingsForMonth(d, '2026-10', NOW, 40000).matchable).toBe(true);
    expect(cashflowSavingsForMonth(d, '2026-11', NOW, 40000).matchable).toBe(true);
    expect(cashflowSavingsForMonth(d, '2026-03', NOW, 40000).matchable).toBe(false);
    const aug = cashflowSavingsForMonth(d, '2026-08', NOW, 40000);
    expect(aug.matchable).toBe(true);
    expect(aug.savings.map((s) => s.id)).toEqual(['old']);
  });

  // The cashflow as the chart builds it: today's list, NOW as the current month.
  const cashflow = (d: MonthSavingsInput, months: string[], txs: DailyTransaction[]) =>
    monthlyCashflow(months, txs, {}, 40000, 10000, null, undefined, {
      forMonth: (m) => cashflowSavingsForMonth(d, m, NOW, 40000),
      netted: [],
    });

  it('does not let today\'s list claim a row from a past month with no snapshot', () => {
    const rows = cashflow(data(), ['2026-03', '2026-10'], [
      tx({ date: '2026-03-25', description: 'Til: 1234.56.78901 Buffer' }),
      tx({ date: '2026-10-25', description: 'Til: 1234.56.78901 Buffer' }),
    ]);
    expect(rows[0].expenses).toBe(13000);
    expect(rows[1].expenses).toBe(10000);
    expect(rows[1].saved).toBe(3000);
  });

  it('matches a percent saving at its resolved amount', () => {
    // Pool 40 000 - 10 000 = 30 000; 10 % of it is 3 000.
    const d = data({ savings: [{ id: 'p', name: 'Fond', amount: 0, mode: 'percent', percent: 10, destinationKind: 'portfolio' }] });
    const [row] = cashflow(d, [NOW], [tx({ description: 'Til: 1234.56.78901 Fond' })]);
    expect(row.expenses).toBe(10000);
    expect(row.saved).toBe(3000);
  });

  it('matches a rest saving at what the others leave of the target', () => {
    // Target 50 % of 30 000 = 15 000; the buffer takes 3 000, the rest row 12 000.
    const d = data({ savings: [kr('s1', 'Buffer', 3000), { id: 'r', name: 'Aksjer', amount: 0, mode: 'rest', destinationKind: 'portfolio' }] });
    const [row] = cashflow(d, [NOW], [tx({ amount: 12000, description: 'Til: 1234.56.78901 Aksjer' })]);
    expect(row.expenses).toBe(10000);
    expect(row.saved).toBe(15000);
  });

  it('matches against the month adjustment, not the plan', () => {
    const d = data({ savingsMonthOverrides: { [NOW]: 2000 } });
    const [adjusted] = cashflow(d, [NOW], [tx({ amount: 2000, description: 'Til: 1234.56.78901 Buffer' })]);
    expect(adjusted.expenses).toBe(10000);
    expect(adjusted.saved).toBe(2000);
    const [planned] = cashflow(d, [NOW], [tx({ amount: 3000, description: 'Til: 1234.56.78901 Buffer' })]);
    expect(planned.expenses).toBe(13000);
    expect(planned.saved).toBe(2000);
  });
});
