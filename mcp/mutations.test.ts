// Data-safety fleet (pure, no server).
//
// The overriding rule for this money-app: a write must change EXACTLY its target
// slice and leave every other field byte-identical. Losing a user's data is the
// worst outcome, so these tests hammer that invariant against a near-complete
// fixture — if any builder drops or reshapes an unrelated field, a test fails.

import { describe, it, expect } from 'vitest';
import type { ExportPayload } from '../src/context/FinanceContext';
import { fullFixture, topLevelKeys } from './fixture';
import type { FieldChange } from './util';
import {
  setCategoryBudget,
  addGoal,
  updateGoal,
  addFixedExpense,
  updateFixedExpense,
  updateAssumptions,
  setAiContext,
  setProfile,
  deleteGoal,
  deleteFixedExpense,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  addRule,
  deleteRule,
  updateAsset,
  upsertSavingsAccount,
  deleteSavingsAccount,
  upsertDebt,
  deleteDebt,
  updateLoan,
  updateCurrentMortgage,
  setCoOwners,
  setMonthlyIncome,
  addSalary,
  addBonus,
  upsertCompanyGroup,
  deleteCompanyGroup,
  upsertCompanyCostLine,
  deleteCompanyCostLine,
  updateCompanySettings,
  setupCompanyQuick,
  calibrateCompanyFromAccounts,
  companyChanges,
} from './mutations';
import type { CompanyAccounts } from '../src/lib/companyAccounts';
import { companyContext, companyModelSummary } from './derive';
import {
  calcCompany,
  youEconomics,
  sanitizeCompanyModel,
  DEFAULT_COMPANY_MODEL,
  LEVER_RANGES,
  NEUTRAL_LEVERS,
} from '../src/lib/companyCost';
import { buildModelFromAnswers, QUICK_DEFAULTS } from '../src/lib/companySetup';

// Made-up public accounts for calibrate_company_from_accounts: the quick setup's
// own revenue and EBIT at a typical billable share of 80 % and a mean salary of
// 1 000 000 kr, so the fit has a solution.
function madeUpAccounts(b: ExportPayload): CompanyAccounts {
  const ctx = companyContext(b);
  const truth = buildModelFromAnswers({ ...QUICK_DEFAULTS, typicalBillablePct: 80, salaryLow: 850_000, salaryHigh: 1_150_000 }, sanitizeCompanyModel(b.companyModel));
  const r = calcCompany(truth, ctx, NEUTRAL_LEVERS);
  return {
    orgnr: '999900003', name: 'Eksempel Konsulent AS', year: 2025, type: 'SELSKAP', currency: 'NOK',
    revenue: Math.round(r.revenue), operatingResult: Math.round(r.ebit), employees: 52, formCode: 'AS', naceCode: '62.020',
    hasParent: false, inGroup: false, fetchedAt: '2026-11-01T10:00:00.000Z',
  };
}

// Run a builder on a fresh clone; return the before-snapshot, the mutated blob, and the diff.
function applyOn(mutate: (blob: ExportPayload) => FieldChange[]) {
  const after = structuredClone(fullFixture());
  const before = structuredClone(after);
  const changes = mutate(after);
  return { before, after, changes };
}

// Assert every top-level key except `touched` is byte-identical.
function expectPreserved(before: ExportPayload, after: ExportPayload, touched: string[]) {
  for (const key of topLevelKeys()) {
    if (touched.includes(key)) continue;
    expect(after[key as keyof ExportPayload], `field "${key}" must be untouched`).toEqual(
      before[key as keyof ExportPayload],
    );
  }
}

// Assert the blob still satisfies the server's required-shape (isValidFinancePayload).
function expectValidShape(blob: ExportPayload) {
  expect(typeof blob.income).toBe('number');
  expect(blob.assets && typeof blob.assets === 'object').toBe(true);
  expect(Array.isArray(blob.fixedExpenses)).toBe(true);
  expect(Array.isArray(blob.dailyTransactions)).toBe(true);
}

// Assert nothing non-JSON crept in (no undefined values, functions, etc.).
function expectJsonStable(blob: ExportPayload) {
  expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
}

