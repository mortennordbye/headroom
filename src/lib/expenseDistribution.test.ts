import { describe, it, expect } from 'vitest';
import { calcExpenseDistribution, DISTRIBUTION_VISIBLE_ROWS, formatShare } from './expenseDistribution';
import type { ExpenseType, FixedExpense } from '../context/FinanceContext';

const exp = (id: string, amount: number, type?: ExpenseType): FixedExpense => ({ id, name: id, amount, type });
const list = (count: number) => Array.from({ length: count }, (_, i) => exp(`e${i}`, 100 * (count - i)));

describe('calcExpenseDistribution', () => {
  it('ranks rows and gives each its share of the total', () => {
    const d = calcExpenseDistribution([exp('small', 250), exp('big', 750)]);
    expect(d.total).toBe(1000);
    expect(d.rows.map(r => [r.id, r.share])).toEqual([['big', 0.75], ['small', 0.25]]);
  });

  it('splits by type biggest first, with untyped rows counted as fixed', () => {
    const d = calcExpenseDistribution([exp('a', 100, 'subscription'), exp('b', 300, 'variable'), exp('c', 600)]);
    expect(d.types).toEqual([
      { type: 'fixed', total: 600, share: 0.6 },
      { type: 'variable', total: 300, share: 0.3 },
      { type: 'subscription', total: 100, share: 0.1 },
    ]);
    expect(d.rows.find(r => r.id === 'c')?.type).toBe('fixed');
  });

  it('keeps NaN, undefined and negative amounts out of the shares', () => {
    const d = calcExpenseDistribution([
      exp('nan', NaN),
      exp('missing', undefined as unknown as number),
      exp('negative', -50),
      exp('real', 200),
    ]);
    expect(d.total).toBe(200);
    expect(d.rows.every(r => Number.isFinite(r.amount) && Number.isFinite(r.share))).toBe(true);
    expect(d.rows[0]).toMatchObject({ id: 'real', share: 1 });
  });

  it('gives finite zero shares when everything is zero, and handles an empty list', () => {
    const zero = calcExpenseDistribution([exp('a', 0), exp('b', 0)]);
    expect(zero.rows.map(r => r.share)).toEqual([0, 0]);
    expect(zero.types).toEqual([]);
    expect(zero.topThreeShare).toBeNull();

    const empty = calcExpenseDistribution([]);
    expect(empty.rows).toEqual([]);
    expect(empty.hiddenShare).toBe(0);
  });

  it('keeps rows with the same name apart by id', () => {
    const d = calcExpenseDistribution([
      { id: '1', name: 'Forsikring', amount: 100 },
      { id: '2', name: 'Forsikring', amount: 100 },
    ]);
    expect(d.rows.map(r => r.id)).toEqual(['1', '2']);
  });

  it('reports the top three only with at least five paying rows', () => {
    expect(calcExpenseDistribution([...list(4), exp('zero', 0)]).topThreeShare).toBeNull();
    expect(calcExpenseDistribution([exp('a', 50), exp('b', 20), exp('c', 10), exp('d', 10), exp('e', 10)]).topThreeShare).toBe(0.8);
  });

  it('does not fold a list that would hide fewer than three rows', () => {
    const d = calcExpenseDistribution(list(DISTRIBUTION_VISIBLE_ROWS + 2));
    expect(d.visibleRows).toHaveLength(DISTRIBUTION_VISIBLE_ROWS + 2);
    expect(d.hiddenRows).toEqual([]);
  });

  it('folds a long list so visible and hidden still add up to the total', () => {
    const d = calcExpenseDistribution(list(40));
    expect(d.visibleRows).toHaveLength(DISTRIBUTION_VISIBLE_ROWS);
    expect(d.hiddenRows).toHaveLength(40 - DISTRIBUTION_VISIBLE_ROWS);
    const visibleTotal = d.visibleRows.reduce((s, r) => s + r.amount, 0);
    expect(visibleTotal + d.hiddenTotal).toBe(d.total);
    expect(d.hiddenShare).toBeCloseTo(d.hiddenTotal / d.total);
  });
});

describe('formatShare', () => {
  const clean = (s: string) => s.replace(/\s/g, ' ');

  it('uses whole numbers from 10 % and one decimal below', () => {
    expect(clean(formatShare(0.5678, 'nb-NO'))).toBe('57 %');
    expect(clean(formatShare(0.0321, 'nb-NO'))).toBe('3,2 %');
    expect(formatShare(0.0321, 'en-US')).toBe('3.2%');
  });

  it('never rounds a tiny share down to 0', () => {
    expect(formatShare(0.0001, 'en-US')).toBe('<0.1%');
    expect(formatShare(0, 'en-US')).toBe('0%');
  });

  it('shows a non-finite share as 0', () => {
    expect(formatShare(NaN, 'en-US')).toBe('0%');
  });
});
