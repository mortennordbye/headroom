import { describe, it, expect } from 'vitest';
import type { ExportPayload } from '../src/context/FinanceContext';
import * as derive from './derive';
import { computeEquityBreakdown } from '../src/lib/equity';
import { essentialMonthlyExpenses } from '../src/lib/fixedExpenseTotals';
import { calcDebtToIncome } from '../src/lib/calculations';
import { spendByCategory } from '../src/lib/categoryStats';
import { excludedTransferIds } from '../src/lib/transferRules';

const MONTH = '2026-06';

// A realistic-but-small fixture. Only the four server-required keys are strictly
// needed (income/assets/fixedExpenses/dailyTransactions); the rest exercises the
// derivations.
function fixture(): ExportPayload {
  return {
    income: 60000,
    assets: {
      portfolio: 500000,
      unrealizedGain: 100000,
      taxRate: 37.84,
      crypto: 50000,
      cryptoUnrealizedGain: 10000,
      cryptoTaxRate: 37.84,
      bsu: 30000,
      savings: 0,
      savingsAccounts: [{ id: 's1', name: 'Rainy day', balance: 80000 }],
      houseValue: 4000000,
      houseDebt: 2500000,
      bufferAccount: 120000,
    },
    fixedExpenses: [
      { id: 'f1', name: 'Mortgage', amount: 14000, type: 'fixed' },
      { id: 'f2', name: 'Streaming', amount: 150, type: 'subscription' },
      { id: 'f3', name: 'Insurance', amount: 1200, type: 'insurance' },
    ],
    dailyTransactions: [
      { id: 't1', date: '2026-06-03', description: 'Grocery store', amount: 5000, category: 'groceries', kind: 'expense' },
      { id: 't2', date: '2026-06-10', description: 'Restaurant', amount: 2000, category: 'dining', kind: 'expense' },
      { id: 't3', date: '2026-06-12', description: 'Bus pass', amount: 1500, category: 'transport', kind: 'expense' },
      { id: 't4', date: '2026-05-04', description: 'Grocery store', amount: 4500, category: 'groceries', kind: 'expense' },
      { id: 't5', date: '2026-05-18', description: 'Restaurant', amount: 1800, category: 'dining', kind: 'expense' },
      { id: 't6', date: '2026-04-06', description: 'Grocery store', amount: 4800, category: 'groceries', kind: 'expense' },
    ],
    debts: [
      { id: 'd1', name: 'Student loan', type: 'student', balance: 200000, rate: 0, minPayment: 2000 },
      { id: 'd2', name: 'Credit card', type: 'credit_card', balance: 40000, rate: 20, minPayment: 1500 },
    ],
    goals: [{ id: 'g1', name: 'Down payment', target: 600000, source: 'bufferAccount' }],
    profile: { name: 'Alex Doe', birthDate: '1990-05-01' },
    savingsTargetPercent: 25,
    region: 'no',
  } as ExportPayload;
}