const cases: {
  name: string;
  touched: string[];
  mutate: (blob: ExportPayload) => FieldChange[];
  assertChange: (blob: ExportPayload, changes: FieldChange[]) => void;
}[] = [
  {
    name: 'set_category_budget (set)',
    touched: ['categoryBudgets'],
    mutate: (b) => setCategoryBudget(b, { category: 'transport', amount: 1800 }),
    assertChange: (b) => expect(b.categoryBudgets?.transport).toBe(1800),
  },
  {
    name: 'set_category_budget (clear with 0)',
    touched: ['categoryBudgets'],
    mutate: (b) => setCategoryBudget(b, { category: 'groceries', amount: 0 }),
    assertChange: (b) => expect('groceries' in (b.categoryBudgets ?? {})).toBe(false),
  },
  {
    name: 'add_goal',
    touched: ['goals'],
    mutate: (b) => addGoal(b, { id: 'new-goal', name: 'Car', target: 250000 }),
    assertChange: (b) => {
      const g = b.goals?.find((x) => x.id === 'new-goal');
      expect(g).toMatchObject({ name: 'Car', target: 250000, source: 'manual' });
    },
  },
  {
    name: 'update_goal (single field)',
    touched: ['goals'],
    mutate: (b) => updateGoal(b, { id: 'g1', target: 700000 }),
    assertChange: (b) => {
      expect(b.goals?.find((x) => x.id === 'g1')?.target).toBe(700000);
      // sibling goal untouched
      expect(b.goals?.find((x) => x.id === 'g2')?.manualCurrent).toBe(120000);
    },
  },
  {
    name: 'add_fixed_expense',
    touched: ['fixedExpenses'],
    mutate: (b) => addFixedExpense(b, { id: 'new-fx', name: 'Gym', amount: 400, type: 'subscription' }),
    assertChange: (b) => expect(b.fixedExpenses.find((e) => e.id === 'new-fx')?.amount).toBe(400),
  },
  {
    name: 'update_fixed_expense',
    touched: ['fixedExpenses'],
    mutate: (b) => updateFixedExpense(b, { id: 'f1', amount: 14500 }),
    assertChange: (b) => expect(b.fixedExpenses.find((e) => e.id === 'f1')?.amount).toBe(14500),
  },
  {
    name: 'update_assumptions (one field)',
    touched: ['savingsTargetPercent'],
    mutate: (b) => updateAssumptions(b, { savingsTargetPercent: 30 }),
    assertChange: (b) => expect(b.savingsTargetPercent).toBe(30),
  },
  {
    name: 'update_assumptions (several fields)',
    touched: ['growthReturnRate', 'houseGrowthRate'],
    mutate: (b) => updateAssumptions(b, { growthReturnRate: 8, houseGrowthRate: 4 }),
    assertChange: (b) => {
      expect(b.growthReturnRate).toBe(8);
      expect(b.houseGrowthRate).toBe(4);
    },
  },
  {
    name: 'set_ai_context',
    touched: ['aiContext'],
    mutate: (b) => setAiContext(b, { text: 'New plan: sabbatical in 2028.' }),
    assertChange: (b) => expect(b.aiContext).toBe('New plan: sabbatical in 2028.'),
  },
  {
    name: 'set_profile (single field, preserves the other)',
    touched: ['profile'],
    mutate: (b) => setProfile(b, { name: 'Sam Roe' }),
    assertChange: (b) => {
      expect(b.profile?.name).toBe('Sam Roe');
      expect(b.profile?.birthDate).toBe('1990-05-01'); // untouched
    },
  },
  {
    name: 'set_profile (birth date also sets the pension birth year, as the app does)',
    touched: ['profile', 'pension'],
    mutate: (b) => setProfile(b, { birthDate: '1985-03-02' }),
    assertChange: (b) => {
      expect(b.profile?.birthDate).toBe('1985-03-02');
      expect(b.pension?.birthYear).toBe(1985);
      expect(b.pension?.otpBalance).toBe(fullFixture().pension?.otpBalance); // rest of pension untouched
    },
  },
  {
    name: 'update_fixed_expense (category)',
    touched: ['fixedExpenses'],
    mutate: (b) => updateFixedExpense(b, { id: 'f2', category: 'subscriptions' }),
    assertChange: (b) => expect(b.fixedExpenses.find((e) => e.id === 'f2')?.category).toBe('subscriptions'),
  },
  {
    name: 'delete_goal',
    touched: ['goals'],
    mutate: (b) => deleteGoal(b, { id: 'g1' }),
    assertChange: (b) => expect(b.goals?.map((g) => g.id)).toEqual(['g2']),
  },
  {
    name: 'delete_fixed_expense',
    touched: ['fixedExpenses'],
    mutate: (b) => deleteFixedExpense(b, { id: 'f2' }),
    assertChange: (b) => expect(b.fixedExpenses.map((e) => e.id)).toEqual(['f1', 'f3', 'f4']),
  },
  {
    name: 'add_transaction',
    touched: ['dailyTransactions'],
    mutate: (b) => addTransaction(b, { id: 'new-tx', date: '2026-06-20', description: 'Bus', amount: 40, category: 'transport' }),
    assertChange: (b) => expect(b.dailyTransactions.find((t) => t.id === 'new-tx')).toEqual({
      id: 'new-tx', date: '2026-06-20', description: 'Bus', amount: 40, category: 'transport', categorySource: 'manual', kind: 'expense',
    }),
  },
  {
    name: 'update_transaction (category marks manual)',
    touched: ['dailyTransactions'],
    mutate: (b) => updateTransaction(b, { id: 't2', category: 'entertainment' }),
    assertChange: (b) => {
      expect(b.dailyTransactions.find((t) => t.id === 't2')).toMatchObject({
        category: 'entertainment', categorySource: 'manual', amount: 2000, description: 'Restaurant',
      });
    },
  },
  {
    name: 'delete_transaction (manual row leaves deletedBankIds and deletedBankTombstones alone)',
    touched: ['dailyTransactions'],
    mutate: (b) => deleteTransaction(b, { id: 't1' }),
    assertChange: (b) => expect(b.dailyTransactions.some((t) => t.id === 't1')).toBe(false),
  },
  {
    name: 'add_rule (category)',
    touched: ['categoryRules'],
    mutate: (b) => addRule(b, { id: 'cr-new', type: 'category', match: 'Ruter', category: 'transport' }),
    assertChange: (b) => expect(b.categoryRules).toEqual([
      { id: 'cr1', match: 'REMA', category: 'groceries' },
      { id: 'cr-new', match: 'Ruter', category: 'transport' },
    ]),
  },
  {
    name: 'add_rule (category, same match replaces)',
    touched: ['categoryRules'],
    mutate: (b) => addRule(b, { id: 'cr-new', type: 'category', match: ' rema ', category: 'shopping' }),
    assertChange: (b) => expect(b.categoryRules).toEqual([{ id: 'cr-new', match: 'rema', category: 'shopping' }]),
  },
  {
    name: 'add_rule (label)',
    touched: ['labelRules'],
    mutate: (b) => addRule(b, { id: 'lr-new', type: 'label', match: 'VIPPS*', label: 'Vipps' }),
    assertChange: (b) => expect(b.labelRules?.at(-1)).toEqual({ id: 'lr-new', match: 'VIPPS*', label: 'Vipps' }),
  },
  {
    name: 'add_rule (transfer)',
    touched: ['transferRules'],
    mutate: (b) => addRule(b, { id: 'tr-new', type: 'transfer', match: 'Sparekonto' }),
    assertChange: (b) => expect(b.transferRules?.at(-1)).toEqual({ id: 'tr-new', match: 'Sparekonto' }),
  },
  {
    name: 'delete_rule (label)',
    touched: ['labelRules'],
    mutate: (b) => deleteRule(b, { type: 'label', id: 'lr1' }),
    assertChange: (b) => expect(b.labelRules).toEqual([]),
  },
  {
    name: 'update_asset (portfolio only)',
    touched: ['assets'],
    mutate: (b) => updateAsset(b, { portfolio: 550000, unrealizedGain: -5000 }),
    assertChange: (b) => {
      expect(b.assets.portfolio).toBe(550000);
      expect(b.assets.unrealizedGain).toBe(-5000);
      expect(b.assets.savingsAccounts).toEqual([{ id: 's1', name: 'Rainy day', balance: 80000 }]);
    },
  },
  {
    name: 'update_asset (houseDebt stamps the homeowner date, houseValue mirrors into transition)',
    touched: ['assets', 'homeowner', 'transition'],
    mutate: (b) => updateAsset(b, { houseDebt: 2400000, houseValue: 4200000 }, '2026-07'),
    assertChange: (b) => {
      expect(b.assets.houseDebt).toBe(2400000);
      expect(b.homeowner?.currentMortgageBalanceAsOf).toBe('2026-07');
      expect(b.transition?.currentHouseValue).toBe(4200000);
      expect(b.homeowner?.rente).toBe(5.5); // rest of the slice untouched
    },
  },
  {
    name: 'update_asset (BSU total deposited)',
    touched: ['assets'],
    mutate: (b) => updateAsset(b, { bsuTotalDeposited: 25000 }),
    assertChange: (b) => {
      expect(b.assets.bsuTotalDeposited).toBe(25000);
      expect(b.assets.bsu).toBe(30000); // balance untouched
    },
  },
  {
    name: 'upsert_savings_account (create)',
    touched: ['assets'],
    mutate: (b) => upsertSavingsAccount(b, { id: 'sa-new', create: true, name: 'Holiday', balance: 5000 }),
    assertChange: (b) => expect(b.assets.savingsAccounts?.at(-1)).toEqual({ id: 'sa-new', name: 'Holiday', balance: 5000 }),
  },
  {
    name: 'upsert_savings_account (update balance)',
    touched: ['assets'],
    mutate: (b) => upsertSavingsAccount(b, { id: 's1', create: false, balance: 90000 }),
    assertChange: (b) => {
      expect(b.assets.savingsAccounts).toEqual([{ id: 's1', name: 'Rainy day', balance: 90000 }]);
      expect(b.assets.portfolio).toBe(500000);
    },
  },
  {
    name: 'delete_savings_account',
    touched: ['assets'],
    mutate: (b) => deleteSavingsAccount(b, { id: 's1' }),
    assertChange: (b) => expect(b.assets.savingsAccounts).toEqual([]),
  },
  {
    name: 'upsert_debt (create)',
    touched: ['debts'],
    mutate: (b) => upsertDebt(b, { id: 'd-new', create: true, name: 'Car loan', type: 'consumer', balance: 90000, rate: 9, minPayment: 2500 }),
    assertChange: (b) => expect(b.debts?.at(-1)).toEqual({
      id: 'd-new', name: 'Car loan', type: 'consumer', balance: 90000, rate: 9, minPayment: 2500,
    }),
  },
  {
    name: 'upsert_debt (create revolving zeroes rate/minPayment)',
    touched: ['debts'],
    mutate: (b) => upsertDebt(b, { id: 'd-new', create: true, name: 'Card', type: 'credit_card', balance: 3000, revolving: true, creditLimit: 50000 }),
    assertChange: (b) => expect(b.debts?.at(-1)).toMatchObject({ rate: 0, minPayment: 0, revolving: true, creditLimit: 50000 }),
  },
  {
    name: 'upsert_debt (update balance)',
    touched: ['debts'],
    mutate: (b) => upsertDebt(b, { id: 'd1', create: false, balance: 190000 }),
    assertChange: (b) => expect(b.debts?.find((d) => d.id === 'd1')).toMatchObject({ balance: 190000, interestFreeUntil: '2027-01' }),
  },
  {
    name: 'delete_debt',
    touched: ['debts'],
    mutate: (b) => deleteDebt(b, { id: 'd2' }),
    assertChange: (b) => expect(b.debts?.map((d) => d.id)).toEqual(['d1']),
  },
  {
    name: 'update_loan',
    touched: ['loan'],
    mutate: (b) => updateLoan(b, { rente: 5.1, gyldigTil: '2027-03' }),
    assertChange: (b) => expect(b.loan).toMatchObject({ rente: 5.1, gyldigTil: '2027-03', laanebelop: 2500000 }),
  },
  {
    name: 'update_current_mortgage (term stamps its month, rate only touches homeowner)',
    touched: ['homeowner'],
    mutate: (b) => updateCurrentMortgage(b, { rente: 5.2, termYears: 24, termMonths: 3 }, '2026-07'),
    assertChange: (b) => expect(b.homeowner).toMatchObject({
      rente: 5.2, nedbetalingstid: 24.25, nedbetalingstidAsOf: '2026-07',
      currentMortgageBalanceAsOf: '2026-06',
    }),
  },
  {
    name: 'update_current_mortgage (balance goes to assets.houseDebt and stamps its month)',
    touched: ['homeowner', 'assets'],
    mutate: (b) => updateCurrentMortgage(b, { balance: 2450000 }, '2026-07'),
    assertChange: (b) => {
      expect(b.homeowner).toMatchObject({ currentMortgageBalanceAsOf: '2026-07', nedbetalingstidAsOf: '2026-06' });
      expect(b.assets.houseDebt).toBe(2450000);
    },
  },
  {
    name: 'set_co_owners (writes the list and the stored history)',
    touched: ['assets', 'balanceSnapshots'],
    mutate: (b) => setCoOwners(b, { coOwners: [{ id: 'coo-1', name: 'Samboer', ownershipPct: 50, since: '2026-01' }] }),
    assertChange: (b) => {
      expect(b.assets.coOwners).toEqual([{ id: 'coo-1', name: 'Samboer', ownershipPct: 50, since: '2026-01' }]);
      expect(b.assets.houseValue).toBe(fullFixture().assets.houseValue); // full amounts untouched
      expect(b.balanceSnapshots?.['2026-06'].assets.coOwners).toEqual([{ id: 'coo-1', name: 'Samboer', ownershipPct: 50 }]);
    },
  },
  {
    name: 'set_co_owners (a new row without since owns from the current move-in)',
    touched: ['assets', 'balanceSnapshots'],
    mutate: (b) => setCoOwners(b, { coOwners: [{ name: 'Samboer', ownershipPct: 50 }] }),
    assertChange: (b) => expect(b.assets.coOwners?.[0]).toMatchObject({ name: 'Samboer', since: '2020-01' }),
  },
  {
    name: 'set_monthly_income (set, including 0)',
    touched: ['monthlyIncomes'],
    mutate: (b) => setMonthlyIncome(b, { month: '2026-07', amount: 0 }),
    assertChange: (b) => expect(b.monthlyIncomes).toEqual({ '2026-05': 61000, '2026-06': 60000, '2026-07': 0 }),
  },
  {
    name: 'set_monthly_income (clear)',
    touched: ['monthlyIncomes'],
    mutate: (b) => setMonthlyIncome(b, { month: '2026-05', clear: true }),
    assertChange: (b) => expect(b.monthlyIncomes).toEqual({ '2026-06': 60000 }),
  },
  {
    name: 'add_salary',
    touched: ['salaries'],
    mutate: (b) => addSalary(b, { id: 'sal-new', jobId: 'j1', effectiveDate: '2026-07', grossAnnual: 760000, changeType: 'raise' }),
    assertChange: (b) => expect(b.salaries?.at(-1)).toEqual({
      id: 'sal-new', jobId: 'j1', effectiveDate: '2026-07', grossAnnual: 760000, changeType: 'raise',
    }),
  },
  {
    name: 'add_bonus',
    touched: ['bonuses'],
    mutate: (b) => addBonus(b, { id: 'b-new', date: '2026-06-15', amount: 20000, type: 'performance', jobId: 'j1', includeInBudget: true }),
    assertChange: (b) => expect(b.bonuses?.at(-1)).toEqual({
      id: 'b-new', date: '2026-06-15', amount: 20000, type: 'performance', jobId: 'j1', includeInBudget: true,
    }),
  },
  {
    name: 'upsert_company_group (create delivery)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyGroup(b, { id: 'cg-new', create: true, name: 'Juniors', kind: 'delivery', count: 4, avgGross: 600000, billablePct: 80, hourlyRate: 1000 }),
    assertChange: (b) => expect(b.companyModel?.groups.at(-1)).toEqual({
      id: 'cg-new', name: 'Juniors', kind: 'delivery', count: 4, avgGross: 600000, billablePct: 80, hourlyRate: 1000, realizationPct: 100,
    }),
  },
  {
    name: 'upsert_company_group (create support defaults billable and rate to 0)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyGroup(b, { id: 'cg-new', create: true, name: 'HR', kind: 'support', count: 1, avgGross: 650000 }),
    assertChange: (b) => expect(b.companyModel?.groups.at(-1)).toMatchObject({ billablePct: 0, hourlyRate: 0, realizationPct: 100 }),
  },
  {
    name: 'upsert_company_group (update one field)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyGroup(b, { id: 'cg2', create: false, count: 4 }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.groups.find((g) => g.id === 'cg2')).toMatchObject({ count: 4, avgGross: 950000 });
      expect(changes).toEqual([{ field: 'companyModel.groups[cg2].count', before: 3, after: 4 }]);
    },
  },
  {
    name: 'upsert_company_group (your group made support moves your group)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyGroup(b, { id: 'cg1', create: false, kind: 'support' }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.selfGroupId).toBe('cg2');
      expect(changes).toContainEqual({ field: 'companyModel.selfGroupId', before: 'cg1', after: 'cg2' });
    },
  },
  {
    name: 'delete_company_group (your group)',
    touched: ['companyModel'],
    mutate: (b) => deleteCompanyGroup(b, { id: 'cg1' }),
    assertChange: (b) => {
      expect(b.companyModel?.groups.map((g) => g.id)).toEqual(['cg2', 'cg3']);
      expect(b.companyModel?.selfGroupId).toBe('cg2');
    },
  },
  {
    name: 'upsert_company_cost_line (create, per defaults to company)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyCostLine(b, { id: 'cc-new', create: true, label: 'Travel', amount: 200000 }),
    assertChange: (b) => expect(b.companyModel?.costs.at(-1)).toEqual({ id: 'cc-new', label: 'Travel', amount: 200000, per: 'company' }),
  },
  {
    name: 'upsert_company_cost_line (update)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyCostLine(b, { id: 'cc2', create: false, amount: 30000, per: 'head' }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.costs.find((c) => c.id === 'cc2')).toEqual({ id: 'cc2', label: 'IT', amount: 30000, per: 'head' });
      // per is unchanged, so only the amount is reported.
      expect(changes).toEqual([{ field: 'companyModel.costs[cc2].amount', before: 25000, after: 30000 }]);
    },
  },
  {
    name: 'delete_company_cost_line',
    touched: ['companyModel'],
    mutate: (b) => deleteCompanyCostLine(b, { id: 'cc1' }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.costs.map((c) => c.id)).toEqual(['cc2', 'cc3']);
      expect(changes).toEqual([{
        field: 'companyModel.costs[cc1]', before: { id: 'cc1', label: 'Office', amount: 1500000, per: 'company' }, after: null,
      }]);
    },
  },
  {
    name: 'upsert_company_group (support made delivery keeps its billable share and rate)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyGroup(b, { id: 'cg3', create: false, kind: 'delivery' }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.groups.find((g) => g.id === 'cg3')).toMatchObject({ kind: 'delivery', billablePct: 10, hourlyRate: 1600 });
      expect(changes).toEqual([{ field: 'companyModel.groups[cg3].kind', before: 'support', after: 'delivery' }]);
    },
  },
  {
    name: 'upsert_company_cost_line (pctOfSalary at 100)',
    touched: ['companyModel'],
    mutate: (b) => upsertCompanyCostLine(b, { id: 'cc3', create: false, amount: 100 }),
    assertChange: (b) => expect(b.companyModel?.costs.find((c) => c.id === 'cc3')?.amount).toBe(100),
  },
  {
    name: 'update_company_settings (only given fields change)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { mode: 'simple', hours: { sickPct: 5 }, bonus: { poolPct: 20 } }),
    assertChange: (b) => expect(b.companyModel).toMatchObject({
      mode: 'simple',
      hours: { sickPct: 5, internalPct: 5, holidayDays: 25 },
      bonus: { poolPct: 20, includesHolidayPay: true },
      levers: { utilizationPp: 2, ratePct: 3, salaryPct: 0, realizationPp: 0 },
    }),
  },
  {
    name: 'update_company_settings (levers clamp to the slider range)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { levers: { ratePct: 40, utilizationPp: -99 } }),
    assertChange: (b) => expect(b.companyModel?.levers).toEqual({
      utilizationPp: LEVER_RANGES.utilizationPp.min, ratePct: LEVER_RANGES.ratePct.max, salaryPct: 0, realizationPp: 0,
    }),
  },
  {
    name: 'update_company_settings (targetMarginPct is set, listed and reset to null)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { targetMarginPct: 18 }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.targetMarginPct).toBe(18);
      expect(changes).toEqual([{ field: 'companyModel.targetMarginPct', before: null, after: 18 }]);
      expect(updateCompanySettings(b, { targetMarginPct: null })).toEqual([{ field: 'companyModel.targetMarginPct', before: 18, after: null }]);
      expect(b.companyModel?.targetMarginPct).toBeNull();
    },
  },
  {
    name: 'update_company_settings (market.styrk is set, listed and reset to null)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { market: { styrk: '2511' } }),
    assertChange: (b, changes) => {
      expect(b.companyModel?.market).toEqual({ styrk: '2511' });
      expect(changes).toEqual([{ field: 'companyModel.market.styrk', before: null, after: '2511' }]);
      expect(updateCompanySettings(b, { market: null })).toEqual([{ field: 'companyModel.market.styrk', before: '2511', after: null }]);
      expect(b.companyModel?.market).toBeUndefined();
    },
  },
  {
    name: 'update_company_settings (selfGroupId)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { selfGroupId: 'cg2' }),
    assertChange: (b) => expect(b.companyModel?.selfGroupId).toBe('cg2'),
  },
  {
    name: 'setup_company_quick (first setup builds the model from the answers)',
    touched: ['companyModel'],
    mutate: (b) => setupCompanyQuick(b, { answers: { totalFte: 20, nonBilling: 2, onBench: 1 }, uncertain: ['salary'], confirmReplace: true }),
    assertChange: (b, changes) => {
      const m = b.companyModel!;
      expect(m.groups.find((g) => g.id === 'kons')?.count).toBe(17);
      expect(m.quick).toMatchObject({ uncertain: ['salary'], dontKnow: [], edited: false });
      expect(m.levers).toEqual(NEUTRAL_LEVERS);
      expect(sanitizeCompanyModel(m)).toEqual(m);
      expect(changes).toContainEqual(expect.objectContaining({ field: 'companyModel.quick', before: null }));
    },
  },
  {
    name: 'setup_company_quick (dontKnow uses the industry value)',
    touched: ['companyModel'],
    mutate: (b) => setupCompanyQuick(b, { answers: { realizationPct: 80 }, dontKnow: ['realizationPct'], confirmReplace: true }),
    assertChange: (b) => {
      expect(b.companyModel?.quick?.answers.realizationPct).toBe(QUICK_DEFAULTS.realizationPct);
      expect(b.companyModel?.quick?.dontKnow).toEqual(['realizationPct']);
    },
  },
  {
    name: 'calibrate_company_from_accounts (stores the accounts and fits the guesses)',
    touched: ['companyModel'],
    mutate: (b) => {
      setupCompanyQuick(b, { uncertain: ['salary'], dontKnow: ['typicalBillablePct'], confirmReplace: true });
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b), accounts: madeUpAccounts(b) });
    },
    assertChange: (b, changes) => {
      const m = b.companyModel!;
      expect(m.accounts).toMatchObject({ orgnr: '999900003', year: 2025, type: 'SELSKAP' });
      expect(m.quick!.answers.typicalBillablePct).toBeCloseTo(80, 0);
      expect(Math.abs((m.quick!.answers.salaryLow + m.quick!.answers.salaryHigh) / 2 - 1_000_000)).toBeLessThan(2_000);
      expect(m.quick!.dontKnow).toEqual([]);
      expect(sanitizeCompanyModel(m)).toEqual(m);
      expect(changes).toContainEqual(expect.objectContaining({ field: 'companyModel.accounts', before: null }));
      expect(changes).toContainEqual(expect.objectContaining({ field: 'companyModel.quick.answers.typicalBillablePct' }));
      expect(m.accounts!.fittedAt).toEqual(expect.any(String));
      expect(m.accounts!.fitMoves!.map((x) => x.key)).toEqual(['typicalBillablePct', 'salary']);
      expect(companyModelSummary(b)).toMatchObject({ basis: 'accounts', accountsMatch: 'match' });
    },
  },
  {
    name: 'calibrate_company_from_accounts (marks salary and the typical share as guesses itself)',
    touched: ['companyModel'],
    mutate: (b) => {
      setupCompanyQuick(b, { uncertain: ['rateAverage'], dontKnow: [], confirmReplace: true });
      b.companyModel = { ...b.companyModel!, accounts: madeUpAccounts(b) };
      expect(companyModelSummary(b)).toMatchObject({ basis: 'guesses' });
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b) });
    },
    assertChange: (b, changes) => {
      const m = b.companyModel!;
      expect(m.quick!.uncertain).toEqual(expect.arrayContaining(['rateAverage', 'salary', 'typicalBillablePct']));
      expect(changes).toContainEqual(expect.objectContaining({ field: 'companyModel.accounts.fittedAt', before: null }));
      // A later hand edit drops the fit marker, and the diff says so.
      const later = upsertCompanyGroup(b, { id: 'kons', create: false, count: 3 });
      expect(b.companyModel!.accounts!.fittedAt).toBeUndefined();
      expect(later).toContainEqual(expect.objectContaining({ field: 'companyModel.accounts.fittedAt', after: null }));
      expect(companyModelSummary(b).basis).toBe('guesses');
    },
  },
  {
    name: 'update_company_settings (applyLevers writes them into the groups)',
    touched: ['companyModel'],
    mutate: (b) => updateCompanySettings(b, { applyLevers: true }),
    assertChange: (b) => {
      expect(b.companyModel?.levers).toEqual(NEUTRAL_LEVERS);
      expect(b.companyModel?.groups.find((g) => g.id === 'cg1')).toMatchObject({ billablePct: 87, hourlyRate: 1287.5 });
    },
  },
];

