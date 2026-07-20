import { describe, it, expect } from 'vitest';
import { isSpend } from './spend';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction =>
  ({ id: 'a', date: '2026-07-01', description: 'x', amount: 100, ...o }) as DailyTransaction;

describe('isSpend', () => {
  it('counts a plain expense', () => {
    expect(isSpend(tx({ kind: 'expense' }))).toBe(true);
  });

  it('treats a missing kind as an expense (legacy rows)', () => {
    expect(isSpend(tx({}))).toBe(true);
  });

  it('excludes income by kind', () => {
    expect(isSpend(tx({ kind: 'income' }))).toBe(false);
  });

  // The drift this module exists to prevent: categoryStats excluded these while
  // the envelope/discretionary path did not, so the row sat inside "Brukt"
  // while being absent from the category breakdown that should sum to it.
  it('excludes an income-categorised row even when marked kind:"expense"', () => {
    expect(isSpend(tx({ kind: 'expense', category: 'income' }))).toBe(false);
  });
});
