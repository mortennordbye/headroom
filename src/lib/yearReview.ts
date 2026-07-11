// Assembles a consolidated annual view (income, tax paid, savings rate, top
// spending categories, net-worth change) for one calendar year by composing the
// existing pure aggregators — no new financial formulas of its own. Pure and
// unit-tested; the page (`YearReviewPage`) only renders what this returns.
import type { BalanceSnapshot, DailyTransaction } from '../context/FinanceContext';
import { monthlyCashflow, isSpend, type MonthlyCashflowRow } from './monthlyCashflow';
import { netWorthFromSnapshot } from './netWorth';
import { monthsBetween, yearOf } from './date';

const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export interface YearCategorySpend {
  category: string; // canonical key or legacy free-text label
  amount: number;
}

export interface YearReview {
  year: number;
  /** Calendar months of the year, capped at the current month (no future). */
  months: string[];
  totalIncome: number;
  totalVariable: number;
  totalSpending: number; // fixed + variable across the months
  totalNet: number; // income - spending
  savingsRate: number; // percent, 0 when income ≤ 0
  taxPaid: number; // summed from imported payslips
  taxMonths: number; // how many of the months had a payslip (coverage)
  netWorthStart: number | null;
  netWorthEnd: number | null;
  netWorthChange: number | null;
  topCategories: YearCategorySpend[]; // biggest first, transfers excluded
  monthly: MonthlyCashflowRow[]; // per-month rows for a small chart
}

export interface YearReviewInput {
  transactions: DailyTransaction[];
  /** Per-month net income (real overrides merged with derived salary). */
  incomeByMonth: Record<string, number>;
  totalFixedExpenses: number;
  payslips: Record<string, { tax?: number }>;
  snapshots: Record<string, BalanceSnapshot>;
  netWorthHistory: Record<string, number>;
  currentNetWorth: number;
  /** 'yyyy-MM' of the current month — caps the year and anchors the end value. */
  nowMonthKey: string;
  /** Max categories to return (default 6). */
  topN?: number;
}

/** Net worth at a month from a snapshot, else the recorded history scalar, else null. */
function netWorthAt(
  monthKey: string,
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
): number | null {
  const snap = snapshots[monthKey];
  if (snap) return netWorthFromSnapshot(snap);
  const h = history[monthKey];
  return Number.isFinite(h) ? h : null;
}

export function yearReview(year: number, input: YearReviewInput): YearReview {
  const {
    transactions, incomeByMonth, totalFixedExpenses, payslips,
    snapshots, netWorthHistory, currentNetWorth, nowMonthKey, topN = 6,
  } = input;

  const months = monthsBetween(`${year}-01`, `${year}-12`).filter((m) => m <= nowMonthKey);
  const monthly = monthlyCashflow(months, transactions, incomeByMonth, 0, totalFixedExpenses);

  const totalIncome = monthly.reduce((s, r) => s + r.income, 0);
  const totalVariable = monthly.reduce((s, r) => s + r.variable, 0);
  const totalSpending = monthly.reduce((s, r) => s + r.expenses, 0);
  const totalNet = totalIncome - totalSpending;
  const savingsRate = totalIncome > 0 ? Math.round((totalNet / totalIncome) * 1000) / 10 : 0;

  let taxPaid = 0;
  let taxMonths = 0;
  for (const m of months) {
    const tax = payslips[m]?.tax;
    if (Number.isFinite(tax)) {
      taxPaid += tax as number;
      taxMonths += 1;
    }
  }

  // Net-worth change: first recorded value in the year vs the last. The end
  // anchors to the live current net worth when the year runs to this month.
  let netWorthStart: number | null = null;
  for (const m of months) {
    const v = netWorthAt(m, snapshots, netWorthHistory);
    if (v != null) { netWorthStart = v; break; }
  }
  let netWorthEnd: number | null = null;
  const lastMonth = months[months.length - 1];
  if (lastMonth === nowMonthKey) {
    netWorthEnd = currentNetWorth;
  } else {
    for (let i = months.length - 1; i >= 0; i--) {
      const v = netWorthAt(months[i], snapshots, netWorthHistory);
      if (v != null) { netWorthEnd = v; break; }
    }
  }
  const netWorthChange =
    netWorthStart != null && netWorthEnd != null ? netWorthEnd - netWorthStart : null;

  // Top spending categories across the whole year (transfers are internal moves,
  // not spending, so they're excluded).
  const catMap = new Map<string, number>();
  for (const tx of transactions) {
    if (!isSpend(tx) || yearOf(tx.date) !== year) continue;
    const key = tx.category || 'other';
    if (key === 'transfers') continue;
    catMap.set(key, (catMap.get(key) ?? 0) + finite(tx.amount));
  }
  const topCategories = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN);

  return {
    year, months,
    totalIncome, totalVariable, totalSpending, totalNet, savingsRate,
    taxPaid, taxMonths,
    netWorthStart, netWorthEnd, netWorthChange,
    topCategories, monthly,
  };
}

/**
 * Distinct years that have any data (transactions, payslips, snapshots, history)
 * plus the current year, newest first — the options for the report's year picker.
 */
export function availableReportYears(
  input: Pick<YearReviewInput, 'transactions' | 'payslips' | 'snapshots' | 'netWorthHistory' | 'nowMonthKey'>,
): number[] {
  const years = new Set<number>();
  years.add(yearOf(input.nowMonthKey));
  for (const tx of input.transactions) years.add(yearOf(tx.date));
  for (const k of Object.keys(input.payslips)) years.add(yearOf(k));
  for (const k of Object.keys(input.snapshots)) years.add(yearOf(k));
  for (const k of Object.keys(input.netWorthHistory)) years.add(yearOf(k));
  return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}