describe('write builders preserve all other data', () => {
  for (const c of cases) {
    it(`${c.name}: applies the change`, () => {
      const { after, changes } = applyOn(c.mutate);
      c.assertChange(after, changes);
      expect(changes.length).toBeGreaterThan(0);
    });

    it(`${c.name}: leaves every other field byte-identical`, () => {
      const { before, after } = applyOn(c.mutate);
      expectPreserved(before, after, c.touched);
    });

    it(`${c.name}: keeps a valid, JSON-stable payload`, () => {
      const { after } = applyOn(c.mutate);
      expectValidShape(after);
      expectJsonStable(after);
    });
  }
});

describe('write builders never mutate the caller-visible snapshot in place', () => {
  it('update_goal replaces the element, not the shared array member', () => {
    const blob = structuredClone(fullFixture());
    const snapshot = structuredClone(blob);
    updateGoal(blob, { id: 'g1', target: 999999 });
    // The independent snapshot is unaffected — proves no aliasing back into prior state.
    expect(snapshot.goals?.find((g) => g.id === 'g1')?.target).toBe(600000);
  });
});

describe('write builders reject bad references loudly (no silent no-op)', () => {
  it('update_goal on a missing id throws', () => {
    expect(() => updateGoal(structuredClone(fullFixture()), { id: 'nope', target: 1 })).toThrow(/no goal/);
  });
  it('update_fixed_expense on a missing id throws', () => {
    expect(() => updateFixedExpense(structuredClone(fullFixture()), { id: 'nope', amount: 1 })).toThrow(/no fixed expense/);
  });
  it('update_assumptions with no fields throws', () => {
    expect(() => updateAssumptions(structuredClone(fullFixture()), {})).toThrow(/no assumption/);
  });
  it('set_profile with no fields throws', () => {
    expect(() => setProfile(structuredClone(fullFixture()), {})).toThrow(/no profile/);
  });

  const fresh = () => structuredClone(fullFixture());
  it.each([
    ['delete_goal', () => deleteGoal(fresh(), { id: 'nope' }), /no goal/],
    ['delete_fixed_expense', () => deleteFixedExpense(fresh(), { id: 'nope' }), /no fixed expense/],
    ['update_transaction', () => updateTransaction(fresh(), { id: 'nope', amount: 1 }), /no transaction/],
    ['update_transaction (no fields)', () => updateTransaction(fresh(), { id: 't1' }), /no transaction fields/],
    ['delete_transaction', () => deleteTransaction(fresh(), { id: 'nope' }), /no transaction/],
    ['add_rule (category without category)', () => addRule(fresh(), { id: 'x', type: 'category', match: 'A' }), /category is required/],
    ['add_rule (label without label)', () => addRule(fresh(), { id: 'x', type: 'label', match: 'A' }), /label is required/],
    ['add_rule (blank match)', () => addRule(fresh(), { id: 'x', type: 'transfer', match: '  ' }), /blank/],
    ['delete_rule (id of another rule type)', () => deleteRule(fresh(), { type: 'category', id: 'lr1' }), /no category rule/],
    ['update_asset (no fields)', () => updateAsset(fresh(), {}), /no asset fields/],
    ['upsert_savings_account (create without name)', () => upsertSavingsAccount(fresh(), { id: 'x', create: true }), /name is required/],
    ['upsert_savings_account (unknown id)', () => upsertSavingsAccount(fresh(), { id: 'nope', create: false, balance: 1 }), /no savings account/],
    ['delete_savings_account', () => deleteSavingsAccount(fresh(), { id: 'nope' }), /no savings account/],
    ['upsert_debt (create without type)', () => upsertDebt(fresh(), { id: 'x', create: true, name: 'A', balance: 1 }), /required/],
    ['upsert_debt (create without rate, not revolving)', () => upsertDebt(fresh(), { id: 'x', create: true, name: 'A', type: 'other', balance: 1 }), /rate and minPayment/],
    ['upsert_debt (unknown id)', () => upsertDebt(fresh(), { id: 'nope', create: false, balance: 1 }), /no debt/],
    ['delete_debt', () => deleteDebt(fresh(), { id: 'nope' }), /no debt/],
    ['update_loan (no fields)', () => updateLoan(fresh(), {}), /no loan fields/],
    ['update_current_mortgage (no fields)', () => updateCurrentMortgage(fresh(), {}), /no mortgage fields/],
    ['update_current_mortgage (years without months)', () => updateCurrentMortgage(fresh(), { termYears: 20 }), /together/],
    ['update_current_mortgage (zero term)', () => updateCurrentMortgage(fresh(), { termYears: 0, termMonths: 0 }), /at least one month/],
    ['set_co_owners (since after until)', () => setCoOwners(fresh(), { coOwners: [{ name: 'A', ownershipPct: 10, since: '2026-05', until: '2026-01' }] }), /since <= until/],
    ['set_co_owners (over 100 %)', () => setCoOwners(fresh(), { coOwners: [{ name: 'A', ownershipPct: 60 }, { name: 'B', ownershipPct: 50 }] }), /more than 100%/],
    ['set_monthly_income (neither)', () => setMonthlyIncome(fresh(), { month: '2026-07' }), /exactly one/],
    ['set_monthly_income (both)', () => setMonthlyIncome(fresh(), { month: '2026-07', amount: 1, clear: true }), /exactly one/],
    ['set_monthly_income (clear missing)', () => setMonthlyIncome(fresh(), { month: '2020-01', clear: true }), /no income override/],
    ['add_salary (unknown job)', () => addSalary(fresh(), { id: 'x', jobId: 'nope', effectiveDate: '2026-07', grossAnnual: 1, changeType: 'raise' }), /no job/],
    ['add_bonus (unknown job)', () => addBonus(fresh(), { id: 'x', date: '2026-07-01', amount: 1, type: 'other', jobId: 'nope' }), /no job/],
    ['upsert_company_group (unknown id)', () => upsertCompanyGroup(fresh(), { id: 'nope', create: false, count: 1 }), /no company group/],
    ['upsert_company_group (no fields)', () => upsertCompanyGroup(fresh(), { id: 'cg1', create: false }), /no company group fields/],
    ['upsert_company_group (create with a taken id)', () => upsertCompanyGroup(fresh(), { id: 'cg1', create: true, name: 'A', kind: 'support', count: 1, avgGross: 1 }), /already exists/],
    ['upsert_company_group (create without avgGross)', () => upsertCompanyGroup(fresh(), { id: 'x', create: true, name: 'A', kind: 'support', count: 1 }), /required/],
    ['upsert_company_group (delivery without rate)', () => upsertCompanyGroup(fresh(), { id: 'x', create: true, name: 'A', kind: 'delivery', count: 1, avgGross: 1, billablePct: 80 }), /billablePct and hourlyRate/],
    ['delete_company_group', () => deleteCompanyGroup(fresh(), { id: 'nope' }), /no company group/],
    ['upsert_company_cost_line (unknown id)', () => upsertCompanyCostLine(fresh(), { id: 'nope', create: false, amount: 1 }), /no company cost line/],
    ['upsert_company_cost_line (create without amount)', () => upsertCompanyCostLine(fresh(), { id: 'x', create: true, label: 'A' }), /required/],
    ['delete_company_cost_line', () => deleteCompanyCostLine(fresh(), { id: 'nope' }), /no company cost line/],
    ['upsert_company_cost_line (create pctOfSalary over 100)', () => upsertCompanyCostLine(fresh(), { id: 'x', create: true, label: 'A', amount: 101, per: 'pctOfSalary' }), /100 or less/],
    ['upsert_company_cost_line (update amount of a pctOfSalary line over 100)', () => upsertCompanyCostLine(fresh(), { id: 'cc3', create: false, amount: 150 }), /100 or less/],
    ['upsert_company_cost_line (update per to pctOfSalary on a kr line)', () => upsertCompanyCostLine(fresh(), { id: 'cc2', create: false, per: 'pctOfSalary' }), /100 or less/],
    ['upsert_company_group (support made delivery without a rate)', () => {
      const b = fresh();
      upsertCompanyGroup(b, { id: 'hr', create: true, name: 'HR', kind: 'support', count: 1, avgGross: 1 });
      return upsertCompanyGroup(b, { id: 'hr', create: false, kind: 'delivery', billablePct: 50 });
    }, /billablePct and hourlyRate/],
    ['update_company_settings (no fields)', () => updateCompanySettings(fresh(), {}), /no company settings/],
    ['setup_company_quick (after a hand edit, without confirmReplace)', () => {
      const b = fresh();
      setupCompanyQuick(b, { confirmReplace: true });
      upsertCompanyGroup(b, { id: 'kons', create: false, count: 3 });
      return setupCompanyQuick(b, { answers: { totalFte: 10 } });
    }, /changed by hand.*confirmReplace: true/],
    ['setup_company_quick (no quick setup, groups differ from the example, without confirmReplace)', () => setupCompanyQuick(fresh(), {}), /changed by hand.*confirmReplace: true/],
    ['calibrate_company_from_accounts (no accounts stored or given)', () => {
      const b = fresh();
      setupCompanyQuick(b, { uncertain: ['salary'], confirmReplace: true });
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b) });
    }, /no accounts are stored/],
    ['calibrate_company_from_accounts (accounts not in NOK)', () => {
      const b = fresh();
      setupCompanyQuick(b, { uncertain: ['salary'], confirmReplace: true });
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b), accounts: { ...madeUpAccounts(b), currency: 'SEK' } });
    }, /not in NOK/],
    ['calibrate_company_from_accounts (no solution)', () => {
      const b = fresh();
      setupCompanyQuick(b, { uncertain: ['salary', 'typicalBillablePct'], confirmReplace: true });
      const a = madeUpAccounts(b);
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b), accounts: { ...a, revenue: a.revenue * 10 } });
    }, /no solution.*Nothing was saved/],
    ['calibrate_company_from_accounts (hand edited)', () => {
      const b = fresh();
      setupCompanyQuick(b, { uncertain: ['salary'], confirmReplace: true });
      upsertCompanyGroup(b, { id: 'kons', create: false, count: 3 });
      return calibrateCompanyFromAccounts(b, { ctx: companyContext(b), accounts: madeUpAccounts(b) });
    }, /changed by hand/],
    ['update_company_settings (support group as yours)', () => updateCompanySettings(fresh(), { selfGroupId: 'cg3' }), /no delivery group/],
    ['update_company_settings (unknown group as yours)', () => updateCompanySettings(fresh(), { selfGroupId: 'nope' }), /no delivery group/],
  ] as const)('%s throws', (_name, call, msg) => {
    expect(call).toThrow(msg);
  });
});

