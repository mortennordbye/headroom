// Envelope reconciliation — the single source of truth that connects the *plan*
// (fixed expenses linked to a tracked category) with the *actuals* (daily
// transactions). A linked fixed expense is an "envelope": its amount is reserved
// up front (via totalFixedExpenses → daily budget), and real spend in that
// category draws the envelope down instead of being counted against the daily
// budget a second time. Spend beyond the envelope "spills over" into discretionary
// spend; reserved-but-unspent money is "unused" and returns to the month's surplus.
//
// Pure and unit-tested. Every consumer (daily running balance, dashboard, charts,
// the envelope UI) reads from here so the numbers stay consistent everywhere.
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import { isCategoryKey, type CategoryKey } from './categories';
import { spendByCategory } from './categoryStats';

export type EnvelopeStatus = 'under' | 'near' | 'over';

/** Spend has reached this fraction of the budget → 'near' (amber warning). */
export const NEAR_THRESHOLD = 0.85;

export interface Envelope {
  category: CategoryKey;
  /** Fixed expenses feeding this envelope (usually one; summed when several). */
  expenseIds: string[];
  budgeted: number;       // sum of the linked fixed-expense amounts
  actual: number;         // month-to-date expense spend in the category
  remaining: number;      // budgeted - actual (negative when overspent)
  overspent: number;      // max(0, actual - budgeted) — spills into discretionary
  unused: number;         // max(0, budgeted - actual) — returns to surplus
  status: EnvelopeStatus;
}

export interface Reconciliation {
  /** One envelope per distinct linked category, biggest budget first. */
  envelopes: Envelope[];
  byCategory: Map<CategoryKey, Envelope>;
  envelopedCategories: Set<CategoryKey>;
  totals: {
    budgeted: number;
    actual: number;
    overspent: number;
    unused: number;
  };
}

function statusFor(budgeted: number, actual: number): EnvelopeStatus {
  if (actual > budgeted) return 'over';
  if (budgeted > 0 && actual >= budgeted * NEAR_THRESHOLD) return 'near';
  return 'under';
}

/**
 * Reconcile linked fixed expenses against a month's transactions. Envelopes are
 * keyed by category, so several fixed expenses linked to the same category fold
 * into one envelope whose budget is their sum (no double representation).
 */
export function reconcile(
  fixedExpenses: FixedExpense[],
  transactions: DailyTransaction[],
  monthKey: string,
): Reconciliation {
  // Sum the budgeted amount per linked category.
  const budgetByCat = new Map<CategoryKey, { budgeted: number; expenseIds: string[] }>();
  for (const e of fixedExpenses) {
    if (!isCategoryKey(e.category)) continue;
    const entry = budgetByCat.get(e.category) ?? { budgeted: 0, expenseIds: [] };
    entry.budgeted += e.amount;
    entry.expenseIds.push(e.id);
    budgetByCat.set(e.category, entry);
  }

  const spent = new Map(spendByCategory(transactions, monthKey).map((r) => [r.category, r.amount]));

  const envelopes: Envelope[] = [];
  const byCategory = new Map<CategoryKey, Envelope>();
  for (const [category, { budgeted, expenseIds }] of budgetByCat) {
    const actual = spent.get(category) ?? 0;
    const env: Envelope = {
      category,
      expenseIds,
      budgeted,
      actual,
      remaining: budgeted - actual,
      overspent: Math.max(0, actual - budgeted),
      unused: Math.max(0, budgeted - actual),
      status: statusFor(budgeted, actual),
    };
    envelopes.push(env);
    byCategory.set(category, env);
  }
  envelopes.sort((a, b) => b.budgeted - a.budgeted);

  const totals = envelopes.reduce(
    (t, e) => ({
      budgeted: t.budgeted + e.budgeted,
      actual: t.actual + e.actual,
      overspent: t.overspent + e.overspent,
      unused: t.unused + e.unused,
    }),
    { budgeted: 0, actual: 0, overspent: 0, unused: 0 },
  );

  return { envelopes, byCategory, envelopedCategories: new Set(byCategory.keys()), totals };
}

// Expense-name keywords → the category they most likely collide with. Tuned to
// how people *name a fixed-expense line* (e.g. "Mat", "Strøm", "Trening"), which
// is different from how the transaction categorizer keys off merchant names
// (rema/kiwi/…). Deliberately conservative — used only to *suggest* a link the
// user confirms, and only when that category already has real spend.
const NAME_HINTS: [CategoryKey, string[]][] = [
  ['groceries', ['mat', 'dagligvare', 'food', 'grocer', 'handel']],
  ['dining', ['servering', 'restaurant', 'dining', 'lunsj', 'lunch', 'kaffe', 'takeaway']],
  ['transport', ['transport', 'buss', 'kollektiv', 'drivstoff', 'bensin', 'fuel', 'reise', 'parkering']],
  ['health', ['trening', 'gym', 'helse', 'health', 'fitness', 'sats']],
  ['utilities', ['strøm', 'strom', 'electric', 'power', 'mobil', 'telefon', 'phone', 'internett', 'internet', 'bredbånd']],
  ['entertainment', ['underholdning', 'entertainment', 'kino', 'gaming']],
  ['shopping', ['shopping', 'klær', 'clothes', 'shopp']],
];

