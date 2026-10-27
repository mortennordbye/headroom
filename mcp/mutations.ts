// Pure mutation builders — the entire write surface, isolated from MCP/HTTP so the
// data-safety test fleet can exercise them exhaustively without a server.
//
// CONTRACT for every builder: it receives a blob it is free to mutate in place
// (the caller passes a clone), touches EXACTLY ONE top-level key, and returns the
// before/after diff. It must never drop or reshape any other field. The tests
// enforce that "everything else is byte-identical" invariant.
//
// Two documented exceptions, both mirroring what the app itself does:
// - deleteTransaction on a bank-imported (`eb-`) row also appends the id to
//   `deletedBankIds`, or the server's reconcileBankTransactions re-adds it.
// - updateAsset on houseValue/houseDebt also mirrors the value into `homeowner`
//   and `transition` (when present), as FinanceContext.updateAsset does, so the
//   three slices that describe the same home never disagree.

import type {
  ExportPayload,
  Goal,
  FixedExpense,
  DailyTransaction,
  SavingsAccount,
  Debt,
  DebtType,
  Assets,
  LoanData,
  SalaryEntry,
  SalaryChangeType,
  BonusEntry,
  BonusType,
} from '../src/context/FinanceContext';
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
  args: { id: string; name?: string; amount?: number; type?: ExpenseType; category?: CategoryKey },
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