describe('delete_transaction on a bank-imported row', () => {
  // The documented two-key exception: without the deletedBankIds entry the
  // server's reconcileBankTransactions would re-add the row on the next write.
  function withBankRow() {
    const blob = structuredClone(fullFixture());
    blob.dailyTransactions = [
      ...blob.dailyTransactions,
      { id: 'eb-abc12345-1', date: '2026-06-11', description: 'Card purchase', amount: 300, kind: 'expense' },
    ];
    return blob;
  }

  it('removes the row and records its id in deletedBankIds and its fingerprint in deletedBankTombstones', () => {
    const blob = withBankRow();
    const changes = deleteTransaction(blob, { id: 'eb-abc12345-1' });
    expect(blob.dailyTransactions.some((t) => t.id === 'eb-abc12345-1')).toBe(false);
    expect(blob.deletedBankIds).toEqual(['eb-old-1', 'eb-abc12345-1']);
    expect(blob.deletedBankTombstones?.map((t) => t.id)).toEqual(['eb-old-1', 'eb-abc12345-1']);
    expect(blob.deletedBankTombstones?.[1]).toMatchObject({ date: '2026-06-11', amount: 300, description: 'Card purchase' });
    expect(changes.map((c) => c.field)).toEqual(['dailyTransactions[eb-abc12345-1]', 'deletedBankIds', 'deletedBankTombstones']);
  });

  it('touches only dailyTransactions, deletedBankIds and deletedBankTombstones', () => {
    const after = withBankRow();
    const before = structuredClone(after);
    deleteTransaction(after, { id: 'eb-abc12345-1' });
    expectPreserved(before, after, ['dailyTransactions', 'deletedBankIds', 'deletedBankTombstones']);
    expectJsonStable(after);
  });

  it('does not duplicate an id already in deletedBankIds', () => {
    const blob = withBankRow();
    blob.deletedBankIds = ['eb-abc12345-1'];
    deleteTransaction(blob, { id: 'eb-abc12345-1' });
    expect(blob.deletedBankIds).toEqual(['eb-abc12345-1']);
  });
});

