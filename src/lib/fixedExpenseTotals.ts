// Per-type fixed-expense totals. Each fixed expense carries a type
// (fixed | variable | subscription | insurance); this sums the monthly amount
// per type so the Budget can say "subscriptions cost you X kr/mo". Pure +
// unit-tested. Types with no expenses are omitted; the order is stable so the
// summary doesn't reshuffle as amounts change.

import type { FixedExpense, ExpenseType } from '../context/FinanceContext';

/** Finite-and-non-negative guard against a hand-edited undefined/NaN amount. */
const amount = (n: number | undefined): number => (Number.isFinite(n) ? Math.max(0, n as number) : 0);

// Untyped legacy/imported rows count as 'fixed' — matching `expenseColor`'s
// `type ?? 'fixed'` fallback on the Budget page.
const TYPE_ORDER: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];

export interface FixedExpenseTypeTotal {
  type: ExpenseType;
  total: number;
}

export function fixedExpenseTotalsByType(expenses: FixedExpense[]): FixedExpenseTypeTotal[] {
  const sums = new Map<ExpenseType, number>();
  for (const e of expenses) {
    const type = e.type ?? 'fixed';
    sums.set(type, (sums.get(type) ?? 0) + amount(e.amount));
  }
  return TYPE_ORDER
    .map(type => ({ type, total: sums.get(type) ?? 0 }))
    .filter(t => t.total > 0);
}

/**
 * Monthly essential spend for the emergency-fund runway: every fixed-expense
 * line except `subscription`, which is discretionary (Netflix, Spotify — the
 * things you cancel in a real emergency). Counting subscriptions understated
 * the months a buffer covers; excluding them makes "months covered" reflect the
 * spend you actually can't drop. Untyped legacy rows count as 'fixed' (essential).
 */
export function essentialMonthlyExpenses(expenses: FixedExpense[]): number {
  return expenses
    .filter(e => (e.type ?? 'fixed') !== 'subscription')
    .reduce((sum, e) => sum + amount(e.amount), 0);
}
