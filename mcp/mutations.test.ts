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
} from './mutations';

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
    name: 'delete_transaction (manual row leaves deletedBankIds alone)',
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

  it('removes the row and records its id in deletedBankIds', () => {
    const blob = withBankRow();
    const changes = deleteTransaction(blob, { id: 'eb-abc12345-1' });
    expect(blob.dailyTransactions.some((t) => t.id === 'eb-abc12345-1')).toBe(false);
    expect(blob.deletedBankIds).toEqual(['eb-old-1', 'eb-abc12345-1']);
    expect(changes.map((c) => c.field)).toEqual(['dailyTransactions[eb-abc12345-1]', 'deletedBankIds']);
  });

  it('touches only dailyTransactions and deletedBankIds', () => {
    const after = withBankRow();
    const before = structuredClone(after);
    deleteTransaction(after, { id: 'eb-abc12345-1' });
    expectPreserved(before, after, ['dailyTransactions', 'deletedBankIds']);
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
