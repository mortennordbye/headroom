// The Budget page's distribution of fixed expenses: each row's share of the total,
// the split by expense type, and how a long list folds. Pure + unit-tested.

import type { ExpenseType, FixedExpense } from '../context/FinanceContext';
import { amount, fixedExpenseTotalsByType } from './fixedExpenseTotals';

/** Rows shown before a long list folds the rest into one summed row. */
export const DISTRIBUTION_VISIBLE_ROWS = 8;
/** Folding one or two rows saves nothing, so a list only folds past this many hidden. */
const MIN_HIDDEN_ROWS = 3;
/** Below this many paying rows, "the 3 biggest" says nothing about concentration. */
const MIN_ROWS_FOR_TOP_THREE = 5;

export interface DistributionRow {
  id: string;
  name: string;
  type: ExpenseType;
  amount: number;
  /** Fraction of the total, 0 to 1. */
  share: number;
}

export interface DistributionType {
  type: ExpenseType;
  total: number;
  share: number;
}

export interface ExpenseDistribution {
  total: number;
  /** Every row, biggest first. */
  rows: DistributionRow[];
  /** Types with money on them, biggest first. */
  types: DistributionType[];
  /** The three biggest rows' share of the total, or null when too few rows to mean anything. */
  topThreeShare: number | null;
  visibleRows: DistributionRow[];
  hiddenRows: DistributionRow[];
  hiddenTotal: number;
  hiddenShare: number;
}

export function calcExpenseDistribution(expenses: FixedExpense[]): ExpenseDistribution {
  const total = expenses.reduce((sum, e) => sum + amount(e.amount), 0);
  const shareOf = (n: number) => (total > 0 ? n / total : 0);
  const sum = (rows: DistributionRow[]) => rows.reduce((s, r) => s + r.amount, 0);

  const rows = expenses
    .map((e): DistributionRow => ({
      id: e.id,
      name: e.name,
      type: e.type ?? 'fixed',
      amount: amount(e.amount),
      share: shareOf(amount(e.amount)),
    }))
    .sort((a, b) => b.amount - a.amount);

  const types = fixedExpenseTotalsByType(expenses)
    .map(t => ({ ...t, share: shareOf(t.total) }))
    .sort((a, b) => b.total - a.total);

  const payingRows = rows.filter(r => r.amount > 0);
  const topThreeShare = payingRows.length >= MIN_ROWS_FOR_TOP_THREE ? shareOf(sum(payingRows.slice(0, 3))) : null;

  const folds = rows.length >= DISTRIBUTION_VISIBLE_ROWS + MIN_HIDDEN_ROWS;
  const visibleRows = folds ? rows.slice(0, DISTRIBUTION_VISIBLE_ROWS) : rows;
  const hiddenRows = folds ? rows.slice(DISTRIBUTION_VISIBLE_ROWS) : [];
  const hiddenTotal = sum(hiddenRows);

  return { total, rows, types, topThreeShare, visibleRows, hiddenRows, hiddenTotal, hiddenShare: shareOf(hiddenTotal) };
}

/**
 * A share (0 to 1) as a locale percentage: whole numbers from 10 %, one decimal
 * below, and "<0,1 %" rather than a misleading 0 % for a tiny non-zero share.
 */
export function formatShare(share: number, locale: string): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  if (!(share > 0)) return format(0, 0);
  if (share < 0.001) return `<${format(0.001, 1)}`;
  return format(share, share < 0.1 ? 1 : 0);
}
