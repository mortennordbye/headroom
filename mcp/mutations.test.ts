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
});