/**
 * Best-guess spending category for a *fixed-expense name*, or undefined when
 * nothing matches confidently. Used by the collision detector to propose linking
 * a fixed expense (e.g. "Mat") to the category its real transactions land in.
 */
export function suggestCategoryForExpenseName(name: string): CategoryKey | undefined {
  const haystack = ` ${name.toLowerCase()} `;
  for (const [category, keywords] of NAME_HINTS) {
    if (keywords.some((kw) => haystack.includes(kw))) return category;
  }
  return undefined;
}

export interface EnvelopeSuggestion {
  expenseId: string;
  expenseName: string;
  category: CategoryKey;
  /** Real spend this month in the suggested category (why it's worth linking). */
  spent: number;
}

/**
 * Fixed expenses that look like they double-count with tracked spending: an
 * unlinked expense whose name points at a category that (a) has real spend this
 * month and (b) isn't already covered by another envelope. Empty for non-syncers
 * (no spend) and once everything relevant is linked.
 */
export function suggestEnvelopeLinks(
  fixedExpenses: FixedExpense[],
  transactions: DailyTransaction[],
  monthKey: string,
): EnvelopeSuggestion[] {
  const alreadyLinked = new Set<CategoryKey>();
  for (const e of fixedExpenses) if (isCategoryKey(e.category)) alreadyLinked.add(e.category);

  const spent = new Map(spendByCategory(transactions, monthKey).map((r) => [r.category, r.amount]));
  const suggestions: EnvelopeSuggestion[] = [];
  const claimed = new Set<CategoryKey>();
  for (const e of fixedExpenses) {
    if (isCategoryKey(e.category)) continue; // already an envelope
    const category = suggestCategoryForExpenseName(e.name);
    if (!category || alreadyLinked.has(category) || claimed.has(category)) continue;
    const amount = spent.get(category) ?? 0;
    if (amount <= 0) continue; // no real spend → no double-count to fix
    suggestions.push({ expenseId: e.id, expenseName: e.name, category, spent: amount });
    claimed.add(category); // one suggestion per category
  }
  return suggestions;
}

export interface EnvelopeDraw {
  /** Portion drawn from the envelope — already reserved, so NOT discretionary. */
  covered: number;
  /** Portion beyond the envelope — real discretionary spend that reduces balance. */
  spillover: number;
}

/**
 * Day-ordered draw-down cursor for the running-balance loop. Feed it expense
 * transactions in chronological order; each `draw` reports how much of that
 * transaction the envelope covers vs how much spills over into discretionary
 * spend, and advances the envelope's cumulative use. This makes spillover
 * day-accurate — it hits on the exact day the envelope is exhausted.
 *
 * Non-enveloped expenses spill over in full (they were never reserved). Income
 * draws nothing (handled separately by the loop).
 */
export function createEnvelopeLedger(reconciliation: Reconciliation) {
  const budgets = new Map<CategoryKey, number>();
  for (const e of reconciliation.envelopes) budgets.set(e.category, e.budgeted);
  const used = new Map<CategoryKey, number>();
  return {
    draw(tx: DailyTransaction): EnvelopeDraw {
      if (tx.kind === 'income') return { covered: 0, spillover: 0 };
      if (!isCategoryKey(tx.category) || !budgets.has(tx.category)) {
        return { covered: 0, spillover: tx.amount };
      }
      const budget = budgets.get(tx.category)!;
      const before = used.get(tx.category) ?? 0;
      const covered = Math.max(0, Math.min(tx.amount, budget - before));
      used.set(tx.category, before + tx.amount);
      return { covered, spillover: tx.amount - covered };
    },
  };
}

export interface DailyEnvelopePoint {
  date: string;          // 'yyyy-MM-dd'
  spent: number;         // raw expense total that day (what actually left the account)
  discretionary: number; // portion that reduces the running balance (spillover + non-enveloped)
  income: number;
  balance: number;       // running discretionary balance
}

/**
 * The budget daily tracker's running balance, envelope-aware. Days must be in
 * chronological order; transactions are matched to a day by exact date. Envelope-
 * covered spend is excluded from the balance (it was reserved up front via fixed
 * expenses); only the discretionary portion — spillover past a full envelope plus
 * all non-enveloped spend — draws the balance down. Pure so it can be tested apart
 * from the React context that adapts it into DailyDataEntry.
 */
export function runningEnvelopeBalance(
  orderedDays: string[],
  monthTransactions: DailyTransaction[],
  dailyBudget: number,
  reconciliation: Reconciliation,
): DailyEnvelopePoint[] {
  const ledger = createEnvelopeLedger(reconciliation);
  const byDay = new Map<string, DailyTransaction[]>();
  for (const t of monthTransactions) {
    const arr = byDay.get(t.date);
    if (arr) arr.push(t);
    else byDay.set(t.date, [t]);
  }
  const result: DailyEnvelopePoint[] = [];
  let balance = 0;
  for (const date of orderedDays) {
    let spent = 0;
    let discretionary = 0;
    let income = 0;
    for (const t of byDay.get(date) ?? []) {
      if (t.kind === 'income') {
        income += t.amount;
        continue;
      }
      spent += t.amount;
      discretionary += ledger.draw(t).spillover;
    }
    balance += dailyBudget - discretionary + income;
    result.push({ date, spent, discretionary, income, balance });
  }
  return result;
}
