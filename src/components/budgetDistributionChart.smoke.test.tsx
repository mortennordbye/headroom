// Headless render of the distribution card through its edge cases. The maths is
// covered in src/lib/expenseDistribution.test.ts; this checks the card shows it.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixedExpense } from '../context/FinanceContext';
import { translations } from '../i18n/translations';

const mockCtx = {
  t: translations.nb,
  lang: 'nb',
  formatCurrencyShort: (n: number) => `${n} kr`,
};
vi.mock('../context/FinanceContext', () => ({ useFinance: () => mockCtx }));

const { default: BudgetDistributionChart } = await import('./BudgetDistributionChart');

const copy = translations.nb.budgetPage.distribution;
const exp = (name: string, amount: number, type?: FixedExpense['type']): FixedExpense => ({ id: name, name, amount, type });
const render = (expenses: FixedExpense[]) =>
  renderToStaticMarkup(<BudgetDistributionChart expenses={expenses} expenseColor={() => 'var(--teal)'} />);

describe('BudgetDistributionChart', () => {
  it('shows the empty message with no expenses', () => {
    expect(render([])).toContain(copy.empty);
  });

  it('shows the type split and the row figures', () => {
    const html = render([exp('Boliglån', 750, 'fixed'), exp('Spotify', 250, 'subscription')]);
    expect(html).toContain(translations.nb.expenseType.fixed);
    expect(html).toContain(translations.nb.expenseType.subscription);
    expect(html).toContain('Boliglån');
    expect(html).toContain('750 kr');
  });

  it('drops the split and shows a dash when everything is zero', () => {
    const html = render([exp('Husleie', 0, 'fixed')]);
    expect(html).not.toContain(translations.nb.expenseType.fixed);
    expect(html).toContain('–');
    expect(html).not.toContain('NaN');
  });

  it('never renders NaN from a broken amount', () => {
    expect(render([exp('Broken', NaN), exp('Real', 100)])).not.toContain('NaN');
  });

  it('folds a long list into a summed row', () => {
    const html = render(Array.from({ length: 12 }, (_, i) => exp(`Row ${i}`, 100)));
    expect(html).toContain(copy.otherRows.replace('{count}', '4'));
    expect(html).toContain('400 kr');
    expect(html).toContain(copy.showAll);
    expect(html).not.toContain('Row 11');
  });

  it('keeps every row of a short list', () => {
    const html = render(Array.from({ length: 10 }, (_, i) => exp(`Row ${i}`, 100)));
    expect(html).toContain('Row 9');
    expect(html).not.toContain(copy.showAll);
  });
});
