// Tier 2: write/mutation tools. Thin zod wrappers over the pure builders in
// mcp/mutations.ts. Each does a rev-guarded read-modify-write via applyMutation
// (409-retry) and returns a before/after diff. The whole rest of the blob is
// preserved; the server's isValidFinancePayload / preserveUserFields / reconcile
// guards still run. The data-safety invariants are tested against mutations.ts.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExportPayload } from '../../src/context/FinanceContext';
import { applyMutation, RevConflictError, restoreRevision } from '../client';
import { jsonResult, errorResult, type FieldChange } from '../util';
import {
  CATEGORY_KEYS,
  GOAL_SOURCES,
  EXPENSE_TYPES,
  type CategoryKey,
  type GoalSource,
  type ExpenseType,
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
  RULE_TYPES,
  type RuleType,
  addRule,
  deleteRule,
  updateAsset,
  upsertSavingsAccount,
  deleteSavingsAccount,
  DEBT_TYPES,
  upsertDebt,
  deleteDebt,
  updateLoan,
  setMonthlyIncome,
  SALARY_CHANGE_TYPES,
  BONUS_TYPES,
  addSalary,
  addBonus,
} from '../mutations';
import type { DebtType, SalaryChangeType, BonusType } from '../../src/context/FinanceContext';

const readWrite = { readOnlyHint: false, openWorldHint: false } as const;
const categoryEnum = z.enum(CATEGORY_KEYS as unknown as [CategoryKey, ...CategoryKey[]]);
const sourceEnum = z.enum(GOAL_SOURCES as unknown as [GoalSource, ...GoalSource[]]);
const typeEnum = z.enum(EXPENSE_TYPES as unknown as [ExpenseType, ...ExpenseType[]]);
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ruleTypeEnum = z.enum(RULE_TYPES as unknown as [RuleType, ...RuleType[]]);
const debtTypeEnum = z.enum(DEBT_TYPES as unknown as [DebtType, ...DebtType[]]);
const salaryChangeEnum = z.enum(SALARY_CHANGE_TYPES as unknown as [SalaryChangeType, ...SalaryChangeType[]]);
const bonusTypeEnum = z.enum(BONUS_TYPES as unknown as [BonusType, ...BonusType[]]);
const kindEnum = z.enum(['expense', 'income']);
const kr = z.number().min(0);

