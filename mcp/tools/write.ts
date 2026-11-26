// Tier 2: write/mutation tools. Thin zod wrappers over the pure builders in
// mcp/mutations.ts. Each does a rev-guarded read-modify-write via applyMutation
// (409-retry) and returns a before/after diff. The whole rest of the blob is
// preserved; the server's isValidFinancePayload / preserveUserFields / reconcile
// guards still run. The data-safety invariants are tested against mutations.ts.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExportPayload } from '../../src/context/FinanceContext';
import { applyMutation, RevConflictError, restoreRevision, undoRevision, getBrreg } from '../client';
import { companyContext } from '../derive';
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
  updateCurrentMortgage,
  setCoOwners,
  setMonthlyIncome,
  SALARY_CHANGE_TYPES,
  BONUS_TYPES,
  addSalary,
  addBonus,
  COMPANY_GROUP_KINDS,
  COST_LINE_PERS,
  upsertCompanyGroup,
  deleteCompanyGroup,
  upsertCompanyCostLine,
  deleteCompanyCostLine,
  updateCompanySettings,
  setupCompanyQuick,
  calibrateCompanyFromAccounts,
} from '../mutations';
import type { CompanyAccounts } from '../../src/lib/companyAccounts';
import { isValidOrgnr } from '../../src/lib/validators';
import { QUICK_GUESS_KEYS, QUICK_RESALE_MAX_PCT, type QuickGuessKey } from '../../src/lib/companySetup';
import { STYRK_CODES } from '../../src/lib/marketWage';
import type { DebtType, SalaryChangeType, BonusType } from '../../src/context/FinanceContext';
import { LEVER_RANGES, BONUS_POOL_MAX_PCT, TARGET_MARGIN_RANGE, type CompanyGroupKind, type CostLinePer } from '../../src/lib/companyCost';

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
const pct = z.number().min(0).max(100);

/** Fields of a company role group; shared with simulate_company. */
export const companyGroupFields = {
  name: z.string().min(1).max(200).optional().describe("Role name, e.g. 'Konsulenter'."),
  kind: z.enum(COMPANY_GROUP_KINDS as unknown as [CompanyGroupKind, ...CompanyGroupKind[]]).optional()
    .describe('"delivery" bills clients and shares the overhead; "support" (management, HR) is overhead.'),
  count: z.number().min(0).max(100_000).optional().describe('FTE, decimals allowed. Your own group counts you too.'),
  avgGross: kr.optional().describe('Average fixed gross salary per FTE in kr per year.'),
  billablePct: pct.optional().describe('Billable share of AVAILABLE hours (after holidays, sick and internal time), %.'),
  hourlyRate: kr.optional().describe('List price per hour in kr.'),
  realizationPct: pct.optional().describe('Share of the list price the client really pays, %. Default 100 on create.'),
};

/** Fields of a company cost line; shared with simulate_company. */
export const companyCostLineFields = {
  label: z.string().min(1).max(200).optional(),
  amount: kr.optional().describe('kr per year (per="company"), kr per head per year (per="head"), or % of total salary (per="pctOfSalary", 100 or less).'),
  per: z.enum(COST_LINE_PERS as unknown as [CostLinePer, ...CostLinePer[]]).optional().describe('Default "company" on create.'),
};

const leverFields = {
  utilizationPp: z.number().optional().describe(`Delivery groups' billable share, percentage points (${LEVER_RANGES.utilizationPp.min} to ${LEVER_RANGES.utilizationPp.max}; clamped).`),
  ratePct: z.number().optional().describe(`All hourly rates, % (${LEVER_RANGES.ratePct.min} to ${LEVER_RANGES.ratePct.max}; clamped).`),
  salaryPct: z.number().optional().describe(`The groups' salaries, % (${LEVER_RANGES.salaryPct.min} to ${LEVER_RANGES.salaryPct.max}; clamped). Your own salary comes from the salary page.`),
  realizationPp: z.number().optional().describe(`All realization, percentage points (${LEVER_RANGES.realizationPp.min} to ${LEVER_RANGES.realizationPp.max}; clamped).`),
};
export const companyLeversSchema = z.object(leverFields);

