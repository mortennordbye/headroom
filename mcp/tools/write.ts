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
} from '../mutations';

const readWrite = { readOnlyHint: false, openWorldHint: false } as const;
const categoryEnum = z.enum(CATEGORY_KEYS as unknown as [CategoryKey, ...CategoryKey[]]);
const sourceEnum = z.enum(GOAL_SOURCES as unknown as [GoalSource, ...GoalSource[]]);
const typeEnum = z.enum(EXPENSE_TYPES as unknown as [ExpenseType, ...ExpenseType[]]);
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);

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
      description: 'Change the name/amount/type of an existing fixed expense (id from get_raw_data). Only provided fields change.',
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        amount: z.number().min(0).optional(),
        type: typeEnum.optional(),
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
