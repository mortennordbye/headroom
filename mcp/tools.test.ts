import { describe, it, expect } from 'vitest';
import type { ExportPayload } from '../src/context/FinanceContext';
import { DEFAULT_EMPLOYER_COST_CONFIG } from '../src/lib/employerCost';
import * as derive from './derive';
import { computeEquityBreakdown } from '../src/lib/equity';
import { essentialMonthlyExpenses } from '../src/lib/fixedExpenseTotals';
import { calcDebtToIncome } from '../src/lib/calculations';
import { spendByCategory } from '../src/lib/categoryStats';
import { excludedTransferIds } from '../src/lib/transferRules';
import { calcAmortizationSchedule, calcMortgageBalanceByYear } from '../src/lib/calculations';
import { currentMortgage } from '../src/lib/existingMortgage';
import { myHouseDebt } from '../src/lib/ownership';
import { calcPensionIncomeTax, calcTaxByRegion, TAX_YEAR } from '../src/lib/norwegianTax';
import { fullFixture } from './fixture';
import { prepayVsInvestFor } from '../src/lib/prepayVsInvest';
import { retirementIncomeInTodaysKroner } from '../src/lib/retirementIncome';

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

  it('overview: debt-to-income includes the mortgage, gross falls back to the gross of income*12', () => {
    const o = derive.overview(blob, MONTH);
    // No salaries: the gross whose net is 60,000 * 12.
    expect(o.grossAnnualIncome).toBe(1048264);
    const dti = calcDebtToIncome(2500000 + 240000, 1048264);
    expect(o.debt.debtToIncome.ratio).toBeCloseTo(dti.ratio, 6);
  });

  it('without salaries, gross is the gross that nets the monthly income, not net * 12', () => {
    const b = { ...fixture(), salaries: [], jobs: [], income: 40000 };
    const gross = derive.grossAnnualIncome(b, MONTH);
    expect(gross).toBeGreaterThan(480000);
    expect(derive.taxFor(b, gross).netAnnual).toBeCloseTo(480000, -1);
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

  it('what_if prepay_vs_invest gives the Forecast page answer', () => {
    // A first-time buyer in generic mode: the page uses the planned loan's rate,
    // the flat rate as the deduction, and taxes gains at assets.taxRate.
    const b: ExportPayload = {
      ...blob,
      housingMode: 'first_buyer',
      region: 'generic',
      customTaxRatePct: 30,
      homeowner: { ...blob.homeowner!, rente: 4 },
      loan: { ...blob.loan!, rente: 6 },
      assets: { ...blob.assets, taxRate: 37.84 },
    };
    const page = prepayVsInvestFor({
      mortgage: { amortises: false, ratePct: 0 },
      loanRatePct: 6,
      region: 'generic',
      customTaxRatePct: 30,
      investGainsTaxPct: 37.84,
    }, 5000, 7, 15);
    expect(derive.whatIfPrepayVsInvest(b, 5000, 15, 7)).toEqual(page);
    expect(page.afterTaxMortgageRatePct).toBeCloseTo(6 * 0.7, 6);
  });
});

