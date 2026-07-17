// Pure mutation builders — the entire write surface, isolated from MCP/HTTP so the
// data-safety test fleet can exercise them exhaustively without a server.
//
// CONTRACT for every builder: it receives a blob it is free to mutate in place
// (the caller passes a clone), touches EXACTLY ONE top-level key, and returns the
// before/after diff. It must never drop or reshape any other field. The tests
// enforce that "everything else is byte-identical" invariant.

import type { ExportPayload, Goal, FixedExpense } from '../src/context/FinanceContext';
import { diff, type FieldChange } from './util';

export type CategoryKey =
  | 'groceries' | 'dining' | 'transport' | 'health' | 'entertainment' | 'shopping'
  | 'utilities' | 'subscriptions' | 'housing' | 'transfers' | 'income' | 'other';

export type GoalSource = Goal['source'];
export type ExpenseType = NonNullable<FixedExpense['type']>;

export const CATEGORY_KEYS: readonly CategoryKey[] = [
  'groceries', 'dining', 'transport', 'health', 'entertainment', 'shopping',
  'utilities', 'subscriptions', 'housing', 'transfers', 'income', 'other',
];
export const GOAL_SOURCES: readonly GoalSource[] = [
  'manual', 'bsu', 'savings', 'savingsAccount', 'totalEquity', 'portfolio', 'bufferAccount',
];
export const EXPENSE_TYPES: readonly ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];

/** The scalar assumption fields update_assumptions may touch. */
export const ASSUMPTION_KEYS = [
  'savingsTargetPercent', 'growthReturnRate', 'houseGrowthRate', 'cashGrowthRate', 'cryptoGrowthRate',
] as const;
export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

export function setCategoryBudget(
  blob: ExportPayload,
  args: { category: CategoryKey; amount: number },
): FieldChange[] {
  const budgets = { ...(blob.categoryBudgets ?? {}) };
  const before = budgets[args.category] ?? 0;
  if (args.amount > 0) budgets[args.category] = args.amount;
  else delete budgets[args.category];
  blob.categoryBudgets = budgets;
  return [diff(`categoryBudgets.${args.category}`, before, args.amount)];
}

export function addGoal(
  blob: ExportPayload,
  args: {
    id: string; // caller supplies the id (crypto.randomUUID) so this stays deterministic in tests
    name: string;
    target: number;
    source?: GoalSource;
    manualCurrent?: number;
    deadline?: string;
    notes?: string;
  },
): FieldChange[] {
  const goal: Goal = {
    id: args.id,
    name: args.name,
    target: args.target,
    source: args.source ?? 'manual',
    ...(args.manualCurrent != null ? { manualCurrent: args.manualCurrent } : {}),
    ...(args.deadline ? { deadline: args.deadline } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  };
  blob.goals = [...(blob.goals ?? []), goal];
  return [diff(`goals[${goal.id}]`, null, goal)];
}

export function updateGoal(
  blob: ExportPayload,
  args: { id: string; name?: string; target?: number; manualCurrent?: number; deadline?: string; notes?: string },
): FieldChange[] {
  const { id, ...fields } = args;
  // Replace the target element with a new object; never mutate the shared array's
  // element in place, so a caller's pre-mutation snapshot stays valid.
  const goals = [...(blob.goals ?? [])];
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) throw new Error(`no goal with id "${id}"`);
  const before = goals[idx];
  const after = { ...before };
  const changes: FieldChange[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const key = k as keyof Goal;
    changes.push(diff(`goals[${id}].${k}`, before[key], v));
    (after[key] as unknown) = v;
  }
  goals[idx] = after;
  blob.goals = goals;
  return changes;
}

export function addFixedExpense(
  blob: ExportPayload,
  args: { id: string; name: string; amount: number; type?: ExpenseType; category?: CategoryKey },
): FieldChange[] {
  const expense: FixedExpense = {
    id: args.id,
    name: args.name,
    amount: args.amount,
    ...(args.type ? { type: args.type } : {}),
    ...(args.category ? { category: args.category } : {}),
  };
  blob.fixedExpenses = [...(blob.fixedExpenses ?? []), expense];
  return [diff(`fixedExpenses[${expense.id}]`, null, expense)];
}

export function updateFixedExpense(
  blob: ExportPayload,
  args: { id: string; name?: string; amount?: number; type?: ExpenseType },
): FieldChange[] {
  const { id, ...fields } = args;
  const expenses = [...(blob.fixedExpenses ?? [])];
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`no fixed expense with id "${id}"`);
  const before = expenses[idx];
  const after = { ...before };
  const changes: FieldChange[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const key = k as keyof FixedExpense;
    changes.push(diff(`fixedExpenses[${id}].${k}`, before[key], v));
    (after[key] as unknown) = v;
  }
  expenses[idx] = after;
  blob.fixedExpenses = expenses;
  return changes;
}

export function setAiContext(blob: ExportPayload, args: { text: string }): FieldChange[] {
  const before = blob.aiContext ?? '';
  blob.aiContext = args.text;
  return [diff('aiContext', before, args.text)];
}

export function updateAssumptions(
  blob: ExportPayload,
  fields: Partial<Record<AssumptionKey, number>>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of ASSUMPTION_KEYS) {
    const v = fields[key];
    if (v === undefined) continue;
    changes.push(diff(key, blob[key], v));
    (blob[key] as unknown) = v;
  }
  if (changes.length === 0) throw new Error('no assumption fields provided');
  return changes;
}
