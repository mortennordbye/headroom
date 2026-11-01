// Headless render smoke for DebtSection's month resolution. The card used to be
// hidden on any non-live month because it read `debts` straight from context —
// showing it would have rendered today's balances under a recorded or projected
// label. It now takes the resolved rows, so these assert the two things that
// makes true: the rows on screen come from the prop, and the read-only mode
// drops every write affordance.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Debt, FixedExpense } from '../context/FinanceContext';
import { translations } from '../i18n/translations';

const LIVE: Debt[] = [
  { id: 'd-1', name: 'Studielån', type: 'student', balance: 200_000, rate: 5, minPayment: 3_000 },
];
// The same debt a year of automated extra payments later.
const PROJECTED: Debt[] = [
  { id: 'd-1', name: 'Studielån', type: 'student', balance: 152_500, rate: 5, minPayment: 3_000 },
];

const setDebts = vi.fn();
const mockCtx = {
  t: translations.nb,
  lang: 'nb' as const,
  debts: LIVE,
  fixedExpenses: [] as FixedExpense[],
  setDebts,
  // Plain ASCII spaces on purpose — `toLocaleString('nb-NO')` groups with a
  // non-breaking space, which no literal in this file would ever match.
  formatCurrency: (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} kr`,
};

vi.mock('../context/FinanceContext', () => ({
  useFinance: () => mockCtx,
}));
// The plan-vs-actual chart pulls the context on its own and is irrelevant here.
vi.mock('./charts/DebtPaydownVsPlanChart', () => ({ default: () => null }));

const { default: DebtSection } = await import('./DebtSection');

const render = (props?: { debts?: Debt[]; fixedExpenses?: FixedExpense[]; readOnly?: boolean }) =>
  renderToStaticMarkup(<DebtSection {...props} />);

describe('DebtSection — month resolution', () => {
  it('falls back to the live debts when given no rows', () => {
    const html = render();
    expect(html).toContain('200 000 kr');
    expect(html).not.toContain('152 500 kr');
  });

  it('renders the rows it is handed, not the live ones', () => {
    const html = render({ debts: PROJECTED, readOnly: true });
    expect(html).toContain('152 500 kr');
    // The regression this guards: today's balance leaking into another month.
    expect(html).not.toContain('200 000 kr');
  });

  it('totals the rows on screen rather than the live ones', () => {
    const two = [...PROJECTED, { ...PROJECTED[0], id: 'd-2', name: 'Forbrukslån', balance: 50_000 }];
    const html = render({ debts: two, readOnly: true });
    expect(html).toContain('202 500 kr');
  });

  it('drops the add and delete affordances when read-only', () => {
    const live = render();
    const ro = render({ debts: PROJECTED, readOnly: true });
    expect(live).toContain(translations.nb.debt.add);
    expect(ro).not.toContain(translations.nb.debt.add);
    expect(live).toContain(`${translations.nb.delete} — Studielån`);
    expect(ro).not.toContain(`${translations.nb.delete} — Studielån`);
  });

  it('hides the payoff planner when read-only — it plans from the real month', () => {
    expect(render()).toContain(translations.nb.debt.planner);
    expect(render({ debts: PROJECTED, readOnly: true })).not.toContain(translations.nb.debt.planner);
  });

  it('disables the row buttons when read-only, so nothing opens the editor', () => {
    expect(render({ debts: PROJECTED, readOnly: true })).toContain('disabled');
    expect(render()).not.toContain('disabled');
  });

  it('plans a debt at its linked expense, not its minimum', () => {
    // 200 000 at 5 % with the 3 000 minimum, or a 5 000/mo expense that pays it.
    const pay = (over: Partial<FixedExpense> = {}): FixedExpense[] =>
      [{ id: 'e', name: 'Avdrag', amount: 5_000, destinationKind: 'debt', debtId: 'd-1', ...over }];
    const linked = render({ fixedExpenses: pay() });
    expect(linked).toContain('5 000 kr/');
    expect(linked).not.toContain('3 000 kr/');
    // A paused expense pays nothing, so the row falls back to the minimum.
    const paused = render({ fixedExpenses: pay({ automationPaused: true }) });
    expect(paused).toContain('3 000 kr/');
  });

  it('still shows the empty state through the prop', () => {
    expect(render({ debts: [], readOnly: true })).toContain(translations.nb.debt.none);
  });
});