describe('update_current_mortgage and a notified rate', () => {
  const fixture = () => {
    const b = structuredClone(fullFixture());
    b.homeowner = { ...b.homeowner!, rente: 5.5, notifiedRate: 5.7, notifiedRateFrom: '2026-08' };
    return b;
  };
  it('keeps a notice that is not due yet', () => {
    const b = fixture();
    updateCurrentMortgage(b, { rente: 5.2 }, '2026-07');
    expect(b.homeowner).toMatchObject({ rente: 5.2, notifiedRate: 5.7, notifiedRateFrom: '2026-08' });
  });

  it('a rate written after the notice took effect replaces it', () => {
    const b = fixture();
    const changes = updateCurrentMortgage(b, { rente: 5.2 }, '2026-09');
    expect(b.homeowner?.rente).toBe(5.2);
    expect(b.homeowner).not.toHaveProperty('notifiedRate');
    expect(b.homeowner).not.toHaveProperty('notifiedRateFrom');
    // The diff starts from the rate in force (the notified one).
    expect(changes).toContainEqual({ field: 'homeowner.rente', before: 5.7, after: 5.2 });
  });

  it('a non-rate edit leaves the notice alone', () => {
    const b = fixture();
    updateCurrentMortgage(b, { termingebyr: 70 }, '2026-09');
    expect(b.homeowner).toMatchObject({ rente: 5.5, notifiedRate: 5.7 });
  });
});

