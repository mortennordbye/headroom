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
//   `deletedBankIds`, or the server's reconcileBankTransactions re-adds it,
//   and its fingerprint to `deletedBankTombstones`.
// - updateAsset on houseValue also mirrors it into `transition`, and houseDebt
//   stamps its month on `homeowner` (when present), as FinanceContext.updateAsset
//   does.
// - deleteFixedExpense on a paydown expense that another expense on the same
//   loan hasn't caught up with also records its stamp in
//   `assets.departedPaydowns`, as FinanceContext's setFixedExpenses does, so
//   the months it paid aren't charged interest again.
// - setCoOwners also rewrites the co-owners stored in `balanceSnapshots`, as
//   FinanceContext.setCoOwners does, so history shows the share in force each month.
//
// The company-model builders store `companyModel` whole and sanitized (the
// default model when none was stored, as the app shows it). Their diff lists
// every value that changed, side effects included (your group moving to another
// delivery group, applied levers).

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
import { birthYearFrom } from '../src/lib/profile';
import { osloMonthKey } from '../src/lib/date';
import { isValidTermParts, yearsFromParts } from '../src/lib/loanTerm';
import { withNotifiedRate } from '../src/lib/notifiedRate';
import { rewriteSnapshotCoOwners, sanitizeCoOwners, validateCoOwners, type CoOwnerError } from '../src/lib/ownership';
import { currentResidence } from '../src/lib/property';
import { addDeletedBankTombstones } from '../src/lib/bankDedup';
import { recordDepartedPaydowns } from '../src/lib/automation';
import {
  sanitizeCompanyModel,
  quickReplacesHandEdits,
  ensureDeliverySelf,
  applyLevers,
  type CompanyModel,
  type CompanyGroup,
  type CompanyGroupKind,
  type CompanyCostLine,
  type CostLinePer,
  type CompanyLevers,
} from '../src/lib/companyCost';
import {
  markQuickEdited,
  buildModelFromAnswers,
  sanitizeQuickAnswers,
  QUICK_DEFAULTS,
  type QuickAnswers,
  type QuickGuessKey,
} from '../src/lib/companySetup';
import type { StyrkCode } from '../src/lib/marketWage';
import { translations } from '../src/i18n/translations';

// The app's own category list, so every category the UI offers is writable here.
export { CATEGORY_KEYS, type CategoryKey } from '../src/lib/categories';
import type { CategoryKey } from '../src/lib/categories';

export type GoalSource = Goal['source'];
export type ExpenseType = NonNullable<FixedExpense['type']>;

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

/**
 * Update the user profile. Only provided fields change. A birth date also writes
 * its year through to `pension.birthYear`, as the app's updateProfile does (the
 * profile is the single source for it), so pension and BSU math see the age.
 * That second key is a documented exception to the one-key contract.
 */
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
  const year = fields.birthDate !== undefined ? birthYearFrom(fields.birthDate) : 0;
  if (year && blob.pension && blob.pension.birthYear !== year) {
    changes.push(diff('pension.birthYear', blob.pension.birthYear, year));
    blob.pension = { ...blob.pension, birthYear: year };
  }
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
  const prev = blob.fixedExpenses ?? [];
  const { list, changes } = removeById(prev, args.id, 'fixedExpenses', 'fixed expense');
  blob.fixedExpenses = list;
  // A paydown leaving its loan keeps its stamp there, as the app's setter does.
  const before = blob.assets.departedPaydowns;
  const after = recordDepartedPaydowns(before, prev, list);
  if (after !== before) {
    blob.assets = { ...blob.assets, departedPaydowns: after };
    changes.push(diff('assets.departedPaydowns', before ?? null, after));
  }
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
 * `deletedBankIds`, or the server's reconcile resurrects it on the next write,
 * and its fingerprint goes to `deletedBankTombstones`.
 * This is the one builder besides updateAsset that touches several top-level keys.
 */
