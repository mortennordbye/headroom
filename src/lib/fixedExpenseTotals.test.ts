import { describe, it, expect } from 'vitest';
import { fixedExpenseTotalsByType } from './fixedExpenseTotals';
import type { FixedExpense } from '../context/FinanceContext';

const exp = (id: string, amount: number, type?: FixedExpense['type']): FixedExpense => ({ id, name: id, amount, type });

describe('fixedExpenseTotalsByType', () => {
  it('sums amounts per type and keeps the stable order', () => {
    const totals = fixedExpenseTotalsByType([
      exp('a', 400, 'insurance'),
      exp('b', 500, 'subscription'),
      exp('c', 400, 'subscription'),
      exp('d', 1000, 'fixed'),
    ]);
    expect(totals).toEqual([
      { type: 'fixed', total: 1000 },
      { type: 'subscription', total: 900 },
      { type: 'insurance', total: 400 },
    ]);
  });

  it('treats an untyped row as fixed', () => {
    const totals = fixedExpenseTotalsByType([exp('a', 300), exp('b', 200, 'fixed')]);
    expect(totals).toEqual([{ type: 'fixed', total: 500 }]);
  });

  it('omits types with no expenses', () => {
    const totals = fixedExpenseTotalsByType([exp('a', 250, 'subscription')]);
    expect(totals).toEqual([{ type: 'subscription', total: 250 }]);
  });

  it('guards NaN amounts and drops a zero-total type', () => {
    const totals = fixedExpenseTotalsByType([exp('a', NaN, 'variable'), exp('b', 600, 'fixed')]);
    expect(totals).toEqual([{ type: 'fixed', total: 600 }]);
  });

  it('returns an empty list for no expenses', () => {
    expect(fixedExpenseTotalsByType([])).toEqual([]);
  });
});