describe('delete_fixed_expense on a paydown expense', () => {
  // 'f1' last paid May with a catch-up still to come; 'f2' paid June.
  function withPaydowns() {
    const blob = structuredClone(fullFixture());
    blob.fixedExpenses = blob.fixedExpenses.map((e) => (e.id === 'f1'
      ? { ...e, destinationKind: 'mortgage' as const, lastPostedMonth: '2026-05' }
      : e.id === 'f2' ? { ...e, destinationKind: 'mortgage' as const, lastPostedMonth: '2026-06', uncoveredMonths: { '2026-06': 100 } } : e));
    return blob;
  }

  it('keeps its stamp on the loan, so the months it paid are not charged again', () => {
    const blob = withPaydowns();
    const changes = deleteFixedExpense(blob, { id: 'f2' });
    expect(blob.assets.departedPaydowns).toEqual({ mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-06': 100 } } });
    expect(changes.map((c) => c.field)).toEqual(['fixedExpenses[f2]', 'assets.departedPaydowns']);
  });

  it('touches only fixedExpenses and assets, and only departedPaydowns within assets', () => {
    const after = withPaydowns();
    const before = structuredClone(after);
    deleteFixedExpense(after, { id: 'f2' });
    expectPreserved(before, after, ['fixedExpenses', 'assets']);
    const { departedPaydowns: _d, ...rest } = after.assets;
    expect(rest).toEqual(before.assets);
    expectJsonStable(after);
  });

  it('records nothing when no other expense on the loan is behind it', () => {
    const blob = withPaydowns();
    deleteFixedExpense(blob, { id: 'f1' });
    expect(blob.assets.departedPaydowns).toBeUndefined();
    expect('departedPaydowns' in blob.assets).toBe(false);
  });
});

describe('company model writes store a sanitized model', () => {
  const ctx = companyContext(fullFixture(), '2026-06');

  it('the fixture model is already sanitized, so a write changes only what it names', () => {
    expect(sanitizeCompanyModel(fullFixture().companyModel)).toEqual(fullFixture().companyModel);
  });

  it('repairs a broken stored model while writing', () => {
    const blob = structuredClone(fullFixture());
    (blob as unknown as { companyModel: unknown }).companyModel = {
      ...blob.companyModel, hours: { sickPct: 'x', internalPct: 500 }, levers: { ratePct: 99 },
    };
    upsertCompanyCostLine(blob, { id: 'cc1', create: false, amount: 1 });
    expect(blob.companyModel).toEqual(sanitizeCompanyModel(blob.companyModel));
    expect(blob.companyModel?.hours).toEqual({ sickPct: 4, internalPct: 100, holidayDays: 25 });
    expect(blob.companyModel?.levers.ratePct).toBe(LEVER_RANGES.ratePct.max);
  });

  it('writes the default model plus the change when none is stored, and reports the whole model', () => {
    const blob = structuredClone(fullFixture());
    delete blob.companyModel;
    const changes = updateCompanySettings(blob, { mode: 'advanced' });
    expect(blob.companyModel).toEqual({ ...DEFAULT_COMPANY_MODEL, mode: 'advanced' });
    expect(changes).toEqual([{ field: 'companyModel', before: null, after: blob.companyModel }]);
  });

  it('applyLevers keeps every result the same, also with your own share and rate', () => {
    const blob = structuredClone(fullFixture());
    blob.companyModel = { ...blob.companyModel!, self: { billablePct: 90, hourlyRate: 1400 } };
    const before = calcCompany(blob.companyModel, ctx);
    const yBefore = youEconomics(blob.companyModel, ctx, before);
    updateCompanySettings(blob, { applyLevers: true });
    const after = calcCompany(blob.companyModel, ctx);
    const yAfter = youEconomics(blob.companyModel, ctx, after);
    expect(after.ebit).toBeCloseTo(before.ebit, 6);
    expect(after.you.realCost).toBeCloseTo(before.you.realCost, 6);
    expect(after.revenue).toBeCloseTo(before.revenue, 6);
    expect(after.you.billableHours).toBeCloseTo(before.you.billableHours, 6);
    expect(after.you.listRate).toBeCloseTo(before.you.listRate, 6);
    expect(yAfter.keep).toBeCloseTo(yBefore.keep, 4);
  });

  it('self: given fields change, null clears, bounds hold, and the change list says so', () => {
    const blob = structuredClone(fullFixture());
    const set = updateCompanySettings(blob, { self: { billablePct: 92 } });
    expect(blob.companyModel?.self).toEqual({ billablePct: 92 });
    expect(set).toEqual([{ field: 'companyModel.self.billablePct', before: null, after: 92 }]);
    updateCompanySettings(blob, { self: { hourlyRate: 1600 } });
    expect(blob.companyModel?.self).toEqual({ billablePct: 92, hourlyRate: 1600 });
    updateCompanySettings(blob, { self: { billablePct: 140 } });
    expect(blob.companyModel?.self?.billablePct).toBe(100);
    const cleared = updateCompanySettings(blob, { self: null });
    expect(blob.companyModel).not.toHaveProperty('self');
    expect(cleared).toContainEqual({ field: 'companyModel.self.hourlyRate', before: 1600, after: null });
  });

  it('given levers are applied after they are set and clamped', () => {
    const blob = structuredClone(fullFixture());
    updateCompanySettings(blob, { levers: { ratePct: 50 }, applyLevers: true });
    expect(blob.companyModel?.groups.find((g) => g.id === 'cg1')?.hourlyRate).toBeCloseTo(1250 * (1 + LEVER_RANGES.ratePct.max / 100), 6);
    expect(blob.companyModel?.levers).toEqual(NEUTRAL_LEVERS);
  });

  describe('quick setup', () => {
    const withQuick = () => {
      const blob = structuredClone(fullFixture());
      blob.companyModel = buildModelFromAnswers(QUICK_DEFAULTS, blob.companyModel!);
      return blob;
    };

    it.each([
      ['upsert_company_group', (b: ExportPayload) => upsertCompanyGroup(b, { id: 'kons', create: false, count: 30 })],
      ['delete_company_group', (b: ExportPayload) => deleteCompanyGroup(b, { id: 'benk' })],
      ['upsert_company_cost_line', (b: ExportPayload) => upsertCompanyCostLine(b, { id: 'office', create: false, amount: 1 })],
      ['delete_company_cost_line', (b: ExportPayload) => deleteCompanyCostLine(b, { id: 'it' })],
      ['update_company_settings applyLevers', (b: ExportPayload) => updateCompanySettings(b, { levers: { ratePct: 5 }, applyLevers: true })],
    ])('%s marks the quick setup as hand-edited, and the change list says so', (_name, write) => {
      const blob = withQuick();
      const changes = write(blob);
      expect(blob.companyModel?.quick?.edited).toBe(true);
      expect(changes).toContainEqual({ field: 'companyModel.quick.edited', before: false, after: true });
    });

    it('a selfGroupId change marks the quick setup as hand-edited', () => {
      const blob = withQuick();
      upsertCompanyGroup(blob, { id: 'tl', create: true, name: 'Team leads', kind: 'delivery', count: 0, avgGross: 1, billablePct: 50, hourlyRate: 1 });
      blob.companyModel = { ...blob.companyModel!, quick: { ...blob.companyModel!.quick!, edited: false } };
      updateCompanySettings(blob, { selfGroupId: 'tl' });
      expect(blob.companyModel?.quick?.edited).toBe(true);
    });

    it('an upsert that changes nothing, or applyLevers with the levers at 0, keeps edited false', () => {
      const blob = withQuick();
      const count = blob.companyModel!.groups[0].count;
      upsertCompanyGroup(blob, { id: 'kons', create: false, count });
      upsertCompanyCostLine(blob, { id: 'it', create: false, amount: blob.companyModel!.costs.find((c) => c.id === 'it')!.amount });
      updateCompanySettings(blob, { applyLevers: true });
      expect(blob.companyModel?.quick?.edited).toBe(false);
    });

    it('a settings change that does not touch groups or costs keeps edited false', () => {
      const blob = withQuick();
      updateCompanySettings(blob, { hours: { sickPct: 5 } });
      expect(blob.companyModel?.quick?.edited).toBe(false);
    });

    it('setup_company_quick replaces hand edits only with confirmReplace, and keeps omitted answers and flags', () => {
      const blob = withQuick();
      setupCompanyQuick(blob, { uncertain: ['rateAverage'], dontKnow: ['office'], confirmReplace: false });
      upsertCompanyGroup(blob, { id: 'kons', create: false, count: 30 });
      expect(blob.companyModel?.quick?.edited).toBe(true);
      const snap = structuredClone(blob);
      expect(() => setupCompanyQuick(blob, { answers: { onBench: 4 }, confirmReplace: false })).toThrow(/confirmReplace/);
      expect(blob).toEqual(snap);
      const changes = setupCompanyQuick(blob, { answers: { onBench: 4, desks: 40 }, confirmReplace: true });
      const q = blob.companyModel!.quick!;
      expect(q.edited).toBe(false);
      expect(q.answers).toMatchObject({ onBench: 4, desks: 40, totalFte: QUICK_DEFAULTS.totalFte });
      expect(q.uncertain).toEqual(['rateAverage']);
      // A typed office answer is no longer "vet ikke".
      expect(q.dontKnow).toEqual([]);
      expect(blob.companyModel!.groups.find((g) => g.id === 'kons')?.count).toBe(QUICK_DEFAULTS.totalFte - QUICK_DEFAULTS.nonBilling - 4);
      expect(changes).toContainEqual({ field: 'companyModel.quick.edited', before: true, after: false });
    });

    it('setup_company_quick takes your rate from the billing settings on a first setup', () => {
      const blob = structuredClone(fullFixture());
      blob.billingConfig = { ...blob.billingConfig!, billedHourly: 1725 };
      setupCompanyQuick(blob, { confirmReplace: true });
      expect(blob.companyModel?.quick?.answers.rateYou).toBe(1725);
      expect(blob.companyModel?.self?.hourlyRate).toBe(1725);
    });

    it('setup_company_quick needs no confirmReplace on the untouched example model', () => {
      const { companyModel: _omit, ...rest } = structuredClone(fullFixture());
      const blob = rest as ExportPayload;
      expect(() => setupCompanyQuick(blob, {})).not.toThrow();
      expect(blob.companyModel?.quick?.edited).toBe(false);
      const b2 = structuredClone(fullFixture());
      b2.companyModel = structuredClone(DEFAULT_COMPANY_MODEL);
      expect(() => setupCompanyQuick(b2, {})).not.toThrow();
    });

    it('a real change to self or the bonus pool marks the quick setup as hand-edited; the same value does not', () => {
      const same = withQuick();
      updateCompanySettings(same, { bonus: { poolPct: same.companyModel!.bonus.poolPct }, self: { billablePct: same.companyModel!.self!.billablePct } });
      expect(same.companyModel?.quick?.edited).toBe(false);
      const pool = withQuick();
      expect(updateCompanySettings(pool, { bonus: { poolPct: 20 } })).toContainEqual({ field: 'companyModel.quick.edited', before: false, after: true });
      const self = withQuick();
      updateCompanySettings(self, { self: { hourlyRate: 1999 } });
      expect(self.companyModel?.quick?.edited).toBe(true);
      const cleared = withQuick();
      updateCompanySettings(cleared, { self: null });
      expect(cleared.companyModel?.quick?.edited).toBe(true);
    });

    it('companyChanges lists quick and self changes', () => {
      const plain = sanitizeCompanyModel(fullFixture().companyModel);
      const built = buildModelFromAnswers(QUICK_DEFAULTS, plain, { uncertain: ['salary'] });
      // No quick setup before: one change with the whole setup.
      expect(companyChanges(plain, built)).toContainEqual({ field: 'companyModel.quick', before: null, after: built.quick });
      expect(companyChanges(plain, built)).toContainEqual({ field: 'companyModel.self.billablePct', before: null, after: QUICK_DEFAULTS.ownBillablePct });
      const next = buildModelFromAnswers({ ...QUICK_DEFAULTS, totalFte: 60 }, built, { dontKnow: ['office'] });
      const changes = companyChanges(built, next);
      expect(changes).toContainEqual({ field: 'companyModel.quick.answers.totalFte', before: 50, after: 60 });
      expect(changes).toContainEqual({ field: 'companyModel.quick.uncertain', before: ['salary'], after: [] });
      expect(changes).toContainEqual({ field: 'companyModel.quick.dontKnow', before: [], after: ['office'] });
      // A write on a model without a quick setup says nothing about it.
      const blob = structuredClone(fullFixture());
      expect(upsertCompanyGroup(blob, { id: 'cg2', create: false, count: 4 }).some((c) => c.field.startsWith('companyModel.quick'))).toBe(false);
    });
  });
});
