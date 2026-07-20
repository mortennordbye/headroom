// Category aggregations over daily transactions — the shared math behind the
// category dashboard (spend + month-over-month), the multi-month trend chart,
// and per-category budgets. Pure and unit-tested; expenses only — see `isSpend`
// in spend.ts for what counts (income is excluded by kind AND by category).
import type { DailyTransaction } from '../context/FinanceContext';
import { CATEGORY_KEYS, type CategoryKey } from './categories';
import { isSpend } from './spend';

export interface CategorySpend {
  category: string;   // canonical key or legacy free-text label
  amount: number;
}

const isExpense = isSpend;
const monthOf = (t: DailyTransaction) => t.date.slice(0, 7); // 'yyyy-MM'

/** Total expense per category label for one month, biggest first. */
export function spendByCategory(txs: DailyTransaction[], monthKey: string): CategorySpend[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (!isExpense(t) || monthOf(t) !== monthKey) continue;
    const key = t.category || 'other';
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Total expense in one month (all categories). */
export function totalSpend(txs: DailyTransaction[], monthKey: string): number {
  return txs.reduce((sum, t) => (isExpense(t) && monthOf(t) === monthKey ? sum + t.amount : sum), 0);
}

export interface CategoryMoM {
  category: string;
  current: number;
  previous: number;
  /** Signed % change vs the previous month. null when there's no prior spend. */
  pct: number | null;
}

/** Per-category current vs previous month totals + % change. */
export function categoryMoM(
  txs: DailyTransaction[],
  monthKey: string,
  prevMonthKey: string,
): CategoryMoM[] {
  const cur = new Map(spendByCategory(txs, monthKey).map((r) => [r.category, r.amount]));
  const prev = new Map(spendByCategory(txs, prevMonthKey).map((r) => [r.category, r.amount]));
  const categories = new Set([...cur.keys(), ...prev.keys()]);
  return [...categories]
    .map((category) => {
      const current = cur.get(category) ?? 0;
      const previous = prev.get(category) ?? 0;
      // No prior spend → % is undefined (avoid divide-by-zero / Infinity).
      const pct = previous > 0 ? ((current - previous) / previous) * 100 : null;
      return { category, current, previous, pct };
    })
    .sort((a, b) => b.current - a.current);
}

export interface MonthCategoryRow {
  month: string; // 'yyyy-MM'
  total: number;
  /** One numeric field per canonical category key present across the range. */
  [category: string]: number | string;
}

/**
 * Expense totals per canonical category across an ordered list of months, shaped
 * for a stacked chart. Legacy/custom free-text categories are folded into
 * 'other' so the series keys stay within the canonical set.
 */
export function monthlyCategoryTotals(txs: DailyTransaction[], months: string[]): MonthCategoryRow[] {
  const canonical = new Set<string>(CATEGORY_KEYS);
  const byMonth = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  for (const t of txs) {
    if (!isExpense(t)) continue;
    const m = monthOf(t);
    const bucket = byMonth.get(m);
    if (!bucket) continue; // outside the requested range
    const key = canonical.has(t.category ?? '') ? (t.category as string) : 'other';
    bucket.set(key, (bucket.get(key) ?? 0) + t.amount);
  }
  return months.map((month) => {
    const bucket = byMonth.get(month)!;
    const row: MonthCategoryRow = { month, total: 0 };
    for (const key of CATEGORY_KEYS) {
      const v = bucket.get(key) ?? 0;
      if (v > 0) row[key] = v;
      row.total += v;
    }
    return row;
  });
}

export interface BudgetProgress {
  category: CategoryKey;
  budget: number;
  spent: number;
  /** spent / budget as a %, capped for the bar at 100 but reported raw here. */
  pct: number;
  over: boolean;
}

/** Actual-vs-budget for each category that has a budget set (>0). */
export function budgetProgress(
  txs: DailyTransaction[],
  monthKey: string,
  budgets: Partial<Record<CategoryKey, number>>,
): BudgetProgress[] {
  const spent = new Map(spendByCategory(txs, monthKey).map((r) => [r.category, r.amount]));
  return CATEGORY_KEYS
    .filter((key) => (budgets[key] ?? 0) > 0)
    .map((category) => {
      const budget = budgets[category]!;
      const s = spent.get(category) ?? 0;
      return { category, budget, spent: s, pct: (s / budget) * 100, over: s > budget };
    });
}