/** Every number reachable in a tool payload is finite (no NaN/Infinity leaking into money math). */
function assertFinite(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe('derive: salary, pension, forecast, housing, transactions', () => {
  const blob = fullFixture();
  // The four keys the server requires and nothing else: a brand-new user.
  const empty = {
    income: 0,
    fixedExpenses: [],
    dailyTransactions: [],
    assets: {
      portfolio: 0, unrealizedGain: 0, taxRate: 0, crypto: 0, cryptoUnrealizedGain: 0, cryptoTaxRate: 0,
      bsu: 0, savings: 0, houseValue: 0, houseDebt: 0, bufferAccount: 0,
    },
  } as unknown as ExportPayload;

  const tools = {
    overview: (b: ExportPayload) => derive.overview(b, MONTH),
    budgetSummary: (b: ExportPayload) => derive.budgetSummary(b, MONTH),
    recommendations: (b: ExportPayload) => derive.recommendations(b, MONTH),
    salaryAndTax: (b: ExportPayload) => derive.salaryAndTax(b, MONTH),
    pensionSummary: (b: ExportPayload) => derive.pensionSummary(b, MONTH),
    forecast: (b: ExportPayload) => derive.forecast(b, {}, MONTH),
    mortgage: (b: ExportPayload) => derive.mortgage(b, MONTH),
    housing: (b: ExportPayload) => derive.housing(b, MONTH),
    employerCost: (b: ExportPayload) => derive.employerCost(b, MONTH),
    assetsAndDebts: (b: ExportPayload) => derive.assetsAndDebts(b),
    queryTransactions: (b: ExportPayload) => derive.queryTransactions(b, {}),
  };

  for (const [name, fn] of Object.entries(tools)) {
    it(`${name}: finite numbers on the full fixture and on an empty blob`, () => {
      assertFinite(fn(blob));
      assertFinite(fn(empty));
    });
  }

  it('salary & tax: the mortgage-interest deduction lowers the tax on the salary', () => {
    const s = derive.salaryAndTax(blob, '2026-07');
    expect(s.grossAnnual).toBe(720000);
    expect(s.activeJobs).toHaveLength(1);
    // Year-one interest on the homeowner loan, deducted from alminnelig inntekt.
    const interest = calcAmortizationSchedule(2500000, 5.5, 25)[0].interestPaid;
    expect(s.annualMortgageInterestDeduction).toBe(Math.round(interest));
    const noDeduction = calcTaxByRegion(720000, 'no', 37.84, 15000, 0, 0);
    expect(noDeduction.totalTax - s.tax!.totalTax).toBeCloseTo(interest * 0.22, 0);
    expect(s.netMonthlyOverridden).toBe(false);
    expect(s.payslip).toBeNull();
  });

  it('salary & tax: the restskatt estimate counts the BSU credit in expected tax', () => {
    const withBsu = (contribution: number) => {
      const b = fullFixture();
      b.housingMode = 'first_buyer';
      b.pension = { ...b.pension, birthYear: new Date().getFullYear() - 25 } as ExportPayload['pension'];
      b.assets = { ...b.assets, bsuAnnualContribution: contribution };
      b.payslips = {
        '2026-01': { gross: 60000, tax: 18000, net: 42000, base: 60000 },
        '2026-02': { gross: 60000, tax: 18000, net: 42000, base: 60000 },
      };
      return derive.salaryAndTax(b, '2026-07').restskatt!;
    };
    // 10% of a 27 500 kr contribution comes off the year's tax.
    expect(withBsu(0).expectedAnnualTax - withBsu(27500).expectedAnnualTax).toBeCloseTo(2750, 0);
  });

  it('net income counts holiday pay above salary as taxed income', () => {
    const withSats = (sats: number) => {
      const b = fullFixture();
      b.employerCostConfig = { ...DEFAULT_EMPLOYER_COST_CONFIG, ...b.employerCostConfig, feriepengesatsPct: sats };
      return b;
    };
    const surplus = derive.holidaySurplus(withSats(12), 2026);
    expect(surplus).toBeGreaterThan(0);
    const gain = (derive.netMonthlyFor(withSats(12), '2026-03') - derive.netMonthlyFor(withSats(0), '2026-03')) * 12;
    // The surplus arrives net of tax at the marginal rate: more than nothing, less than all of it.
    expect(gain).toBeGreaterThan(surplus * 0.4);
    expect(gain).toBeLessThan(surplus);
  });

  it('salary & tax: no salary entries means no invented tax breakdown', () => {
    const b = fullFixture();
    b.salaries = [];
    const s = derive.salaryAndTax(b, '2026-07');
    expect(s.grossAnnual).toBe(0);
    expect(s.tax).toBeNull();
    expect(s.marginalTaxRatePct).toBeNull();
    expect(s.netMonthlyDerived).toBe(60000); // the static income
  });

  it('salary & tax: an override wins as effective income and the payslip is surfaced', () => {
    const s = derive.salaryAndTax(blob, MONTH);
    expect(s.netMonthlyOverridden).toBe(true);
    expect(s.netMonthlyEffective).toBe(60000);
    expect(s.payslip?.gross).toBe(78000);
  });

  it('net income folds in a budget-opted bonus after tax, only in its month', () => {
    const b = fullFixture();
    b.bonuses = [{ id: 'b1', date: '2026-07-15', amount: 30000, type: 'annual', includeInBudget: true }];
    const base = derive.netMonthlyFor(fullFixture(), '2026-07');
    const withBonus = derive.netMonthlyFor(b, '2026-07');
    expect(withBonus).toBeGreaterThan(base);
    expect(withBonus - base).toBeLessThan(30000); // taxed
    expect(derive.netMonthlyFor(b, '2026-08')).toBe(base);
  });

  it('budget summary honours a one-month saving adjustment', () => {
    const b = fullFixture();
    expect(derive.budgetSummary(b, MONTH).monthlySavings).toBe(2000);
    expect(derive.budgetSummary(b, MONTH).monthAdjustment).toBeNull();
    b.savingsMonthOverrides = { [MONTH]: 500 };
    const adjusted = derive.budgetSummary(b, MONTH);
    expect(adjusted.monthlySavings).toBe(500);
    expect(adjusted.monthAdjustment).toBe(500);
    // fixed 21350 + the adjusted 500 saving
    expect(adjusted.totalFixedExpenses).toBe(21850);
  });

  it('pension: a partial stored pension is merged over the defaults, as the app does', () => {
    const b = fullFixture();
    b.pension = { otpBalance: 100000 } as ExportPayload['pension'];
    const p = derive.pensionSummary(b, MONTH);
    assertFinite(p);
    if (!p.configured) throw new Error('expected a configured pension');
    expect(p.otpAnnualContribution).toBe(36000); // 720000 * 5% default employer share
  });

  it('pension: headline income is in today\'s kroner and equals the inTodaysKroner block', () => {
    const real = derive.pensionSummary(blob, MONTH, 3);
    const flat = derive.pensionSummary(blob, MONTH, 0);
    if (!real.configured || !flat.configured) throw new Error('expected a configured pension');
    expect(real.netPensionMonthly).toBe(real.inTodaysKroner.netMonthly);
    expect(real.replacementRatePct).toBe(real.inTodaysKroner.replacementRatePct);
    expect(real.retirementIncomeAnnual.gross).toBe(real.inTodaysKroner.grossAnnual);
    // Inflation discounts the OTP/IPS payouts, so the headline falls with it.
    expect(real.netPensionMonthly).toBeLessThan(flat.netPensionMonthly);
  });

  it('pension: headline income matches the Pension page for the same blob', () => {
    // The page's pipeline (PensionPage.tsx): the nominal OTP/IPS payout from the
    // projected balance, through retirementIncomeInTodaysKroner, taxed as pension income.
    const inflationPct = 3;
    const b = fullFixture();
    const p = derive.pensionSummary(b, MONTH, inflationPct);
    if (!p.configured) throw new Error('expected a configured pension');
    const last = p.projection[p.projection.length - 1];
    const payoutYears = Math.max(1, p.settings.pensionPayoutYears || 10);
    const income = retirementIncomeInTodaysKroner({
      folketrygdAnnual: p.retirementIncomeAnnual.folketrygd,
      afpAnnual: p.retirementIncomeAnnual.afp,
      otpAnnualPayout: last.otp / payoutYears,
      ipsAnnualPayout: last.ips / payoutYears,
      yearsToRetire: p.yearsToRetire,
      inflationPct,
    });
    const net = calcPensionIncomeTax(income.gross, TAX_YEAR).netAnnual;
    const currentNet = calcTaxByRegion(p.pensionableIncome, 'no', 30, p.ipsAnnualContribution, 0).netAnnual;
    expect(Math.abs(p.retirementIncomeAnnual.otp - income.otp)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.retirementIncomeAnnual.gross - income.gross)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.netPensionMonthly - net / 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.replacementRatePct - (net / currentNet) * 100)).toBeLessThanOrEqual(0.1);
  });

  it('pension: projects to retirement and taxes the payout as pension income', () => {
    const p = derive.pensionSummary(blob, MONTH);
    if (!p.configured) throw new Error('expected a configured pension');
    expect(p.yearsToRetire).toBe(67 - (2026 - 1990));
    expect(p.projection).toHaveLength(p.yearsToRetire + 1);
    // Within a krone: the reported gross is itself rounded.
    const expectedNet = calcPensionIncomeTax(p.retirementIncomeAnnual.gross, TAX_YEAR).netAnnual;
    expect(Math.abs(p.retirementIncomeAnnual.net - expectedNet)).toBeLessThanOrEqual(1);
    expect(derive.pensionSummary(empty, MONTH).configured).toBe(false);
  });

  it('forecast: saved assumptions drive the scenario, overrides win', () => {
    const f = derive.forecast(blob, {}, MONTH);
    expect(f.scenario).toMatchObject({ raisePct: 3, savingsPct: 25, years: 20 });
    expect(f.netWorthHistory.map((h) => h.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    const g = derive.forecast(blob, { years: 5, returnPct: 4 }, MONTH);
    expect(g.scenario).toMatchObject({ years: 5, returnPct: 4 });
    expect(g.projection[g.projection.length - 1].yearIndex).toBe(5);
  });

  it('mortgage: the homeowner loan amortizes to zero over its term', () => {
    const m = derive.mortgage(blob, MONTH);
    expect(m.loanKind).toBe('current');
    expect(m.balance).toBe(2500000);
    expect(m.amortizationByYear).toHaveLength(25);
    expect(m.amortizationByYear[24].balance).toBeCloseTo(0, 0);
    const principal = m.amortizationByYear.reduce((s, y) => s + y.principalPaid, 0);
    expect(principal).toBeCloseTo(2500000, 0);
    expect(m.loanToValuePct).toBe(62.5);
    expect(m.timeline).not.toBeNull();
  });

  it('mortgage: the remaining term counts down while the payment holds', () => {
    // blob = the full fixture: term 25 y entered 2026-06, balance written 2026-06.
    const now = derive.mortgage(blob, MONTH);
    expect(now.remainingMonths).toBe(300);
    expect(now.remainingTerm).toEqual({ years: 25, months: 0 });
    expect(now.payoffMonth).toBe('2051-06');
    const later = derive.mortgage(blob, '2027-09');
    expect(later.remainingMonths).toBe(285);
    expect(later.remainingTerm).toEqual({ years: 23, months: 9 });
    expect(later.payoffMonth).toBe('2051-06');
    expect(later.monthlyPayment).toBe(now.monthlyPayment);
    expect(later.status?.annualTaxDeduction).toBe(now.status?.annualTaxDeduction);
  });

  it('mortgage: a 50 % co-owner halves my share, not the loan or its LTV', () => {
    const b = fullFixture();
    const solo = derive.mortgage(b, MONTH);
    b.assets.coOwners = [{ id: 'coo-1', name: 'Samboer', ownershipPct: 50, since: '2026-01' }];
    const m = derive.mortgage(b, MONTH);
    expect(m.balance).toBe(solo.balance);
    expect(m.monthlyPayment).toBe(solo.monthlyPayment);
    expect(m.loanToValuePct).toBe(solo.loanToValuePct);
    expect(m.ownership).toMatchObject({ ownershipPct: 50, debtSharePct: 50 });
    expect(m.ownership.myHouseDebt).toBe(Math.round(b.assets.houseDebt / 2));
    expect(m.ownership.myHouseValue).toBe(Math.round(b.assets.houseValue / 2));
    expect(m.ownership.myMonthlyPayment).toBe(Math.round((solo.monthlyPayment) / 2));
    expect(m.status!.annualTaxDeduction).toBeCloseTo(solo.status!.annualTaxDeduction / 2, 6);
    // Before `since` the user owned it alone.
    expect(derive.mortgage(b, '2025-12').ownership.ownershipPct).toBe(100);

    const o = derive.overview(b, MONTH);
    expect(o.debt.mortgage).toBe(Math.round(b.assets.houseDebt / 2));
    expect(o.debt.mortgageFullLoan).toBe(b.assets.houseDebt);
    expect(o.debt.debtToIncome.ratio).toBeLessThan(o.debt.debtToIncomeFullLoan.ratio);
  });

  it('co-owners: get_mortgage returns the full stored list, and the active subset separately', () => {
    const b = fullFixture();
    b.assets.coOwners = [
      { id: 'old', name: 'Ex', ownershipPct: 50, since: '2020-01', until: '2026-03' },
      { id: 'new', name: 'Ny', ownershipPct: 30, since: '2026-05' },
    ];
    const m = derive.mortgage(b, MONTH);
    expect(m.ownership.coOwners.map((c) => c.id)).toEqual(['old', 'new']);
    expect(m.ownership.activeCoOwners.map((c) => c.id)).toEqual(['new']);
  });

  it('rentefradrag: none for a first buyer, the current loan when transitioning', () => {
    const b = fullFixture();
    b.loan!.laanebelop = 4000000; // the planned purchase loan
    b.transition!.currentMortgageBalance = 1800000;
    b.housingMode = 'first_buyer';
    expect(derive.salaryAndTax(b, '2026-07').annualMortgageInterestDeduction).toBe(0);
    expect(derive.forecast(b, {}, MONTH).projection[0].mortgage).toBe(0);
    b.housingMode = 'transitioning';
    const interest = calcAmortizationSchedule(1800000, 5.5, 25)[0].interestPaid;
    expect(derive.salaryAndTax(b, '2026-07').annualMortgageInterestDeduction).toBe(Math.round(interest));
    expect(derive.forecast(b, {}, MONTH).projection[0].mortgage).toBe(1800000);
  });

  // The Dashboard / Assets / Forecast pages project the home's mortgage from
  // FinanceContext `currentMortgage`: the current loan in the owner modes,
  // a first buyer's Assets debt held flat.
  const pageHomeDebt = (b: ExportPayload, years: number) => {
    const h = b.homeowner;
    const m = currentMortgage(b.housingMode, b.assets, { ...h, rente: h?.rente ?? 5.5, nedbetalingstid: h?.nedbetalingstid ?? 25 }, b.transition, MONTH);
    return calcMortgageBalanceByYear(m.balance, m.ratePct, m.paymentTermMonths / 12, years);
  };

  it('forecast: a first buyer\'s Assets debt is held flat, not amortised on the planned loan', () => {
    const b = fullFixture();
    b.housingMode = 'first_buyer';
    b.assets = { ...b.assets, houseValue: 4800000, houseDebt: 3400000, coOwners: [] };
    b.loan = { ...b.loan!, rente: 5.65, nedbetalingstid: 25 };
    const rows = derive.forecast(b, { years: 10 }, MONTH).projection;
    expect(rows.every((r) => r.homeDebt === 3400000)).toBe(true);
    expect(rows.every((r) => r.mortgage === 0)).toBe(true);
  });

  it('forecast: transitioning projects the current loan at its own rate and term, not the planned loan', () => {
    const b = fullFixture();
    b.housingMode = 'transitioning';
    b.homeowner = { ...b.homeowner!, rente: 4 };
    b.loan = { ...b.loan!, rente: 5.65, nedbetalingstid: 20 };
    const rows = derive.forecast(b, { years: 10 }, MONTH).projection;
    expect(rows.map((r) => r.homeDebt)).toEqual(calcMortgageBalanceByYear(2500000, 4, 25, 10));
    // The mortgage tile is the same series.
    expect(rows.map((r) => r.mortgage)).toEqual(rows.map((r) => r.homeDebt));
  });

  it('forecast: home debt matches the page inputs in every mode, also without a stored term', () => {
    for (const mode of ['first_buyer', 'homeowner', 'transitioning'] as const) {
      const b = fullFixture();
      b.housingMode = mode;
      const rows = derive.forecast(b, { years: 15 }, MONTH).projection;
      expect(rows.map((r) => r.homeDebt)).toEqual(pageHomeDebt(b, 15));
    }
    const old = fullFixture();
    old.housingMode = 'homeowner';
    old.homeowner = { ...old.homeowner!, nedbetalingstid: undefined as unknown as number, nedbetalingstidAsOf: undefined };
    const rows = derive.forecast(old, { years: 15 }, MONTH).projection;
    expect(rows.map((r) => r.homeDebt)).toEqual(calcMortgageBalanceByYear(myHouseDebt(old.assets, MONTH), 5.5, 25, 15));
  });

  it('forecast: the mortgage tile and the net-worth home debt agree, at the user\'s share', () => {
    for (const mode of ['homeowner', 'transitioning'] as const) {
      const b = fullFixture();
      b.housingMode = mode;
      b.assets.coOwners = [{ id: 'c', name: 'Samboer', ownershipPct: 50, since: '2020-01' }];
      const rows = derive.forecast(b, { years: 15 }, MONTH).projection;
      expect(rows.map((r) => r.mortgage)).toEqual(rows.map((r) => r.homeDebt));
      expect(rows[0].homeDebt).toBe(1250000);
    }
  });

  it('co-owners: rentefradrag and wealth tax use the share', () => {
    const b = fullFixture();
    const solo = { s: derive.salaryAndTax(b, '2026-07'), a: derive.assetsAndDebts(b) };
    b.assets.coOwners = [{ id: 'c', name: 'Samboer', ownershipPct: 50, since: '2020-01' }];
    const s = derive.salaryAndTax(b, '2026-07');
    expect(s.annualMortgageInterestDeduction).toBe(Math.round(solo.s.annualMortgageInterestDeduction / 2));
    const a = derive.assetsAndDebts(b);
    expect(a.wealthTax!.valuedAssets).toBeLessThan(solo.a.wealthTax!.valuedAssets);
    expect(a.equityBreakdown.houseEquity).toBeCloseTo(solo.a.equityBreakdown.houseEquity / 2, 6);
  });

  it('co-owners: overview reads equity and debt at the same month', () => {
    const b = fullFixture();
    b.assets.coOwners = [{ id: 'c', name: 'Samboer', ownershipPct: 50, since: '2026-05' }];
    const before = derive.overview(b, '2026-04');
    expect(before.equityBreakdown.houseEquity).toBe(b.assets.houseValue - b.assets.houseDebt);
    expect(before.debt.mortgage).toBe(b.assets.houseDebt);
    const after = derive.overview(b, MONTH);
    expect(after.equityBreakdown.houseEquity).toBe((b.assets.houseValue - b.assets.houseDebt) / 2);
  });

  it('no co-owners: every number matches the solo figures', () => {
    const b = fullFixture();
    const before = { o: derive.overview(b, MONTH), f: derive.forecast(b, {}, MONTH), a: derive.assetsAndDebts(b) };
    b.assets.coOwners = [];
    expect(derive.overview(b, MONTH)).toEqual(before.o);
    expect(derive.forecast(b, {}, MONTH)).toEqual(before.f);
    expect(derive.assetsAndDebts(b).wealthTax).toEqual(before.a.wealthTax);
  });

  it('mortgage: outside homeowner mode the loan is a plan, with no LTV or residence metrics', () => {
    const b = fullFixture();
    b.housingMode = 'transitioning';
    const m = derive.mortgage(b, MONTH);
    expect(m.loanKind).toBe('planned');
    expect(m.loanToValuePct).toBeNull();
    expect(m.residence).toBeNull();
  });

  it('mortgage: transitioning returns the current loan and the planned one side by side', () => {
    const b = fullFixture();
    b.housingMode = 'transitioning';
    b.homeowner = { ...b.homeowner!, rente: 4 };
    const m = derive.mortgage(b, MONTH);
    // Existing fields still describe the planned loan.
    expect(m.loanKind).toBe('planned');
    expect(m.balance).toBe(b.loan!.laanebelop);
    const c = currentMortgage('transitioning', b.assets, b.homeowner, b.transition, MONTH);
    expect(m.current).toMatchObject({ balance: 2500000, ratePct: 4, remainingMonths: c.remainingMonths, balanceAsOf: '2026-06' });
    expect(m.planned).toMatchObject({ balance: b.loan!.laanebelop, ratePct: b.loan!.rente });
    b.housingMode = 'homeowner';
    expect(derive.mortgage(b, MONTH)).toMatchObject({ current: null, planned: null });
  });

  it('housing: manual capacity overrides replace the live inputs', () => {
    const b = fullFixture();
    b.capacityOverrides = { arslonn: 900000, gjeld: null, egenkapital: 1000000 };
    const h = derive.housing(b, MONTH);
    expect(h.borrowingCapacity.inputs).toMatchObject({ grossAnnualIncome: 900000, equity: 1000000 });
    expect(h.borrowingCapacity.inputs.overridden).toEqual({ income: true, debt: false, equity: true });
    // Live debt: student loan 200000 + the credit card counted at its balance (no frame set).
    expect(h.borrowingCapacity.inputs.existingDebt).toBe(240000);
    // 5x income minus existing debt caps the loan.
    expect(h.borrowingCapacity.result.maxDebt).toBe(900000 * 5 - 240000);
    expect(h.secondHome.portfolio.committedCount).toBe(1);
  });

  it('employer cost: solving for rate hits the target margin', () => {
    const e = derive.employerCost(blob, MONTH);
    expect(e.grossAnnual).toBe(720000);
    expect(e.billableHoursPerYear).toBe(1560); // 1950 * 80%
    expect(e.billed.marginPct).toBeCloseTo(20, 0);
  });

  it('query transactions: filters combine and totals cover all matches', () => {
    const all = derive.queryTransactions(blob, {});
    expect(all.count).toBe(3);
    expect(all.transactions[0].id).toBe('t2'); // newest first
    const june = derive.queryTransactions(blob, { from: '2026-06', to: '2026-06', limit: 1 });
    expect(june.count).toBe(2);
    expect(june.returned).toBe(1);
    expect(june.totalExpenses).toBe(7000);
    expect(june.expensesByCategory).toEqual({ groceries: 5000, dining: 2000 });
    expect(derive.queryTransactions(blob, { text: 'grocery', minAmount: 4800 }).count).toBe(1);
    expect(derive.queryTransactions(blob, { to: '2026-06-03' }).count).toBe(2);
  });

  it('query transactions: a legacy row categorised income counts as income, as the app does', () => {
    const b = fullFixture();
    b.dailyTransactions = [...b.dailyTransactions, { id: 'i1', date: '2026-06-25', description: 'Salary', amount: 50000, category: 'income' }];
    const q = derive.queryTransactions(b, {});
    expect(q.totalIncome).toBe(50000);
    expect(q.totalExpenses).toBe(11500);
    expect(q.expensesByCategory.income).toBeUndefined();
    expect(derive.queryTransactions(b, { kind: 'income' }).count).toBe(1);
  });

  it('year review: months without an override use the salary-derived net, not the static income', () => {
    const b = fullFixture();
    b.monthlyIncomes = {};
    const r = derive.yearReviewSummary(b, 2026, MONTH);
    const net = derive.netMonthlyFor(b, '2026-01');
    expect(net).not.toBe(60000);
    expect(r.totalIncome).toBe(net * 6);
  });

  it('recommendations and budget summary agree on savings-rate health', () => {
    const b = fullFixture();
    b.monthlyIncomes = {};
    const budget = derive.budgetSummary(b, MONTH);
    const recs = derive.recommendations(b, MONTH);
    expect(recs.savingsRate).toEqual(budget.savingsRate);
    expect(recs.savingsRateTargetOfIncomePct).toBe(budget.savingsRateTargetOfIncomePct);
  });

  it('region generic taxes at the default 30% flat rate when none is stored', () => {
    const b = fullFixture();
    b.region = 'generic';
    delete b.customTaxRatePct;
    const s = derive.salaryAndTax(b, '2026-07');
    // Flat 30% on gross less the IPS contribution and the year-one mortgage interest.
    const interest = calcAmortizationSchedule(2500000, 5.5, 25)[0].interestPaid;
    expect(s.tax!.totalTax).toBeCloseTo((720000 - 15000 - interest) * 0.3, 0);
    expect(s.marginalTaxRatePct).toBe(30);
  });
});