async function run(build: (blob: ExportPayload) => FieldChange[]) {
  try {
    let changes: FieldChange[] = [];
    const { rev, unchanged } = await applyMutation(
      (blob) => {
        changes = build(blob);
        return blob;
      },
      // The changed fields without row ids (debts[<uuid>].balance → debts.balance):
      // the history label is for people scanning the list, and ids are noise there.
      () => [...new Set(changes.map((c) => c.field.replace(/\[[^\]]*\]/g, '')))].join(', '),
    );
    if (unchanged) return jsonResult({ ok: true, rev, unchanged: true, note: 'already set; nothing was saved' });
    return jsonResult({ ok: true, rev, changed: changes, undo: `undo_change with rev ${rev}` });
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
        'Change numeric asset fields. Only provided fields change. houseDebt is the current mortgage balance and stamps its month; houseValue is also mirrored into the transition housing data, as the app does. Savings accounts use upsert_savings_account.',
      inputSchema: {
        portfolio: kr.optional().describe('Funds/shares market value in kr.'),
        unrealizedGain: z.number().optional().describe('Unrealized gain on the portfolio in kr (may be negative).'),
        shieldingDeduction: kr.optional().describe('Unused skjermingsfradrag on shares/funds in kr.'),
        taxRate: z.number().min(0).max(100).optional().describe('Tax rate % on portfolio gains.'),
        bsu: kr.optional(),
        bsuAnnualContribution: kr.optional().describe('Planned BSU deposit this year in kr.'),
        bsuTotalDeposited: kr.optional().describe('Total deposited into BSU so far in kr, excluding interest. The 300 000 kr lifetime cap counts deposits.'),
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
        'Change the planned-loan calculator inputs used in first-buyer and buy-and-sell modes (the `loan` slice). Only provided fields change. For the mortgage the user already has, use update_current_mortgage.',
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

  server.registerTool(
    'update_current_mortgage',
    {
      title: 'Update the current mortgage',
      description:
        'Change the mortgage the user already has (the `homeowner` slice): a homeowner\'s loan, and while transitioning the current home\'s loan owed until the sale (its rate and term drive the projections until the mode is switched). Only provided fields change. The remaining term is given as termYears + termMonths (both together) and counts down from the current month. balance is written to assets.houseDebt, the one stored mortgage balance. For the planned purchase loan use update_loan.',
      inputSchema: {
        rente: z.number().min(0).optional().describe('Nominal interest rate %.'),
        termingebyr: kr.optional().describe('Fee per instalment in kr.'),
        startDate: yearMonth.optional().describe("Loan start month 'YYYY-MM'."),
        balance: kr.optional().describe('Remaining balance (restgjeld) in kr.'),
        termYears: z.number().int().min(0).max(50).optional().describe('Remaining term, whole years. Requires termMonths.'),
        termMonths: z.number().int().min(0).max(11).optional().describe('Remaining term, extra months 0-11. Requires termYears.'),
      },
      annotations: { title: 'Update the current mortgage', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (fields) => run((blob) => updateCurrentMortgage(blob, fields)),
  );

  server.registerTool(
    'set_co_owners',
    {
      title: 'Set the co-owners of the current home',
      description:
        "Replace the whole list of other owners of the current home (assets.coOwners); pass [] to remove them all. Deliberately replace-all, unlike the upsert_* tools: the shares must add up together. assets.houseValue and houseDebt stay the whole property and loan; the user's share is 100% minus the co-owners active that month. debtSharePct is the co-owner's share of the joint loan as in the tax return (omit to follow ownershipPct). since/until bound when they owned it (until = their last month, e.g. after selling their share); a new row without since owns from the current home's move-in. Stored history is rewritten to match. Read the full current list from get_mortgage ownership.coOwners (not activeCoOwners) and pass every row back, with its id: a row left out is deleted from history too.",
      inputSchema: {
        coOwners: z.array(z.object({
          id: z.string().min(1).optional().describe('Keep the existing id when editing a row; omit for a new one.'),
          name: z.string().describe("Free text, e.g. 'Samboer'."),
          ownershipPct: z.number().min(0).max(100).describe('Their share of the property, %.'),
          debtSharePct: z.number().min(0).max(100).optional().describe('Their share of the loan, %. Omit = same as ownershipPct.'),
          since: yearMonth.optional().describe("First month as co-owner 'YYYY-MM'. Omit on a new row = the current home's move-in month."),
          until: yearMonth.optional().describe("Last month as co-owner 'YYYY-MM'."),
        })),
      },
      annotations: { title: 'Set the co-owners of the current home', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => setCoOwners(blob, args)),
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

  // ── Company model (employer-cost page, Avansert) ──────────────────────────

  server.registerTool(
    'upsert_company_group',
    {
      title: 'Create or update a company role group',
      description:
        'Without id: add a role group to the company model (name, kind, count, avgGross required; billablePct and hourlyRate too for a delivery group). With id (from get_company_model model.groups): change only the provided fields. Your own group stays a delivery group: if it becomes support, your group moves to the first delivery group.',
      inputSchema: { id: z.string().min(1).optional(), ...companyGroupFields },
      annotations: { title: 'Create or update a company role group', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    ({ id, ...rest }) => run((blob) => upsertCompanyGroup(blob, { id: id ?? crypto.randomUUID(), create: !id, ...rest })),
  );

  server.registerTool(
    'delete_company_group',
    {
      title: 'Delete a company role group',
      description: 'Remove a role group (id from get_company_model model.groups). If it was your group, your group moves to the first delivery group.',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a company role group', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteCompanyGroup(blob, args)),
  );

  server.registerTool(
    'upsert_company_cost_line',
    {
      title: 'Create or update a company cost line',
      description:
        'Without id: add a cost line to the company model (label and amount required, per defaults to "company"). With id (from get_company_model model.costs): change only the provided fields. Cost lines plus the support groups make the overhead pool.',
      inputSchema: { id: z.string().min(1).optional(), ...companyCostLineFields },
      annotations: { title: 'Create or update a company cost line', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    ({ id, ...rest }) => run((blob) => upsertCompanyCostLine(blob, { id: id ?? crypto.randomUUID(), create: !id, ...rest })),
  );

  server.registerTool(
    'delete_company_cost_line',
    {
      title: 'Delete a company cost line',
      description: 'Remove a cost line (id from get_company_model model.costs).',
      inputSchema: { id: z.string().min(1) },
      annotations: { title: 'Delete a company cost line', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => deleteCompanyCostLine(blob, args)),
  );

  server.registerTool(
    'update_company_settings',
    {
      title: 'Update company model settings',
      description:
        'Change the company model settings. Only provided fields change. leave sets parental leave: count = FTE on leave over the year (they bill nothing and count as heads), fullPay = the company pays full salary and NAV refunds up to 6G (false: NAV pays the person, salary cost 0); null removes it. A leave change counts as a hand edit (quick.edited). targetMarginPct sets the target margin for the fair salary; null goes back to the company margin before bonus. mode "advanced" makes the employer-cost page use the company model (Avansert), "simple" the flat overhead (Enkel). Levers are stored as the page sliders and are clamped to their range. self sets your own billable share and rate (null clears it). market.styrk is your STYRK-08 occupation for the SSB market pay on the page (null goes back to 2512). A change to selfGroupId, or applyLevers, counts as a hand edit of the groups (quick.edited). applyLevers=true is "Lagre som utgangspunkt": it writes the levers (after any given here) into the groups and sets them to 0, so the results stay the same. Try changes first with simulate_company.',
      inputSchema: {
        mode: z.enum(['simple', 'advanced']).optional(),
        selfGroupId: z.string().min(1).optional().describe('Your group: the id of a delivery group (from get_company_model model.groups).'),
        hours: z.object({
          sickPct: pct.optional().describe('Sick leave, % of the hours left after holidays.'),
          internalPct: pct.optional().describe('Internal (non-billable) time, % of the hours left after holidays.'),
          holidayDays: z.number().min(0).max(366).optional().describe('Holiday (ferie) weekdays per year.'),
        }).optional(),
        bonus: z.object({
          poolPct: z.number().min(0).max(BONUS_POOL_MAX_PCT).optional().describe(`Bonus pool, % of the result before bonus (0-${BONUS_POOL_MAX_PCT}).`),
          includesHolidayPay: z.boolean().optional().describe('The bonus also earns holiday pay.'),
        }).optional(),
        levers: companyLeversSchema.optional(),
        targetMarginPct: z.number().min(TARGET_MARGIN_RANGE.min).max(TARGET_MARGIN_RANGE.max).nullable().optional()
          .describe(`Target margin on you for the fair salary ("Rimelig lønn"), % (${TARGET_MARGIN_RANGE.min}-${TARGET_MARGIN_RANGE.max}). null = the company margin before bonus (the default).`),
        self: z.object({
          billablePct: pct.optional().describe('Your own billable share, % of available hours.'),
          hourlyRate: z.number().min(0).max(100_000).optional().describe('Your own list rate, kr/hour.'),
        }).nullable().optional()
          .describe('Your own billable share and rate where they differ from your group. Only given fields change; null clears both, so you use your group\'s values.'),
        market: z.object({
          styrk: z.enum(STYRK_CODES).describe('STYRK-08 code: 25 IKT-rådgivere (all), 2511 system analysts/architects, 2512 software developers, 2513 web and multimedia developers, 2514 application programmers, 2519 other software developers, 2521 database designers/administrators, 2522 system administrators, 2529 security analysts etc.'),
        }).nullable().optional()
          .describe('Your occupation for the SSB market pay marker ("Marked"). null = the default, 2512.'),
        leave: z.object({
          count: z.number().min(0).max(100_000).optional().describe('FTE on parental leave over the year. 1 person for 49 weeks is about 1 FTE.'),
          fullPay: z.boolean().optional().describe('true (default): the company pays full salary and gets NAV\'s refund up to 6G. false: NAV pays the person.'),
        }).nullable().optional().describe('Parental leave (foreldrepermisjon). Only given fields change; null removes it.'),
        applyLevers: z.boolean().optional().describe('true: write the levers into the groups and set them to 0.'),
      },
      annotations: { title: 'Update company model settings', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    (fields) => run((blob) => updateCompanySettings(blob, fields)),
  );

  const guessKey = z.enum(QUICK_GUESS_KEYS as unknown as [QuickGuessKey, ...QuickGuessKey[]]);
  server.registerTool(
    'setup_company_quick',
    {
      title: 'Quick setup of the company model',
      description:
        'The employer-cost page\'s quick setup ("Hurtigoppsett"): build the company model\'s role groups (consultants, bench, leadership/HR/marketing), '
        + 'cost lines and your own billable share and rate from a few plain answers, as the page\'s "Bruk svarene" button does. '
        + 'Every answer is optional: a missing one keeps the stored answer (on a first setup: an industry default, and your rate from the billing settings). '
        + 'uncertain and dontKnow mark answers that are a guess; get_company_model and simulate_company then give ranges and the "what matters most" list. '
        + 'A dontKnow answer uses the industry value even when you pass a number for it. Hours, the target margin and the mode are kept; the levers go to 0. '
        + 'When quick.edited is true (get_company_model), groups or cost lines were changed by hand and this replaces them: ask the user first, then pass confirmReplace: true. '
        + 'One undoable write that touches only companyModel.',
      inputSchema: {
        answers: z.object({
          totalFte: z.number().min(0).max(100_000).optional().describe('FTE (årsverk) in the company, everyone included.'),
          nonBilling: z.number().min(0).max(100_000).optional().describe('FTE that never bill: leadership, HR, marketing.'),
          onBench: z.number().min(0).max(100_000).optional().describe('Consultants without a client (the bench), average over the year.'),
          onLeave: z.number().min(0).max(100_000).optional().describe('FTE on parental leave over the year. They come out of the consultants and bill nothing.'),
          leaveFullPay: z.boolean().optional().describe('The company pays full salary on leave and gets NAV\'s refund up to 6G (default true).'),
          salaryLow: kr.max(100_000_000).optional().describe('Consultants\' gross salary, low end, kr per year. The model uses the midpoint of low and high.'),
          salaryHigh: kr.max(100_000_000).optional().describe('Consultants\' gross salary, high end, kr per year (not below salaryLow).'),
          rateAverage: kr.max(100_000).optional().describe('Average list rate in the company, kr per hour.'),
          rateYou: kr.max(100_000).optional().describe('Your own list rate, kr per hour.'),
          ownBillablePct: pct.optional().describe('Your billable share of available hours, %.'),
          typicalBillablePct: pct.optional().describe('A typical consultant\'s billable share of available hours, %.'),
          realizationPct: pct.optional().describe('Share of the list price clients really pay, %.'),
          bonusPct: z.number().min(0).max(BONUS_POOL_MAX_PCT).optional().describe(`Bonus pool, % of the result before bonus (0-${BONUS_POOL_MAX_PCT}).`),
          officeMode: z.enum(['desks', 'rent']).optional().describe('"desks": office cost = desks x an industry price per desk; "rent": the yearly rent.'),
          desks: z.number().min(0).max(100_000).optional().describe('Number of desks (officeMode "desks"). Missing: one per FTE.'),
          annualRent: kr.max(1_000_000_000).optional().describe('Office rent, kr per year (officeMode "rent").'),
          tripsPerYear: z.number().min(0).max(52).optional().describe('Company trips per year.'),
          resaleSharePct: z.number().min(0).max(QUICK_RESALE_MAX_PCT).optional()
            .describe(`Share of revenue that is resold subcontractors (videresalg), % (0-${QUICK_RESALE_MAX_PCT}). Only lowers the accounts' revenue in calibrate_company_from_accounts; the model is unchanged.`),
        }).optional(),
        uncertain: z.array(guessKey).max(QUICK_GUESS_KEYS.length).optional()
          .describe('Answers that are a guess ("usikker"). salary ±10 %, rateAverage ±5 %, ownBillablePct and typicalBillablePct ±5 pp, realizationPct ±3 pp, office ±20 %. Omitted: the stored list.'),
        dontKnow: z.array(guessKey).max(QUICK_GUESS_KEYS.length).optional()
          .describe('Answers the user does not know ("vet ikke"): the industry value, with twice the "uncertain" swing. Omitted: the stored list, without keys answered in this call.'),
        confirmReplace: z.boolean().optional().describe('true: replace groups and cost lines that were changed by hand (quick.edited). Only after the user said yes.'),
      },
      annotations: { title: 'Quick setup of the company model', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    (args) => run((blob) => setupCompanyQuick(blob, args)),
  );

  server.registerTool(
    'calibrate_company_from_accounts',
    {
      title: 'Fit the company model to the public accounts',
      description:
        'The accounts card\'s "Gjør modellen lik regnskapet" on the employer-cost page: mark salary and typicalBillablePct as uncertain '
        + '(a dontKnow stays dontKnow), then move these two guesses so the model gives the revenue and '
        + 'operating result in the company\'s public annual accounts (Brønnøysund). Only two answers move: '
        + 'typicalBillablePct (fitted to revenue less the resold-subcontractor share quick.answers.resaleSharePct) and the consultants\' mean salary '
        + '(salaryLow and salaryHigh move together, fitted to the operating result). A fitted dontKnow answer becomes uncertain. '
        + 'The result is an estimate from the accounts ("anslått fra regnskapet"), not a proof: two unknowns fitted to two numbers always match. '
        + 'Without orgnr it uses the accounts stored on the model (get_company_model model.accounts). With orgnr it fetches the newest accounts '
        + 'through the app (cached 24 h) and stores them with the fit. The org number names the user\'s employer: pass it only when the user gave it. '
        + 'It stores model.accounts.fittedAt and fitMoves; a later change of the answers or groups drops them, and get_company_model then says basis: guesses. '
        + 'Refuses, saving nothing, when there is no quick setup, the model was edited by hand, the accounts are not in NOK, '
        + 'or there is no solution. Check model.accounts in get_company_model for the year, type (KONSERN = group accounts) and employees (persons, not FTE). '
        + 'One undoable write that touches only companyModel.',
      inputSchema: {
        orgnr: z.string().regex(/^\d{9}$/).optional().describe('9-digit organisation number to fetch the accounts for. Omitted: the stored accounts.'),
      },
      annotations: { title: 'Fit the company model to the public accounts', ...readWrite, destructiveHint: true, idempotentHint: true },
    },
    async ({ orgnr }) => {
      let accounts: CompanyAccounts | undefined;
      if (orgnr !== undefined) {
        if (!isValidOrgnr(orgnr)) return errorResult('orgnr is not a valid organisation number (9 digits with the mod-11 check digit)');
        try {
          const lookup = await getBrreg(orgnr);
          if (lookup.kind === 'notFound') return errorResult('Brønnøysund does not know this organisation number');
          if (lookup.kind === 'invalid') return errorResult('orgnr is not a valid organisation number');
          if (lookup.kind === 'noAccounts') {
            return errorResult('no filed annual accounts for this organisation number: sole proprietorships (ENK) file none, and a new company has not filed yet');
          }
          if (lookup.kind === 'unavailable') return errorResult('Brønnøysund could not be reached and nothing is cached; try again later');
          accounts = lookup.accounts;
        } catch (e) {
          return errorResult(String((e as Error).message));
        }
      }
      return run((blob) => calibrateCompanyFromAccounts(blob, { ctx: companyContext(blob), accounts }));
    },
  );

  server.registerTool(
    'restore_revision',
    {
      title: 'Restore a past revision',
      description:
        'Roll the WHOLE dataset back to a past revision (rev from list_history), discarding everything saved after it. Prefer undo_change to revert one change. The restore is itself saved as a new revision, so it can be undone.',
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

  server.registerTool(
    'undo_change',
    {
      title: 'Undo one change',
      description:
        'Revert only what one revision changed (rev from a write result or list_history), keeping everything saved after it, including the user\'s own edits and bank syncs. Refuses with the conflicting fields if any of them changed again since; then undo the later revisions first, or use restore_revision. The undo is itself a revision and can be undone.',
      inputSchema: { rev: z.number().int().describe('Revision to undo.') },
      annotations: { title: 'Undo one change', ...readWrite, destructiveHint: true, idempotentHint: false },
    },
    async ({ rev }) => {
      try {
        const out = await undoRevision(rev);
        return jsonResult({ ok: true, ...out });
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );
}
