// Headless render smoke for the Dashboard insight banner. Mocks useFinance and
// renders to a static string — exercises the real insight math + formatting.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36), date: '2026-07-05', description: 'x', amount: 100, kind: 'expense', ...o,
});

const PRIOR = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const TRANSACTIONS: DailyTransaction[] = [
  ...PRIOR.map((m) => tx({ date: `${m}-10`, amount: 1000, category: 'groceries' })),
  tx({ date: '2026-07-10', amount: 500, category: 'groceries' }), // 50% below the 6-mo average
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
    insightMore: 'more', insightLess: 'less',
    insightCategory: 'You spent {pct}% {dir} on {cat} this month than your 6-month average.',
    insightTotal: 'Your total spending is {pct}% {dir} this month than your 6-month average.',
    insightTop: 'Your biggest spending category this month is {cat} ({amount}).',
  },
  currentMonth: new Date('2026-07-15T00:00:00'),
  dailyTransactions: TRANSACTIONS,
  formatCurrency: (n: number) => `kr ${Math.round(n)}`,
};

vi.mock('../context/FinanceContext', () => ({ useFinance: () => mockCtx }));

const InsightBanner = (await import('./InsightBanner')).default;

describe('InsightBanner render smoke', () => {
  it('renders a category-delta headline with localized label', () => {
    const html = renderToStaticMarkup(<InsightBanner />);
    expect(html).toContain('50%');
    expect(html).toContain('less');
    expect(html).toContain('Groceries');
  });

  it('renders nothing when there is no spend', () => {
    mockCtx.dailyTransactions = [];
    expect(renderToStaticMarkup(<InsightBanner />)).toBe('');
    mockCtx.dailyTransactions = TRANSACTIONS; // restore
  });
});
