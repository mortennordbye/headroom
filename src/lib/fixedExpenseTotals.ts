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
 * line except `subscription`. Subscriptions are discretionary (Netflix, Spotify
 * — the things you cancel in a real emergency). Savings need no exclusion here
 * any more: they are not in this list at all, which is the point of them being
 * their own record — pausing the transfer is the FIRST thing you do in an
 * emergency, so counting one made the buffer look short of a bill that doesn't
 * exist. Untyped legacy rows count as 'fixed' (essential).
 */
const NON_ESSENTIAL: ReadonlySet<ExpenseType> = new Set<ExpenseType>(['subscription']);

export function essentialMonthlyExpenses(expenses: FixedExpense[]): number {
  return expenses
    .filter(e => !NON_ESSENTIAL.has(e.type ?? 'fixed'))
    .reduce((sum, e) => sum + amount(e.amount), 0);
}