/** Update the user profile. Only provided fields change; touches only `blob.profile`. */
export function setProfile(
  blob: ExportPayload,
  fields: { name?: string; birthDate?: string },
): FieldChange[] {
  const before = blob.profile ?? {};
  const after = { ...before };
  const changes: FieldChange[] = [];
  if (fields.name !== undefined) { changes.push(diff('profile.name', before.name, fields.name)); after.name = fields.name; }
  if (fields.birthDate !== undefined) { changes.push(diff('profile.birthDate', before.birthDate, fields.birthDate)); after.birthDate = fields.birthDate; }
  if (changes.length === 0) throw new Error('no profile fields provided');
  blob.profile = after;
  return changes;
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

// ── Shared array helpers for the builders below ─────────────────────────────

/** Replace one element (by id) with a patched copy; only defined fields change. */
function patchById<T extends { id: string }>(
  list: T[],
  id: string,
  fields: Partial<T>,
  path: string,
  what: string,
): { list: T[]; changes: FieldChange[] } {
  const next = [...list];
  const idx = next.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error(`no ${what} with id "${id}"`);
  const before = next[idx];
  const after = { ...before };
  const changes: FieldChange[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const key = k as keyof T;
    changes.push(diff(`${path}[${id}].${k}`, before[key], v));
    (after[key] as unknown) = v;
  }
  if (changes.length === 0) throw new Error(`no ${what} fields provided`);
  next[idx] = after;
  return { list: next, changes };
}

/** Remove one element (by id); throws when it does not exist. */
function removeById<T extends { id: string }>(
  list: T[],
  id: string,
  path: string,
  what: string,
): { list: T[]; changes: FieldChange[] } {
  const before = list.find((x) => x.id === id);
  if (!before) throw new Error(`no ${what} with id "${id}"`);
  return { list: list.filter((x) => x.id !== id), changes: [diff(`${path}[${id}]`, before, null)] };
}

export function deleteGoal(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const { list, changes } = removeById(blob.goals ?? [], args.id, 'goals', 'goal');
  blob.goals = list;
  return changes;
}

export function deleteFixedExpense(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const { list, changes } = removeById(blob.fixedExpenses ?? [], args.id, 'fixedExpenses', 'fixed expense');
  blob.fixedExpenses = list;
  return changes;
}

// ── Transactions ────────────────────────────────────────────────────────────

/** Id prefix of bank-imported rows (server/bank.js EB_ID_PREFIX). */
export const BANK_ID_PREFIX = 'eb-';
export type TransactionKind = NonNullable<DailyTransaction['kind']>;

export function addTransaction(
  blob: ExportPayload,
  args: { id: string; date: string; description: string; amount: number; category?: CategoryKey; kind?: TransactionKind },
): FieldChange[] {
  // Same shape the Budget page's add-transaction modal writes.
  const tx: DailyTransaction = {
    id: args.id,
    date: args.date,
    description: args.description,
    amount: args.amount,
    ...(args.category ? { category: args.category, categorySource: 'manual' as const } : {}),
    kind: args.kind ?? 'expense',
  };
  blob.dailyTransactions = [...(blob.dailyTransactions ?? []), tx];
  return [diff(`dailyTransactions[${tx.id}]`, null, tx)];
}

export function updateTransaction(
  blob: ExportPayload,
  args: { id: string; date?: string; description?: string; amount?: number; category?: CategoryKey; kind?: TransactionKind },
): FieldChange[] {
  const { id, ...fields } = args;
  // A category set by hand is marked manual so re-sync and the rule engine never
  // overwrite it (the edit modal does the same).
  const patch = args.category !== undefined ? { ...fields, categorySource: 'manual' as const } : fields;
  const { list, changes } = patchById(blob.dailyTransactions ?? [], id, patch, 'dailyTransactions', 'transaction');
  blob.dailyTransactions = list;
  return changes;
}

/**
 * Delete a transaction. A bank-imported row (`eb-` id) is also soft-deleted in
 * `deletedBankIds`, or the server's reconcile resurrects it on the next write.
 * This is the one builder besides updateAsset that touches two top-level keys.
 */
export function deleteTransaction(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const { list, changes } = removeById(blob.dailyTransactions ?? [], args.id, 'dailyTransactions', 'transaction');
  blob.dailyTransactions = list;
  if (args.id.startsWith(BANK_ID_PREFIX)) {
    const before = blob.deletedBankIds ?? [];
    if (!before.includes(args.id)) {
      blob.deletedBankIds = [...before, args.id];
      changes.push(diff('deletedBankIds', before, blob.deletedBankIds));
    }
  }
  return changes;
}

// ── Rules (category / label / transfer) ─────────────────────────────────────

export type RuleType = 'category' | 'label' | 'transfer';
export const RULE_TYPES: readonly RuleType[] = ['category', 'label', 'transfer'];
const RULE_KEY = { category: 'categoryRules', label: 'labelRules', transfer: 'transferRules' } as const;

/**
 * Add a rule. Mirrors FinanceContext.add*Rule: the match is trimmed, and an
 * existing rule with the same match (case-insensitive) is replaced.
 */
export function addRule(
  blob: ExportPayload,
  args: { id: string; type: RuleType; match: string; category?: CategoryKey; label?: string },
): FieldChange[] {
  const match = args.match.trim();
  if (!match) throw new Error('match must not be blank');
  const keep = <T extends { match: string }>(rules: T[]) =>
    rules.filter((r) => r.match.trim().toLowerCase() !== match.toLowerCase());
  let rule;
  if (args.type === 'category') {
    if (!args.category) throw new Error('category is required for a category rule');
    rule = { id: args.id, match, category: args.category };
    blob.categoryRules = [...keep(blob.categoryRules ?? []), rule];
  } else if (args.type === 'label') {
    const label = args.label?.trim();
    if (!label) throw new Error('label is required for a label rule');
    rule = { id: args.id, match, label };
    blob.labelRules = [...keep(blob.labelRules ?? []), rule];
  } else {
    rule = { id: args.id, match };
    blob.transferRules = [...keep(blob.transferRules ?? []), rule];
  }
  return [diff(`${RULE_KEY[args.type]}[${args.id}]`, null, rule)];
}

export function deleteRule(blob: ExportPayload, args: { type: RuleType; id: string }): FieldChange[] {
  const key = RULE_KEY[args.type];
  const { list, changes } = removeById<{ id: string }>(blob[key] ?? [], args.id, key, `${args.type} rule`);
  (blob[key] as unknown) = list;
  return changes;
}

// ── Balances: assets, savings accounts, debts, loan ─────────────────────────

/** The numeric scalar fields of `assets` update_asset may touch. */
export const ASSET_KEYS = [
  'portfolio', 'unrealizedGain', 'shieldingDeduction', 'taxRate', 'bsu', 'bsuAnnualContribution',
  'houseValue', 'houseDebt', 'crypto', 'cryptoUnrealizedGain', 'cryptoTaxRate', 'bufferAccount',
] as const satisfies readonly (keyof Assets)[];
export type AssetKey = (typeof ASSET_KEYS)[number];

/**
 * Update numeric asset fields. houseValue/houseDebt are mirrored into the
 * `homeowner`/`transition` slices (when present) exactly as the app's own
 * updateAsset does, so the same home never shows two different numbers.
 */
export function updateAsset(blob: ExportPayload, fields: Partial<Record<AssetKey, number>>): FieldChange[] {
  const after = { ...blob.assets };
  const changes: FieldChange[] = [];
  for (const key of ASSET_KEYS) {
    const v = fields[key];
    if (v === undefined) continue;
    changes.push(diff(`assets.${key}`, blob.assets[key], v));
    after[key] = v;
  }
  if (changes.length === 0) throw new Error('no asset fields provided');
  blob.assets = after;
  const { houseDebt, houseValue } = fields;
  if (houseDebt !== undefined) {
    if (blob.homeowner) {
      changes.push(diff('homeowner.currentMortgageBalance', blob.homeowner.currentMortgageBalance, houseDebt));
      blob.homeowner = { ...blob.homeowner, currentMortgageBalance: houseDebt };
    }
    if (blob.transition) {
      changes.push(diff('transition.currentMortgageBalance', blob.transition.currentMortgageBalance, houseDebt));
      blob.transition = { ...blob.transition, currentMortgageBalance: houseDebt };
    }
  }
  if (houseValue !== undefined && blob.transition) {
    changes.push(diff('transition.currentHouseValue', blob.transition.currentHouseValue, houseValue));
    blob.transition = { ...blob.transition, currentHouseValue: houseValue };
  }
  return changes;
}

/**
 * Create (create=true, caller supplies a fresh id) or update a savings account
 * in `assets.savingsAccounts`. Touches only `assets`.
 */
export function upsertSavingsAccount(
  blob: ExportPayload,
  args: { id: string; create: boolean; name?: string; balance?: number },
): FieldChange[] {
  const accounts = blob.assets.savingsAccounts ?? [];
  if (args.create) {
    if (!args.name) throw new Error('name is required to create a savings account');
    const account: SavingsAccount = { id: args.id, name: args.name, balance: args.balance ?? 0 };
    blob.assets = { ...blob.assets, savingsAccounts: [...accounts, account] };
    return [diff(`assets.savingsAccounts[${account.id}]`, null, account)];
  }
  const { list, changes } = patchById(
    accounts, args.id, { name: args.name, balance: args.balance }, 'assets.savingsAccounts', 'savings account',
  );
  blob.assets = { ...blob.assets, savingsAccounts: list };
  return changes;
}

export function deleteSavingsAccount(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const { list, changes } = removeById(
    blob.assets.savingsAccounts ?? [], args.id, 'assets.savingsAccounts', 'savings account',
  );
  blob.assets = { ...blob.assets, savingsAccounts: list };
  return changes;
}

export const DEBT_TYPES: readonly DebtType[] = ['student', 'consumer', 'credit_card', 'other'];
type DebtFields = Partial<Omit<Debt, 'id'>>;

/**
 * Create (create=true, caller supplies a fresh id) or update a debt. On create,
 * name/type/balance are required, and rate/minPayment too unless revolving (a
 * revolving line stores 0 for both, as the debt form does).
 */
export function upsertDebt(blob: ExportPayload, args: { id: string; create: boolean } & DebtFields): FieldChange[] {
  const { id, create, ...fields } = args;
  const debts = blob.debts ?? [];
  if (!create) {
    const { list, changes } = patchById(debts, id, fields, 'debts', 'debt');
    blob.debts = list;
    return changes;
  }
  const { name, type, balance, revolving, rate, minPayment } = fields;
  if (!name || !type || balance === undefined) throw new Error('name, type and balance are required to create a debt');
  if (!revolving && (rate === undefined || minPayment === undefined)) {
    throw new Error('rate and minPayment are required unless the debt is revolving');
  }
  const debt: Debt = {
    id, name, type, balance,
    rate: revolving ? 0 : rate!,
    minPayment: revolving ? 0 : minPayment!,
    ...(revolving !== undefined ? { revolving } : {}),
    ...(fields.creditLimit !== undefined ? { creditLimit: fields.creditLimit } : {}),
    ...(fields.interestFreeUntil ? { interestFreeUntil: fields.interestFreeUntil } : {}),
  };
  blob.debts = [...debts, debt];
  return [diff(`debts[${id}]`, null, debt)];
}

export function deleteDebt(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const { list, changes } = removeById(blob.debts ?? [], args.id, 'debts', 'debt');
  blob.debts = list;
  return changes;
}

/** The numeric scalar fields of `loan` update_loan may touch (gyldigTil is the one string). */
export const LOAN_NUMBER_KEYS = [
  'arslonn', 'eksisterendeGjeld', 'egenkapital', 'laanebelop', 'rente', 'nedbetalingstid',
  'termingebyr', 'etableringsgebyr', 'betingetLaan', 'kjoepesum',
] as const satisfies readonly (keyof LoanData)[];
export type LoanNumberKey = (typeof LOAN_NUMBER_KEYS)[number];

export function updateLoan(
  blob: ExportPayload,
  fields: Partial<Record<LoanNumberKey, number>> & { gyldigTil?: string },
): FieldChange[] {
  const after = { ...blob.loan };
  const changes: FieldChange[] = [];
  for (const key of [...LOAN_NUMBER_KEYS, 'gyldigTil'] as const) {
    const v = fields[key];
    if (v === undefined) continue;
    changes.push(diff(`loan.${key}`, blob.loan[key], v));
    (after[key] as unknown) = v;
  }
  if (changes.length === 0) throw new Error('no loan fields provided');
  blob.loan = after;
  return changes;
}

// ── Income ──────────────────────────────────────────────────────────────────

/**
 * Set (amount) or remove (clear=true) the income override for one month. 0 is a
 * valid override (a month with no pay), so removal is an explicit flag.
 */
export function setMonthlyIncome(
  blob: ExportPayload,
  args: { month: string; amount?: number; clear?: boolean },
): FieldChange[] {
  if ((args.amount === undefined) === !args.clear) throw new Error('give exactly one of amount or clear=true');
  const incomes = { ...(blob.monthlyIncomes ?? {}) };
  const before = incomes[args.month] ?? null;
  if (args.clear) {
    if (before === null) throw new Error(`no income override for ${args.month}`);
    delete incomes[args.month];
  } else {
    incomes[args.month] = args.amount!;
  }
  blob.monthlyIncomes = incomes;
  return [diff(`monthlyIncomes.${args.month}`, before, args.clear ? null : args.amount)];
}

export const SALARY_CHANGE_TYPES: readonly SalaryChangeType[] = ['initial', 'raise', 'promotion', 'job_change', 'adjustment'];
export const BONUS_TYPES: readonly BonusType[] = ['annual', 'performance', 'signing', 'holiday_pay', 'profit_share', 'other'];

function requireJob(blob: ExportPayload, jobId: string) {
  if (!(blob.jobs ?? []).some((j) => j.id === jobId)) throw new Error(`no job with id "${jobId}"`);
}

export function addSalary(blob: ExportPayload, args: SalaryEntry): FieldChange[] {
  requireJob(blob, args.jobId);
  const salary: SalaryEntry = {
    id: args.id,
    jobId: args.jobId,
    effectiveDate: args.effectiveDate,
    grossAnnual: args.grossAnnual,
    changeType: args.changeType,
    ...(args.notes ? { notes: args.notes } : {}),
  };
  blob.salaries = [...(blob.salaries ?? []), salary];
  return [diff(`salaries[${salary.id}]`, null, salary)];
}

export function addBonus(blob: ExportPayload, args: BonusEntry): FieldChange[] {
  if (args.jobId) requireJob(blob, args.jobId);
  const bonus: BonusEntry = {
    id: args.id,
    date: args.date,
    amount: args.amount,
    type: args.type,
    ...(args.jobId ? { jobId: args.jobId } : {}),
    ...(args.includeInBudget ? { includeInBudget: true } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  };
  blob.bonuses = [...(blob.bonuses ?? []), bonus];
  return [diff(`bonuses[${bonus.id}]`, null, bonus)];
}
