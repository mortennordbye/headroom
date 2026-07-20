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
import { isSpend } from './spend';
import { isCategoryKey, type CategoryKey } from './categories';
import { spendByCategory } from './categoryStats';
import { buildMatchHaystack } from './text';

export type EnvelopeStatus = 'under' | 'near' | 'over';

/** Spend has reached this fraction of the budget → 'near' (amber warning). */
export const NEAR_THRESHOLD = 0.85;

export interface Envelope {
  /** Unique key: `exp:<id>` for a pattern (match) envelope, else the category. */
  key: string;
  category?: CategoryKey;   // set for category-linked envelopes
  match?: string;           // set (lowercased) for pattern envelopes
  name?: string;            // fixed-expense name (for pattern envelopes / display)
  /** Fixed expenses feeding this envelope (usually one; summed when several). */
  expenseIds: string[];
  budgeted: number;       // sum of the linked fixed-expense amounts
  actual: number;         // month-to-date expense spend matched to this envelope
  remaining: number;      // budgeted - actual (negative when overspent)
  overspent: number;      // max(0, actual - budgeted) — spills into discretionary
  unused: number;         // max(0, budgeted - actual) — returns to surplus
  status: EnvelopeStatus;
}

export interface Reconciliation {
  /** All envelopes (pattern + category), biggest budget first. */
  envelopes: Envelope[];
  byCategory: Map<CategoryKey, Envelope>;    // category envelopes only
  byExpenseId: Map<string, Envelope>;        // fixed-expense id → its envelope
  envelopedCategories: Set<CategoryKey>;     // categories covered by a category envelope
  /** Pattern → envelope key, in priority order (used to resolve a tx's envelope). */
  matchers: { match: string; key: string }[];
  budgetByKey: Map<string, number>;          // envelope key → budgeted (for the ledger)
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
 * The envelope a transaction belongs to, or undefined. A pattern (`match`)
 * envelope wins over a category envelope — that's what makes "Ruter → the Ruter
 * line" precise instead of drawing down every Transport transaction. Income
 * never draws an envelope.
 */
export function envelopeKeyForTx(tx: DailyTransaction, rec: Pick<Reconciliation, 'matchers' | 'envelopedCategories'>): string | undefined {
  if (!isSpend(tx)) return undefined;
  if (rec.matchers.length) {
    const hay = buildMatchHaystack(tx.merchant, tx.description);
    for (const m of rec.matchers) if (m.match && hay.includes(m.match)) return m.key;
  }
  if (isCategoryKey(tx.category) && rec.envelopedCategories.has(tx.category)) return tx.category;
  return undefined;
}

/**
 * Reconcile linked fixed expenses against a month's transactions. A fixed
 * expense with a `match` pattern gets its own envelope drawn down only by
 * matching transactions; otherwise a `category` link folds fixed expenses of the
 * same category into one shared envelope. Pattern-matched transactions are
 * removed from their category envelope's actuals so nothing is counted twice.
 */
export function reconcile(
  fixedExpenses: FixedExpense[],
  transactions: DailyTransaction[],
  monthKey: string,
): Reconciliation {
  const budgetByKey = new Map<string, number>();
  const byExpenseId = new Map<string, Envelope>();
  const matchers: { match: string; key: string }[] = [];

  // 1. Pattern envelopes (fixed expenses with a `match`).
  const patternEnvelopes: Envelope[] = [];
  for (const e of fixedExpenses) {
    const m = (e.match ?? '').trim().toLowerCase();
    if (!m) continue;
    const key = `exp:${e.id}`;
    const env: Envelope = {
      key, match: m, name: e.name, expenseIds: [e.id],
      budgeted: e.amount, actual: 0, remaining: e.amount, overspent: 0, unused: e.amount, status: 'under',
    };
    patternEnvelopes.push(env);
    byExpenseId.set(e.id, env);
    matchers.push({ match: m, key });
    budgetByKey.set(key, e.amount);
  }

  // 2. Category envelopes (fixed expenses with a category and no `match`).
  const budgetByCat = new Map<CategoryKey, { budgeted: number; expenseIds: string[] }>();
  for (const e of fixedExpenses) {
    if ((e.match ?? '').trim()) continue; // a pattern already claims this expense
    if (!isCategoryKey(e.category)) continue;
    const entry = budgetByCat.get(e.category) ?? { budgeted: 0, expenseIds: [] };
    entry.budgeted += e.amount;
    entry.expenseIds.push(e.id);
    budgetByCat.set(e.category, entry);
  }
  const envelopedCategories = new Set(budgetByCat.keys());
  for (const [category, { budgeted }] of budgetByCat) budgetByKey.set(category, budgeted);

  // 3. Sum each envelope's actual by resolving every month expense to its key.
  const rec = { matchers, envelopedCategories };
  const actualByKey = new Map<string, number>();
  for (const tx of transactions) {
    if (!isSpend(tx) || !tx.date.startsWith(monthKey)) continue;
    const key = envelopeKeyForTx(tx, rec);
    if (key) actualByKey.set(key, (actualByKey.get(key) ?? 0) + tx.amount);
  }

  const finalize = (env: Envelope): Envelope => {
    const actual = actualByKey.get(env.key) ?? 0;
    return {
      ...env, actual,
      remaining: env.budgeted - actual,
      overspent: Math.max(0, actual - env.budgeted),
      unused: Math.max(0, env.budgeted - actual),
      status: statusFor(env.budgeted, actual),
    };
  };

  const envelopes: Envelope[] = [];
  const byCategory = new Map<CategoryKey, Envelope>();
  for (const env of patternEnvelopes) {
    const final = finalize(env);
    envelopes.push(final);
    byExpenseId.set(env.expenseIds[0], final);
  }
  for (const [category, { budgeted, expenseIds }] of budgetByCat) {
    const final = finalize({ key: category, category, expenseIds, budgeted, actual: 0, remaining: budgeted, overspent: 0, unused: budgeted, status: 'under' });
    envelopes.push(final);
    byCategory.set(category, final);
    for (const id of expenseIds) byExpenseId.set(id, final);
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

  return { envelopes, byCategory, byExpenseId, envelopedCategories, matchers, budgetByKey, totals };
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
    if (isCategoryKey(e.category) || (e.match ?? '').trim()) continue; // already an envelope
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
  const used = new Map<string, number>();
  return {
    draw(tx: DailyTransaction): EnvelopeDraw {
      if (!isSpend(tx)) return { covered: 0, spillover: 0 };
      const key = envelopeKeyForTx(tx, reconciliation);
      if (!key || !reconciliation.budgetByKey.has(key)) {
        return { covered: 0, spillover: tx.amount };
      }
      const budget = reconciliation.budgetByKey.get(key)!;
      const before = used.get(key) ?? 0;
      const covered = Math.max(0, Math.min(tx.amount, budget - before));
      used.set(key, before + tx.amount);
      return { covered, spillover: tx.amount - covered };
    },
  };
}

/**
 * A month's total discretionary spend — the same envelope-aware figure the
 * daily running balance produces (spillover past a full envelope plus all
 * non-enveloped spend). Income rows never count. Pass transactions with
 * internal transfers already netted out (the context's nonTransferTransactions)
 * so an own-account move doesn't read as spending. Lets "vs last month"
 * comparisons measure the previous month exactly like the current one.
 */
export function discretionarySpendForMonth(
  transactions: DailyTransaction[],
  fixedExpenses: FixedExpense[],
  monthKey: string,
): number {
  const ledger = createEnvelopeLedger(reconcile(fixedExpenses, transactions, monthKey));
  let total = 0;
  for (const t of transactions) {
    if (!isSpend(t) || !t.date.startsWith(monthKey)) continue;
    total += ledger.draw(t).spillover;
  }
  return total;
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
      if (!isSpend(t)) {
        // Real income still reported per day for display; an ambiguous row
        // (kind:'expense' but categorised income) is simply skipped.
        if (t.kind === 'income') income += t.amount;
        continue;
      }
      spent += t.amount;
      discretionary += ledger.draw(t).spillover;
    }
    // Income is NOT added. `dailyBudget` already derives from the month's income
    // (recommendedSpending = (income − fixed) × (1 − investRatio)), so adding the
    // salary row on top counted the same money twice — invisible while the app was
    // manual-only (no income rows existed), a large distortion once bank sync began
    // importing the actual paycheck. `income` stays on the point for display.
    balance += dailyBudget - discretionary;
    result.push({ date, spent, discretionary, income, balance });
  }
  return result;
}
