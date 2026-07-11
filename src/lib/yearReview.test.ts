import { describe, it, expect } from 'vitest';
import { yearReview, availableReportYears, type YearReviewInput } from './yearReview';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2),
  date: '2025-03-10',
  description: 'x',
  amount: 0,
  ...over,
});

const baseInput = (over: Partial<YearReviewInput> = {}): YearReviewInput => ({
  transactions: [],
  incomeByMonth: {},
  totalFixedExpenses: 0,
  payslips: {},
  snapshots: {},
  netWorthHistory: {},
  currentNetWorth: 0,
  nowMonthKey: '2026-07',
  ...over,
});

describe('yearReview', () => {
  it('aggregates income, spending, net and savings rate over the year', () => {
    const input = baseInput({
      // full past year 2025
      incomeByMonth: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}`, 40000]),
      ),
      totalFixedExpenses: 10000,
      transactions: [tx({ date: '2025-03-10', amount: 2000, kind: 'expense' })],
    });
    const r = yearReview(2025, input);
    expect(r.months).toHaveLength(12);
    expect(r.totalIncome).toBe(480000);
    expect(r.totalVariable).toBe(2000);
    expect(r.totalSpending).toBe(10000 * 12 + 2000);
    expect(r.totalNet).toBe(480000 - 122000);
    // 358000 / 480000 = 74.583 → 74.6
    expect(r.savingsRate).toBe(74.6);
  });

  it('caps the current year at the current month (no future months)', () => {
    const r = yearReview(2026, baseInput({ nowMonthKey: '2026-07' }));
    expect(r.months).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
  });

  it('sums tax from imported payslips and reports coverage', () => {
    const r = yearReview(2025, baseInput({
      payslips: { '2025-01': { tax: 12000 }, '2025-02': { tax: 13000 } },
    }));
    expect(r.taxPaid).toBe(25000);
    expect(r.taxMonths).toBe(2);
  });

  it('computes net-worth change (start = first recorded, end = current when the year is live)', () => {
    const r = yearReview(2026, baseInput({
      nowMonthKey: '2026-07',
      netWorthHistory: { '2026-01': 1000000 },
      currentNetWorth: 1200000,
    }));
    expect(r.netWorthStart).toBe(1000000);
    expect(r.netWorthEnd).toBe(1200000);
    expect(r.netWorthChange).toBe(200000);
  });

  it('uses the last recorded value as the end for a past year', () => {
    const r = yearReview(2025, baseInput({
      netWorthHistory: { '2025-01': 800000, '2025-11': 950000 },
      currentNetWorth: 1200000, // must be ignored — 2025 is not the live year
    }));
    expect(r.netWorthStart).toBe(800000);
    expect(r.netWorthEnd).toBe(950000);
    expect(r.netWorthChange).toBe(150000);
  });

  it('returns null net-worth change when there is no recorded data', () => {
    const r = yearReview(2024, baseInput());
    expect(r.netWorthChange).toBeNull();
  });

  it('ranks top spending categories, excludes transfers, respects topN', () => {
    const r = yearReview(2025, baseInput({
      topN: 2,
      transactions: [
        tx({ date: '2025-02-01', amount: 5000, kind: 'expense', category: 'groceries' }),
        tx({ date: '2025-03-01', amount: 9000, kind: 'expense', category: 'housing' }),
        tx({ date: '2025-04-01', amount: 1000, kind: 'expense', category: 'dining' }),
        tx({ date: '2025-05-01', amount: 50000, kind: 'expense', category: 'transfers' }), // excluded
        tx({ date: '2025-06-01', amount: 3000, kind: 'income', category: 'income' }), // not spend
      ],
    }));
    expect(r.topCategories).toEqual([
      { category: 'housing', amount: 9000 },
      { category: 'groceries', amount: 5000 },
    ]);
  });
});

describe('availableReportYears', () => {
  it('collects years from all sources plus the current year, newest first', () => {
    const years = availableReportYears({
      transactions: [tx({ date: '2023-05-01' })],
      payslips: { '2024-02': { tax: 1 } },
      snapshots: {},
      netWorthHistory: { '2022-12': 500000 },
      nowMonthKey: '2026-07',
    });
    expect(years).toEqual([2026, 2024, 2023, 2022]);
  });
});
