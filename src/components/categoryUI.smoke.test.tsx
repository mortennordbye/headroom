// Headless render smoke for the category UI. Mocks useFinance and renders each
// component to a static string via react-dom/server — no browser/jsdom needed.
// Executes the real JSX/hook paths, so a runtime error (bad field access, map
// over undefined, broken import) fails the test. Recharts needs a real DOM to
// draw, so the trend chart renders empty here; the assertion is only "no throw".
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36), date: '2026-07-05', description: 'x', amount: 100, kind: 'expense', ...o,
});

const TRANSACTIONS: DailyTransaction[] = [
  tx({ date: '2026-07-03', amount: 742, description: 'Rema 1000', category: 'groceries' }),
  tx({ date: '2026-07-09', amount: 850, description: 'Ruter', category: 'transport' }),
  tx({ date: '2026-07-12', amount: 640, description: 'Dinner', category: 'dining' }),
  tx({ date: '2026-07-15', amount: 5000, description: 'Salary', category: 'income', kind: 'income' }),
  tx({ date: '2026-06-20', amount: 500, description: 'Rema 1000', category: 'groceries' }),
  tx({ date: '2026-07-18', amount: 90, description: 'Gammel', category: 'Mat' }), // legacy free-text
];

const categoryLabels = {
  groceries: 'Groceries', dining: 'Dining', transport: 'Transport', health: 'Health',
  entertainment: 'Entertainment', shopping: 'Shopping', utilities: 'Utilities',
  subscriptions: 'Subscriptions', housing: 'Housing', transfers: 'Transfers',
  income: 'Income', other: 'Other',
};

const mockCtx = {
  t: {
    categoryLabels,
    spendingByCategory: 'Spending by category', noSpendingThisMonth: 'No spending', newThisMonth: 'new',
    spendingTrend: 'Trend', trendMonths: 'Last 6', categoryBudgets: 'Category budgets',
    budgetLabel: 'Budget', remainingLabel: 'Left', overBudgetBy: 'Over by',
    setBudgets: 'Set budgets', noBudgetsSet: 'No budgets', done: 'Done',
    envelopeManagedNote: 'Managed as envelopes', envelopeTracked: 'Tracked by an envelope',
  },
  currentMonth: new Date('2026-07-15T00:00:00'),
  dailyTransactions: TRANSACTIONS,
  // The Budget analysis components read the filtered list; mirror it to the full
  // set for these smoke renders (no account filter, no transfers).
  visibleBudgetTransactions: TRANSACTIONS,
  categoryBudgets: { groceries: 4000, transport: 800, dining: 700 },
  setCategoryBudget: vi.fn(),
  formatCurrency: (n: number) => `kr ${Math.round(n)}`,
  formatCurrencyShort: (n: number) => `${Math.round(n / 1000)}k`,
  reconciliation: {
    envelopes: [], byCategory: new Map(), envelopedCategories: new Set<string>(),
    totals: { budgeted: 0, actual: 0, overspent: 0, unused: 0 },
  },
};

vi.mock('../context/FinanceContext', () => ({ useFinance: () => mockCtx }));

// Import AFTER the mock is registered.
const { CategoryBreakdown } = await import('./CategoryBreakdown');
const { CategoryBudgets } = await import('./CategoryBudgets');
const CategoryTrendChart = (await import('./charts/CategoryTrendChart')).default;

describe('category UI render smoke', () => {
  it('CategoryBreakdown renders spend rows with localized labels, income excluded', () => {
    const html = renderToStaticMarkup(<CategoryBreakdown />);
    expect(html).toContain('Groceries');
    expect(html).toContain('Transport');
    // income row (5000) must not appear as a spend category
    expect(html).not.toContain('Income');
    // legacy free-text label is shown verbatim
    expect(html).toContain('Mat');
  });

  it('CategoryBreakdown shows an empty state for a month with no spend', () => {
    mockCtx.visibleBudgetTransactions = [];
    expect(renderToStaticMarkup(<CategoryBreakdown />)).toContain('No spending');
    mockCtx.visibleBudgetTransactions = TRANSACTIONS; // restore
  });

  it('CategoryBudgets renders actual-vs-budget with an over-budget warning', () => {
    const html = renderToStaticMarkup(<CategoryBudgets />);
    expect(html).toContain('Category budgets');
    expect(html).toContain('Groceries');
    expect(html).toContain('Over by'); // transport 850 > 800
  });

  it('CategoryTrendChart renders without throwing', () => {
    expect(() => renderToStaticMarkup(<CategoryTrendChart />)).not.toThrow();
  });

  it('hides an enveloped category from CategoryBudgets (envelope supersedes the cap)', () => {
    mockCtx.reconciliation = {
      envelopes: [], byCategory: new Map(),
      envelopedCategories: new Set(['groceries']),
      totals: { budgeted: 0, actual: 0, overspent: 0, unused: 0 },
    };
    const html = renderToStaticMarkup(<CategoryBudgets />);
    expect(html).not.toContain('Groceries'); // superseded by its envelope
    expect(html).toContain('Over by');       // transport cap still tracked
    mockCtx.reconciliation = {
      envelopes: [], byCategory: new Map(), envelopedCategories: new Set<string>(),
      totals: { budgeted: 0, actual: 0, overspent: 0, unused: 0 },
    };
  });

  it('marks an enveloped category as tracked in CategoryBreakdown', () => {
    mockCtx.reconciliation.envelopedCategories = new Set(['groceries']);
    const html = renderToStaticMarkup(<CategoryBreakdown />);
    expect(html).toContain('Tracked by an envelope');
    mockCtx.reconciliation.envelopedCategories = new Set<string>();
  });
});