async function run(build: (blob: ExportPayload) => FieldChange[]) {
  try {
    let changes: FieldChange[] = [];
    const { rev } = await applyMutation((blob) => {
      changes = build(blob);
      return blob;
    });
    return jsonResult({ ok: true, rev, changed: changes });
  } catch (e) {
    if (e instanceof RevConflictError) {
      return errorResult('the data changed on the server during the write; nothing was saved, try again');
    }
    return errorResult(String((e as Error).message));
  }
}

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    'set_category_budget',
    {
      title: 'Set a category budget',
      description: 'Set (or clear, with amount 0) the monthly budget for one spending category.',
      inputSchema: { category: categoryEnum, amount: z.number().min(0).describe('Monthly budget in kr; 0 clears it.') },
      annotations: { title: 'Set a category budget', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    ({ category, amount }) => run((blob) => setCategoryBudget(blob, { category, amount })),
  );

  server.registerTool(
    'add_goal',
    {
      title: 'Add a savings goal',
      description: 'Create a new goal. source picks where its "current" value comes from (manual uses manualCurrent).',
      inputSchema: {
        name: z.string().min(1),
        target: z.number().min(0).describe('Target amount in kr.'),
        source: sourceEnum.optional().describe('Default "manual".'),
        manualCurrent: z.number().min(0).optional().describe('Current amount when source="manual".'),
        deadline: yearMonth.optional().describe("Optional 'YYYY-MM'."),
        notes: z.string().optional(),
      },
      annotations: { title: 'Add a savings goal', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addGoal(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'update_goal',
    {
      title: 'Update a savings goal',
      description: 'Change fields of an existing goal (id from get_savings_and_goals). Only provided fields change.',
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        target: z.number().min(0).optional(),
        manualCurrent: z.number().min(0).optional(),
        deadline: yearMonth.optional(),
        notes: z.string().optional(),
      },
      annotations: { title: 'Update a savings goal', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => updateGoal(blob, args)),
  );

  server.registerTool(
    'add_fixed_expense',
    {
      title: 'Add a fixed expense',
      description: 'Add a recurring budget line (rent, insurance, subscription, etc.).',
      inputSchema: {
        name: z.string().min(1),
        amount: z.number().min(0).describe('Monthly amount in kr.'),
        type: typeEnum.optional().describe('Default "fixed". "subscription" is excluded from the emergency-fund runway.'),
        category: categoryEnum.optional().describe('Link to a spending category to make this an envelope.'),
      },
      annotations: { title: 'Add a fixed expense', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addFixedExpense(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'update_fixed_expense',
    {
      title: 'Update a fixed expense',
      description: 'Change the name/amount/type/category of an existing fixed expense (id from get_raw_data). Only provided fields change.',
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        amount: z.number().min(0).optional(),
        type: typeEnum.optional(),
        category: categoryEnum.optional().describe('Link to a spending category to make this an envelope.'),
      },
      annotations: { title: 'Update a fixed expense', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => updateFixedExpense(blob, args)),
  );

  server.registerTool(
    'update_assumptions',
    {
      title: 'Update planning assumptions',
      description: 'Change forecast/savings assumptions. Only provided fields change.',
      inputSchema: {
        savingsTargetPercent: z.number().min(0).max(100).optional(),
        growthReturnRate: z.number().optional().describe('Expected annual investment return %.'),
        houseGrowthRate: z.number().optional(),
        cashGrowthRate: z.number().optional(),
        cryptoGrowthRate: z.number().optional(),
      },
      annotations: { title: 'Update planning assumptions', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (fields) => run((blob) => updateAssumptions(blob, fields)),
  );

  server.registerTool(
    'set_ai_context',
    {
      title: 'Set AI context notes',
      description:
        "Replace the user's free-text context/plans notes (long-term goals, e.g. going independent). This OVERWRITES — read the existing notes via get_overview or get_raw_data first if you mean to append.",
      inputSchema: { text: z.string().describe('The full notes text to store.') },
      annotations: { title: 'Set AI context notes', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    ({ text }) => run((blob) => setAiContext(blob, { text })),
  );

  server.registerTool(
    'set_profile',
    {
      title: 'Set user profile',
      description:
        "Update the user's optional profile. Only provided fields change (the other is left as-is). `birthDate` also drives the pension birth year.",
      inputSchema: {
        name: z.string().optional().describe("The user's display name."),
        birthDate: isoDate.optional().describe("Date of birth as 'YYYY-MM-DD'."),
      },
      annotations: { title: 'Set user profile', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (fields) => run((blob) => setProfile(blob, fields)),
  );

  server.registerTool(
    'delete_goal',
    {
      title: 'Delete a savings goal',
      description: 'Remove a goal (id from get_savings_and_goals).',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a savings goal', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteGoal(blob, args)),
  );

  server.registerTool(
    'delete_fixed_expense',
    {
      title: 'Delete a fixed expense',
      description: 'Remove a recurring budget line (id from get_raw_data).',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a fixed expense', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteFixedExpense(blob, args)),
  );

  // ── Transactions ──────────────────────────────────────────────────────────

  server.registerTool(
    'add_transaction',
    {
      title: 'Add a transaction',
      description: 'Record a manual transaction. amount is always positive; kind says whether it is money out or in.',
      inputSchema: {
        date: isoDate.describe("'YYYY-MM-DD'."),
        description: z.string().min(1),
        amount: z.number().positive().describe('Amount in kr, positive.'),
        category: categoryEnum.optional(),
        kind: kindEnum.optional().describe('Default "expense".'),
      },
      annotations: { title: 'Add a transaction', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addTransaction(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'update_transaction',
    {
      title: 'Update a transaction',
      description:
        'Change fields of a transaction (id from get_raw_data). Only provided fields change. Setting category marks it as a manual choice, so bank sync and rules leave it alone.',
      inputSchema: {
        id: z.string().min(1),
        date: isoDate.optional(),
        description: z.string().min(1).optional(),
        amount: z.number().positive().optional(),
        category: categoryEnum.optional(),
        kind: kindEnum.optional(),
      },
      annotations: { title: 'Update a transaction', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => updateTransaction(blob, args)),
  );

  server.registerTool(
    'delete_transaction',
    {
      title: 'Delete a transaction',
      description:
        'Remove a transaction (id from get_raw_data). A bank-imported row is also remembered as deleted so the next bank sync does not bring it back.',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a transaction', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteTransaction(blob, args)),
  );

  // ── Rules ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'add_rule',
    {
      title: 'Add a transaction rule',
      description:
        'Add a rule that matches transaction text (case-insensitive substring of merchant/description). type "category" sets a category (needs category), "label" sets a display name (needs label), "transfer" marks matches as own-account transfers (not spending). An existing rule of the same type with the same match is replaced.',
      inputSchema: {
        type: ruleTypeEnum,
        match: z.string().min(1).describe('Text to match, e.g. a merchant name.'),
        category: categoryEnum.optional().describe('Required when type="category".'),
        label: z.string().min(1).optional().describe('Required when type="label".'),
      },
      annotations: { title: 'Add a transaction rule', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addRule(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'delete_rule',
    {
      title: 'Delete a transaction rule',
      description: 'Remove a category, label or transfer rule (id from get_raw_data: categoryRules / labelRules / transferRules).',
      inputSchema: { type: ruleTypeEnum, id: z.string().min(1) },
      annotations: { title: 'Delete a transaction rule', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteRule(blob, args)),
  );

  // ── Balances ──────────────────────────────────────────────────────────────

  server.registerTool(
    'update_asset',
    {
      title: 'Update asset balances',
      description:
        'Change numeric asset fields. Only provided fields change. houseValue/houseDebt are also mirrored into the homeowner/transition housing data, as the app does. Savings accounts use upsert_savings_account.',
      inputSchema: {
        portfolio: kr.optional().describe('Funds/shares market value in kr.'),
        unrealizedGain: z.number().optional().describe('Unrealized gain on the portfolio in kr (may be negative).'),
        shieldingDeduction: kr.optional().describe('Unused skjermingsfradrag on shares/funds in kr.'),
        taxRate: z.number().min(0).max(100).optional().describe('Tax rate % on portfolio gains.'),
        bsu: kr.optional(),
        bsuAnnualContribution: kr.optional().describe('Planned BSU deposit this year in kr.'),
        houseValue: kr.optional(),
        houseDebt: kr.optional().describe('Mortgage balance in kr.'),
        crypto: kr.optional(),
        cryptoUnrealizedGain: z.number().optional(),
        cryptoTaxRate: z.number().min(0).max(100).optional(),
        bufferAccount: kr.optional().describe('Buffer/emergency account balance in kr.'),
      },
      annotations: { title: 'Update asset balances', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (fields) => run((blob) => updateAsset(blob, fields)),
  );

  server.registerTool(
    'upsert_savings_account',
    {
      title: 'Create or update a savings account',
      description:
        'Without id: create a savings account (name required, balance defaults to 0). With id (from get_raw_data assets.savingsAccounts): change its name and/or balance.',
      inputSchema: {
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        balance: kr.optional().describe('Balance in kr.'),
      },
      annotations: { title: 'Create or update a savings account', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    ({ id, ...rest }) => run((blob) => upsertSavingsAccount(blob, { id: id ?? crypto.randomUUID(), create: !id, ...rest })),
  );

  server.registerTool(
    'delete_savings_account',
    {
      title: 'Delete a savings account',
      description: 'Remove a savings account (id from get_raw_data assets.savingsAccounts).',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a savings account', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteSavingsAccount(blob, args)),
  );

  server.registerTool(
    'upsert_debt',
    {
      title: 'Create or update a debt',
      description:
        'Without id: create a non-mortgage debt (name, type, balance required; rate and minPayment too unless revolving). With id (from get_debt_analysis or get_raw_data): change only the provided fields.',
      inputSchema: {
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        type: debtTypeEnum.optional(),
        balance: kr.optional().describe('Outstanding principal in kr.'),
        rate: z.number().min(0).optional().describe('Annual nominal interest rate %.'),
        minPayment: kr.optional().describe('Normal monthly payment in kr.'),
        revolving: z.boolean().optional().describe('A card paid in full every month; rate/minPayment are stored as 0.'),
        creditLimit: kr.optional().describe('Granted credit frame in kr, for a card or credit line.'),
        interestFreeUntil: yearMonth.optional().describe("Student loan: 'YYYY-MM' when interest and repayment start."),
      },
      annotations: { title: 'Create or update a debt', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    ({ id, ...rest }) => run((blob) => upsertDebt(blob, { id: id ?? crypto.randomUUID(), create: !id, ...rest })),
  );

  server.registerTool(
    'delete_debt',
    {
      title: 'Delete a debt',
      description: 'Remove a non-mortgage debt (id from get_debt_analysis or get_raw_data).',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a debt', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteDebt(blob, args)),
  );

  server.registerTool(
    'update_loan',
    {
      title: 'Update mortgage application inputs',
      description:
        'Change the first-buyer loan calculator inputs (the `loan` slice). Only provided fields change. For the current mortgage balance use update_asset houseDebt.',
      inputSchema: {
        arslonn: kr.optional().describe('Annual gross income in kr.'),
        eksisterendeGjeld: kr.optional().describe('Existing debt in kr.'),
        egenkapital: kr.optional().describe('Equity (down payment) in kr.'),
        laanebelop: kr.optional().describe('Loan amount in kr.'),
        rente: z.number().min(0).optional().describe('Nominal interest rate %.'),
        nedbetalingstid: z.number().min(0).optional().describe('Repayment period in years.'),
        termingebyr: kr.optional().describe('Fee per instalment in kr.'),
        etableringsgebyr: kr.optional().describe('Set-up fee in kr.'),
        betingetLaan: kr.optional().describe('Conditional loan amount in kr.'),
        kjoepesum: kr.optional().describe('Purchase price in kr.'),
        gyldigTil: yearMonth.optional().describe("Financing certificate valid until 'YYYY-MM'."),
      },
      annotations: { title: 'Update mortgage application inputs', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (fields) => run((blob) => updateLoan(blob, fields)),
  );

  // ── Income ────────────────────────────────────────────────────────────────

  server.registerTool(
    'set_monthly_income',
    {
      title: 'Set a month\'s income',
      description:
        'Override the net income for one month, or remove the override with clear=true (the month then falls back to the default income). Give exactly one of amount or clear. 0 is a valid amount (a month with no pay).',
      inputSchema: {
        month: yearMonth.describe("'YYYY-MM'."),
        amount: kr.optional().describe('Net income for the month in kr.'),
        clear: z.boolean().optional().describe('true removes the override.'),
      },
      annotations: { title: 'Set a month\'s income', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => setMonthlyIncome(blob, args)),
  );

  server.registerTool(
    'add_salary',
    {
      title: 'Add a salary entry',
      description: 'Record a salary level for a job from a month on (jobId from get_raw_data jobs; must exist).',
      inputSchema: {
        jobId: z.string().min(1),
        effectiveDate: yearMonth.describe("'YYYY-MM' the salary applies from."),
        grossAnnual: kr.describe('Gross annual salary in kr.'),
        changeType: salaryChangeEnum,
        notes: z.string().optional(),
      },
      annotations: { title: 'Add a salary entry', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addSalary(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'add_bonus',
    {
      title: 'Add a bonus',
      description: 'Record a bonus payment. jobId is optional, but must exist in jobs when given.',
      inputSchema: {
        date: isoDate.describe("'YYYY-MM-DD'."),
        amount: kr.describe('Gross amount in kr.'),
        type: bonusTypeEnum,
        jobId: z.string().min(1).optional(),
        includeInBudget: z.boolean().optional().describe("Count this toward that month's budget income."),
        notes: z.string().optional(),
      },
      annotations: { title: 'Add a bonus', ...readWrite, destructiveHint: false, idempotentHint: false },
    },
    (args) => run((blob) => addBonus(blob, { id: crypto.randomUUID(), ...args })),
  );

  server.registerTool(
    'restore_revision',
    {
      title: 'Restore a past revision',
      description:
        'Roll the whole dataset back to a past revision (rev from list_history). The restore is itself saved as a new revision, so it can be undone.',
      inputSchema: { rev: z.number().int().describe('Revision number to restore, from list_history.') },
      annotations: { title: 'Restore a past revision', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    async ({ rev }) => {
      try {
        const out = await restoreRevision(rev);
        return jsonResult({ ok: true, ...out });
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );
}