describe('derive (pure, no server)', () => {
  const blob = fixture();

  it('overview: net worth = total equity minus non-mortgage debt', () => {
    const o = derive.overview(blob, MONTH);
    const expected = Math.round(computeEquityBreakdown(blob.assets).totalEquity - (200000 + 40000));
    expect(o.netWorth).toBe(expected);
    expect(o.debt.nonMortgage).toBe(240000);
    expect(o.debt.mortgage).toBe(2500000);
  });

  it('overview: debt-to-income includes the mortgage, gross falls back to income*12', () => {
    const o = derive.overview(blob, MONTH);
    expect(o.grossAnnualIncome).toBe(720000);
    const dti = calcDebtToIncome(2500000 + 240000, 720000);
    expect(o.debt.debtToIncome.ratio).toBeCloseTo(dti.ratio, 6);
  });

  it('overview: surfaces the profile and a compact goals summary with live progress', () => {
    const o = derive.overview(blob, MONTH);
    expect(o.profile.name).toBe('Alex Doe');
    // Down-payment goal (bufferAccount): 120000 / 600000 = 20%
    const g = o.goals.find((x) => x.name === 'Down payment');
    expect(g?.progressPct).toBe(20);
    expect(g?.deadline).toBeNull();
  });

  it('budget: essential expenses exclude subscriptions', () => {
    const b = derive.budgetSummary(blob, MONTH);
    expect(b.essentialMonthlyExpenses).toBe(essentialMonthlyExpenses(blob.fixedExpenses));
    expect(b.essentialMonthlyExpenses).toBe(15200); // 14000 + 1200, not the 150 streaming
    expect(b.totalFixedExpenses).toBe(15350);
    expect(b.cashflowLast12).toHaveLength(12);
  });

  it('spending: category totals match spendByCategory for the month', () => {
    const s = derive.spendingAnalysis(blob, MONTH);
    expect(s.byCategory).toEqual(spendByCategory(blob.dailyTransactions, MONTH));
    const groceries = s.byCategory.find((c) => c.category === 'groceries');
    expect(groceries?.amount).toBe(5000);
  });

  it('spending: nets out own-account transfers (transferRules), matching the app', () => {
    const withTransfer: ExportPayload = {
      ...blob,
      dailyTransactions: [
        ...blob.dailyTransactions,
        { id: 'x1', date: '2026-06-20', description: 'Til: Sparekonto', amount: 9000, category: 'transfers', kind: 'expense' },
      ],
      transferRules: [{ id: 'r1', match: 'Til: Sparekonto' }],
    };
    const s = derive.spendingAnalysis(withTransfer, MONTH);
    const excluded = excludedTransferIds(withTransfer.dailyTransactions, withTransfer.transferRules!);
    const netted = withTransfer.dailyTransactions.filter((t) => !excluded.has(t.id));
    // Totals match the transfer-netted ledger, NOT the raw one — the rule-matched
    // 9000 row never lands in a category.
    expect(s.byCategory).toEqual(spendByCategory(netted, MONTH));
    expect(s.byCategory.find((c) => c.category === 'transfers')).toBeUndefined();
  });

  it('year review: caps at the current month, nets transfers, ranks top categories', () => {
    const r = derive.yearReviewSummary(blob, 2026, MONTH);
    expect(r.year).toBe(2026);
    expect(r.availableYears).toContain(2026);
    expect(r.months[r.months.length - 1]).toBe(MONTH); // no future months
    // 2026 groceries: 5000 (Jun) + 4500 (May) + 4800 (Apr) = 14300, the biggest spend.
    expect(r.topCategories[0]?.category).toBe('groceries');
    expect(r.topCategories.some((c) => c.category === 'transfers')).toBe(false);
  });

  it('year review: defaults to the most recent year with data', () => {
    const r = derive.yearReviewSummary(blob, undefined, MONTH);
    expect(r.year).toBe(2026);
  });

  it('debt: extra payment saves months and interest on the credit card', () => {
    const d = derive.debtAnalysis(blob, 3000, 'avalanche', MONTH);
    expect(d.baseline.feasible).toBe(true);
    expect(d.withExtra.feasible).toBe(true);
    expect(d.withExtra.months).toBeLessThan(d.baseline.months);
    expect(d.interestSaved).toBeGreaterThan(0);
  });

  it('savings & goals: exposes both emergency-fund measures and goal progress', () => {
    const g = derive.savingsAndGoals(blob, MONTH);
    expect(g.emergencyFund.vsEssentialRunway.monthsCovered).toBeCloseTo(120000 / 15200, 4);
    expect(g.emergencyFund.vsTotalFixed.monthsCovered).toBeCloseTo(120000 / 15350, 4);
    const goal = g.goals[0];
    expect(goal.current).toBe(120000); // source bufferAccount
    expect(goal.progressPct).toBe(20); // 120000 / 600000
  });

  it('what_if prepay_vs_invest returns a winner', () => {
    const r = derive.whatIfPrepayVsInvest(blob, 5000, 15, 7);
    expect(['invest', 'prepay', 'tie']).toContain(r.winner);
  });
});
