// Headless render smoke for the allocation panel's target select. A row set up
// as a homeowner to pay down the mortgage, with the housing mode then switched
// to first-buyer, had no matching <option>: the select showed "Bufferkonto" as
// if that were the target. It now keeps the mortgage option, marked invalid.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HousingMode } from '../context/FinanceContext';
import type { SavingsAllocation } from '../lib/savingsAllocation';
import { translations } from '../i18n/translations';

const t = translations.nb;
const mortgageLabel = `${t.expenseDestination.mortgage} (${t.savingsAllocation.notCountedFirstBuyer})`;

const mockCtx = {
  t,
  lang: 'nb' as const,
  assets: { savingsAccounts: [] },
  debts: [],
  housingMode: 'first_buyer' as HousingMode,
  formatCurrency: (n: number) => `${Math.round(n)} kr`,
  currentMonth: new Date(),
  savingsAllocations: [] as SavingsAllocation[],
  addSavingsAllocation: vi.fn(),
  updateSavingsAllocation: vi.fn(),
  removeSavingsAllocation: vi.fn(),
  fixedExpenses: [],
  setFixedExpenses: vi.fn(),
  savings: [],
  setSavings: vi.fn(),
  viewSavings: [],
  viewFixedExpenses: [],
  automationEnabled: true,
  effectiveIncome: 50_000,
  monthlyIncomes: {},
  derivedNetMonthlyFor: () => 50_000,
  savingsTargetPercent: 20,
};

vi.mock('../context/FinanceContext', () => ({
  useFinance: () => mockCtx,
}));

const { SavingsAllocationPanel } = await import('./SavingsAllocationPanel');

const MORTGAGE_ROW: SavingsAllocation = { id: 'r-1', percent: 100, destinationKind: 'mortgage' };

const render = (housingMode: HousingMode, rows: SavingsAllocation[]) => {
  mockCtx.housingMode = housingMode;
  mockCtx.savingsAllocations = rows;
  return renderToStaticMarkup(<SavingsAllocationPanel />);
};

const selectedValue = (html: string) => html.match(/<option[^>]*value="([^"]*)"[^>]*selected=""/)?.[1];

describe('SavingsAllocationPanel — mortgage target in first-buyer mode', () => {
  it('keeps a mortgage row on the mortgage, not the first option', () => {
    const html = render('first_buyer', [MORTGAGE_ROW]);
    expect(selectedValue(html)).toBe('mortgage');
    expect(selectedValue(html)).not.toBe('bufferAccount');
  });

  it('marks that option invalid and the select in the negative colour', () => {
    const html = render('first_buyer', [MORTGAGE_ROW]);
    expect(html).toMatch(/<option[^>]*value="mortgage"[^>]*disabled=""/);
    expect(html).toContain(mortgageLabel);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('color:var(--negative)');
  });

  it('lists no mortgage option in first-buyer mode without a mortgage row', () => {
    const html = render('first_buyer', [{ id: 'r-1', percent: 100, destinationKind: 'portfolio' }]);
    expect(html).not.toContain('value="mortgage"');
  });

  it('lists the mortgage as an ordinary target for a homeowner', () => {
    const html = render('homeowner', [MORTGAGE_ROW]);
    expect(selectedValue(html)).toBe('mortgage');
    expect(html).not.toContain(mortgageLabel);
    expect(html).not.toContain('aria-invalid');
  });
});