export function deleteTransaction(blob: ExportPayload, args: { id: string }): FieldChange[] {
  const removed = (blob.dailyTransactions ?? []).find((t) => t.id === args.id);
  const { list, changes } = removeById(blob.dailyTransactions ?? [], args.id, 'dailyTransactions', 'transaction');
  blob.dailyTransactions = list;
  if (args.id.startsWith(BANK_ID_PREFIX)) {
    const before = blob.deletedBankIds ?? [];
    if (!before.includes(args.id)) {
      blob.deletedBankIds = [...before, args.id];
      changes.push(diff('deletedBankIds', before, blob.deletedBankIds));
    }
    // The fingerprint lets the first sync after a re-link spot the row under a
    // new reference format (see addDeletedBankTombstones).
    const tombBefore = blob.deletedBankTombstones ?? [];
    const tombAfter = addDeletedBankTombstones(tombBefore, removed ? [removed] : []);
    if (tombAfter !== tombBefore) {
      blob.deletedBankTombstones = tombAfter;
      changes.push(diff('deletedBankTombstones', tombBefore, tombAfter));
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
  'portfolio', 'unrealizedGain', 'shieldingDeduction', 'taxRate', 'bsu', 'bsuAnnualContribution', 'bsuTotalDeposited',
  'houseValue', 'houseDebt', 'crypto', 'cryptoUnrealizedGain', 'cryptoTaxRate', 'bufferAccount',
] as const satisfies readonly (keyof Assets)[];
export type AssetKey = (typeof ASSET_KEYS)[number];

/**
 * Update numeric asset fields as the app's own updateAsset does: houseValue is
 * mirrored into the `transition` slice, and houseDebt (the one stored mortgage
 * balance) stamps the month on the `homeowner` slice.
 */
export function updateAsset(
  blob: ExportPayload,
  fields: Partial<Record<AssetKey, number>>,
  monthKey = osloMonthKey(),
): FieldChange[] {
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
  if (houseDebt !== undefined && blob.homeowner) {
    changes.push(diff('homeowner.currentMortgageBalanceAsOf', blob.homeowner.currentMortgageBalanceAsOf, monthKey));
    blob.homeowner = { ...blob.homeowner, currentMortgageBalanceAsOf: monthKey };
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

export interface CurrentMortgageFields {
  rente?: number;
  termingebyr?: number;
  startDate?: string;
  balance?: number;
  termYears?: number;
  termMonths?: number;
}

/**
 * Update the current mortgage (the `homeowner` slice). The remaining term is
 * years + months and stamps the month it was entered, so it counts down; the
 * balance is written to assets.houseDebt and stamps its month, as the app's
 * updateAsset does.
 */
export function updateCurrentMortgage(
  blob: ExportPayload,
  args: CurrentMortgageFields,
  monthKey = osloMonthKey(),
): FieldChange[] {
  if (!blob.homeowner) throw new Error('no current mortgage to update');
  const { termYears, termMonths, balance } = args;
  if ((termYears === undefined) !== (termMonths === undefined)) {
    throw new Error('termYears and termMonths must be given together');
  }
  if (termYears !== undefined && !isValidTermParts(termYears, termMonths!)) {
    throw new Error('term must be whole years 0-50 and months 0-11, at least one month');
  }
  // A rate written after a notified rate took effect replaces it: consume the
  // notice so it can't override the new rate when read (notifiedRate.ts).
  const before = args.rente !== undefined ? withNotifiedRate(blob.homeowner, monthKey) : blob.homeowner;
  const after = { ...before };
  const changes: FieldChange[] = [];
  if (before !== blob.homeowner) {
    changes.push(diff('homeowner.notifiedRate', blob.homeowner.notifiedRate, undefined));
    changes.push(diff('homeowner.notifiedRateFrom', blob.homeowner.notifiedRateFrom, undefined));
  }
  for (const key of ['rente', 'termingebyr', 'startDate'] as const) {
    const v = args[key];
    if (v === undefined) continue;
    changes.push(diff(`homeowner.${key}`, before[key], v));
    (after[key] as unknown) = v;
  }
  if (termYears !== undefined) {
    const years = yearsFromParts(termYears, termMonths!);
    changes.push(diff('homeowner.nedbetalingstid', before.nedbetalingstid, years));
    after.nedbetalingstid = years;
    after.nedbetalingstidAsOf = monthKey;
  }
  if (balance !== undefined) {
    changes.push(diff('homeowner.currentMortgageBalanceAsOf', before.currentMortgageBalanceAsOf, monthKey));
    after.currentMortgageBalanceAsOf = monthKey;
  }
  if (changes.length === 0) throw new Error('no mortgage fields provided');
  blob.homeowner = after;
  if (balance !== undefined) {
    changes.push(diff('assets.houseDebt', blob.assets.houseDebt, balance));
    blob.assets = { ...blob.assets, houseDebt: balance };
  }
  return changes;
}

const CO_OWNER_ERRORS: Record<CoOwnerError, string> = {
  range: 'ownershipPct and debtSharePct must be 0-100',
  sumOwnership: 'co-owners together own more than 100% of the home in some month',
  sumDebt: 'co-owners together carry more than 100% of the loan in some month',
  dates: "since/until must be 'YYYY-MM' with since <= until",
};

/**
 * Replace the whole co-owner list of the current home (`assets.coOwners`); the
 * shares must validate together, so there is no per-row upsert. The user's share
 * is what is left. Also rewrites every stored snapshot's co-owners from each
 * row's since/until, so history shows the share in force that month.
 */
export function setCoOwners(blob: ExportPayload, args: { coOwners: unknown[] }): FieldChange[] {
  // A new row without `since` owns from the current home's move-in, as in the
  // app; "always" would also halve the equity of earlier homes in history.
  const known = new Set((blob.assets.coOwners ?? []).map(c => c.id));
  const moveIn = currentResidence(blob.residences ?? [])?.moveInDate?.slice(0, 7);
  const list = sanitizeCoOwners(args.coOwners).map(c => (
    c.since || known.has(c.id) || !moveIn ? c : { ...c, since: moveIn }
  ));
  const v = validateCoOwners(list);
  if (!v.ok) throw new Error(CO_OWNER_ERRORS[v.error]);
  const changes = [diff('assets.coOwners', blob.assets.coOwners ?? [], list)];
  blob.assets = { ...blob.assets, coOwners: list };
  if (blob.balanceSnapshots) {
    const next = rewriteSnapshotCoOwners(blob.balanceSnapshots, list);
    for (const [month, snap] of Object.entries(next)) {
      const before = blob.balanceSnapshots[month]?.assets?.coOwners ?? [];
      const after = snap?.assets?.coOwners ?? [];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push(diff(`balanceSnapshots.${month}.assets.coOwners`, before, after));
    }
    blob.balanceSnapshots = next;
  }
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

// ── Company model (employer-cost page, Avansert) ────────────────────────────

export const COMPANY_GROUP_KINDS: readonly CompanyGroupKind[] = ['delivery', 'support'];
export const COST_LINE_PERS: readonly CostLinePer[] = ['company', 'head', 'pctOfSalary'];
export type CompanyGroupFields = Partial<Omit<CompanyGroup, 'id'>>;
export type CompanyCostLineFields = Partial<Omit<CompanyCostLine, 'id'>>;

/** Every value that differs between two sanitized models, rows matched by id. */
export function companyChanges(before: CompanyModel, after: CompanyModel): FieldChange[] {
  const out: FieldChange[] = [];
  const field = (path: string, b: unknown, a: unknown) => {
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push(diff(`companyModel.${path}`, b, a));
  };
  field('mode', before.mode, after.mode);
  field('selfGroupId', before.selfGroupId, after.selfGroupId);
  field('targetMarginPct', before.targetMarginPct ?? null, after.targetMarginPct ?? null);
  for (const part of ['hours', 'bonus', 'levers'] as const) {
    const b = before[part] as unknown as Record<string, unknown>;
    const a = after[part] as unknown as Record<string, unknown>;
    for (const k of Object.keys(a)) field(`${part}.${k}`, b[k], a[k]);
  }
  const rows = <T extends { id: string }>(path: string, b: T[], a: T[]) => {
    for (const x of b) {
      const y = a.find((r) => r.id === x.id);
      if (!y) out.push(diff(`companyModel.${path}[${x.id}]`, x, null));
      else for (const k of Object.keys(y) as (keyof T)[]) field(`${path}[${x.id}].${String(k)}`, x[k], y[k]);
    }
    for (const y of a) if (!b.some((x) => x.id === y.id)) out.push(diff(`companyModel.${path}[${y.id}]`, null, y));
  };
  rows('groups', before.groups, after.groups);
  rows('costs', before.costs, after.costs);
  field('self.billablePct', before.self?.billablePct ?? null, after.self?.billablePct ?? null);
  field('self.hourlyRate', before.self?.hourlyRate ?? null, after.self?.hourlyRate ?? null);
  field('market.styrk', before.market?.styrk ?? null, after.market?.styrk ?? null);
  const bq = before.quick;
  const aq = after.quick;
  if (!bq || !aq) field('quick', bq ?? null, aq ?? null);
  else {
    for (const k of Object.keys(aq.answers) as (keyof typeof aq.answers)[]) field(`quick.answers.${k}`, bq.answers[k], aq.answers[k]);
    field('quick.uncertain', bq.uncertain, aq.uncertain);
    field('quick.dontKnow', bq.dontKnow, aq.dontKnow);
    field('quick.edited', bq.edited, aq.edited);
  }
  return out;
}

/**
 * Edit the stored company model (the default model when none is stored, as the
 * app shows it) and store the result sanitized, with your group kept a delivery
 * group. Touches only `companyModel`.
 */
function writeCompany(blob: ExportPayload, edit: (m: CompanyModel) => CompanyModel): FieldChange[] {
  const before = sanitizeCompanyModel(blob.companyModel);
  const edited = sanitizeCompanyModel(ensureDeliverySelf(edit(structuredClone(before))));
  // A change to the groups, the cost lines, your group, your own share or the bonus pool is a hand edit: the quick setup
  // then asks before it builds the model again. A write that changes none of them leaves the flag alone.
  const shape = (m: CompanyModel) => JSON.stringify([m.groups, m.costs, m.selfGroupId, m.self ?? null, m.bonus.poolPct]);
  const after = shape(edited) !== shape(before) ? markQuickEdited(edited) : edited;
  // No stored model: the whole example model is stored now, so say so.
  const changes = blob.companyModel === undefined ? [diff('companyModel', null, after)] : companyChanges(before, after);
  blob.companyModel = after;
  return changes;
}

/** A % of salary cost line above 100 % is a typo for an amount in kr. */
function checkCostLine(line: { per: CostLinePer; amount: number }) {
  if (line.per === 'pctOfSalary' && line.amount > 100) {
    throw new Error('amount is a % of salary when per is "pctOfSalary", so it must be 100 or less');
  }
}

/**
 * Create (create=true, caller supplies a fresh id) or update a role group. On
 * create, name/kind/count/avgGross are required, and billablePct/hourlyRate too
 * for a delivery group (a support group defaults to 0 for both).
 */
export function upsertCompanyGroup(
  blob: ExportPayload,
  args: { id: string; create: boolean } & CompanyGroupFields,
): FieldChange[] {
  const { id, create, ...fields } = args;
  return writeCompany(blob, (m) => {
    if (!create) {
      const prev = m.groups.find((g) => g.id === id);
      // A group that becomes delivery needs a billable share and a rate, as on create.
      if (prev && prev.kind !== 'delivery' && fields.kind === 'delivery'
        && !((fields.billablePct ?? prev.billablePct) > 0 && (fields.hourlyRate ?? prev.hourlyRate) > 0)) {
        throw new Error('billablePct and hourlyRate are required for a delivery group');
      }
      return { ...m, groups: patchById(m.groups, id, fields, 'companyModel.groups', 'company group').list };
    }
    if (m.groups.some((g) => g.id === id)) throw new Error(`a company group with id "${id}" already exists`);
    const { name, kind, count, avgGross, billablePct, hourlyRate, realizationPct } = fields;
    if (!name || !kind || count === undefined || avgGross === undefined) {
      throw new Error('name, kind, count and avgGross are required to create a company group');
    }
    if (kind === 'delivery' && (billablePct === undefined || hourlyRate === undefined)) {
      throw new Error('billablePct and hourlyRate are required for a delivery group');
    }
    const group: CompanyGroup = {
      id, name, kind, count, avgGross,
      billablePct: billablePct ?? 0,
      hourlyRate: hourlyRate ?? 0,
      realizationPct: realizationPct ?? 100,
    };
    return { ...m, groups: [...m.groups, group] };
  });
}

/** Remove a role group. When it was your group, your group moves to the first delivery group. */
export function deleteCompanyGroup(blob: ExportPayload, args: { id: string }): FieldChange[] {
  return writeCompany(blob, (m) => ({ ...m, groups: removeById(m.groups, args.id, 'companyModel.groups', 'company group').list }));
}

/** Create (create=true, caller supplies a fresh id) or update a cost line. On create, label and amount are required. */
export function upsertCompanyCostLine(
  blob: ExportPayload,
  args: { id: string; create: boolean } & CompanyCostLineFields,
): FieldChange[] {
  const { id, create, ...fields } = args;
  return writeCompany(blob, (m) => {
    if (!create) {
      const { list } = patchById(m.costs, id, fields, 'companyModel.costs', 'company cost line');
      checkCostLine(list.find((c) => c.id === id)!);
      return { ...m, costs: list };
    }
    if (m.costs.some((c) => c.id === id)) throw new Error(`a company cost line with id "${id}" already exists`);
    const { label, amount, per } = fields;
    if (!label || amount === undefined) throw new Error('label and amount are required to create a company cost line');
    const line: CompanyCostLine = { id, label, amount, per: per ?? 'company' };
    checkCostLine(line);
    return { ...m, costs: [...m.costs, line] };
  });
}

export function deleteCompanyCostLine(blob: ExportPayload, args: { id: string }): FieldChange[] {
  return writeCompany(blob, (m) => ({ ...m, costs: removeById(m.costs, args.id, 'companyModel.costs', 'company cost line').list }));
}

export interface CompanySettingsFields {
  mode?: CompanyModel['mode'];
  selfGroupId?: string;
  hours?: Partial<CompanyModel['hours']>;
  bonus?: Partial<CompanyModel['bonus']>;
  levers?: Partial<CompanyLevers>;
  /** Target margin on you for the fair salary, % (0-60); null = the company margin before bonus. */
  targetMarginPct?: number | null;
  /** Your own billable share and list rate where they differ from your group; null = use the group's. */
  self?: { billablePct?: number; hourlyRate?: number } | null;
  /** Your STYRK-08 occupation for the SSB market pay; null = the default (2512). */
  market?: { styrk: StyrkCode } | null;
  /** "Lagre som utgangspunkt": write the levers (after `levers` above) into the groups and set them to 0. */
  applyLevers?: boolean;
}

/** Only the defined fields of a patch, so an omitted field keeps its value. */
const definedOnly = <T extends object>(patch: Partial<T> | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(patch ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Change the model's settings. Only given fields change; levers are clamped to their slider range. */
export function updateCompanySettings(blob: ExportPayload, args: CompanySettingsFields): FieldChange[] {
  const { mode, selfGroupId, hours, bonus, levers, targetMarginPct, self, market, applyLevers: apply } = args;
  if (mode === undefined && selfGroupId === undefined && hours === undefined && bonus === undefined
    && levers === undefined && targetMarginPct === undefined && self === undefined && market === undefined && !apply) {
    throw new Error('no company settings provided');
  }
  return writeCompany(blob, (m) => {
    if (selfGroupId !== undefined && !m.groups.some((g) => g.id === selfGroupId && g.kind === 'delivery')) {
      throw new Error(`no delivery group with id "${selfGroupId}"`);
    }
    // Clamp the levers first, so "apply" writes what the sliders show.
    const next = sanitizeCompanyModel({
      ...m,
      ...(mode !== undefined ? { mode } : {}),
      ...(selfGroupId !== undefined ? { selfGroupId } : {}),
      ...(targetMarginPct !== undefined ? { targetMarginPct } : {}),
      hours: { ...m.hours, ...definedOnly(hours) },
      bonus: { ...m.bonus, ...definedOnly(bonus) },
      levers: { ...m.levers, ...definedOnly(levers) },
      self: self === null ? undefined : { ...m.self, ...definedOnly(self ?? {}) },
      market: market === null ? undefined : market ?? m.market,
    });
    return apply ? applyLevers(next) : next;
  });
}

export interface CompanyQuickSetupArgs {
  /** The quick setup's answers; a missing answer keeps the stored one, else the default. */
  answers?: Partial<QuickAnswers>;
  /** Answers that are a guess ("usikker"); they get a range. Omitted: the stored list. */
  uncertain?: QuickGuessKey[];
  /** Answers that are not known ("vet ikke"); the industry value is used, with a wider range. Omitted: the stored list, without keys answered here. */
  dontKnow?: QuickGuessKey[];
  /** Needed when the groups or cost lines were changed by hand after the last setup. */
  confirmReplace?: boolean;
}

/**
 * "Hurtigoppsett" from chat: build the groups, cost lines and your own share from
 * the answers, as the page's "Bruk svarene" does. A missing answer keeps the
 * stored one (or the industry default on a first setup). A "vet ikke" answer uses the
 * industry value (an unknown office: one desk per FTE). After a hand edit it
 * refuses unless confirmReplace is true, because the rebuild replaces those edits.
 * Touches only `companyModel`.
 */
export function setupCompanyQuick(blob: ExportPayload, args: CompanyQuickSetupArgs): FieldChange[] {
  const before = sanitizeCompanyModel(blob.companyModel);
  if (quickReplacesHandEdits(before) && args.confirmReplace !== true) {
    throw new Error('the company groups, cost lines, your own share or the bonus pool were changed by hand (or set up without the quick setup); '
      + 'the setup replaces those edits. Ask the user, then call again with confirmReplace: true');
  }
  // An omitted list keeps the stored flags. A typed answer is no longer "vet ikke", as in the form.
  const given = new Set(Object.entries(args.answers ?? {}).filter(([, v]) => v !== undefined).map(([k]) => k));
  const answerKeys: Record<QuickGuessKey, (keyof QuickAnswers)[]> = {
    salary: ['salaryLow', 'salaryHigh'], rateAverage: ['rateAverage'], ownBillablePct: ['ownBillablePct'],
    typicalBillablePct: ['typicalBillablePct'], realizationPct: ['realizationPct'], office: ['officeMode', 'desks', 'annualRent'],
  };
  const dontKnow = [...new Set(args.dontKnow ?? (before.quick?.dontKnow ?? []).filter((k) => !answerKeys[k].some((f) => given.has(f))))];
  const uncertain = [...new Set(args.uncertain ?? before.quick?.uncertain ?? [])].filter((k) => !dontKnow.includes(k));
  // A first setup takes your rate from the calculator when it is set, as the form does.
  const answers: QuickAnswers = before.quick
    ? { ...before.quick.answers }
    : { ...QUICK_DEFAULTS, rateYou: blob.billingConfig?.billedHourly ?? QUICK_DEFAULTS.rateYou };
  for (const [k, v] of Object.entries(args.answers ?? {})) if (v !== undefined) (answers as unknown as Record<string, unknown>)[k] = v;
  // "vet ikke" resets the answer to the industry value, as the form does.
  for (const k of dontKnow) {
    if (k === 'salary') Object.assign(answers, { salaryLow: QUICK_DEFAULTS.salaryLow, salaryHigh: QUICK_DEFAULTS.salaryHigh });
    else if (k === 'office') { answers.officeMode = QUICK_DEFAULTS.officeMode; delete answers.desks; }
    else answers[k] = QUICK_DEFAULTS[k];
  }
  const labels = blob.lang === 'en' ? translations.en.companyModel.quickLabels : translations.nb.companyModel.quickLabels;
  const after = sanitizeCompanyModel(buildModelFromAnswers(sanitizeQuickAnswers(answers), before, { uncertain, dontKnow, labels }));
  const changes = blob.companyModel === undefined ? [diff('companyModel', null, after)] : companyChanges(before, after);
  blob.companyModel = after;
  return changes;
}
