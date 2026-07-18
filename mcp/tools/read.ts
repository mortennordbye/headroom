// Tier 1: read/insight tools. Each pulls the whole blob once, runs a derivation
// (mcp/derive.ts, which reuses src/lib), and returns structured JSON.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getData, listHistory, getHistoryRevision } from '../client';
import { jsonResult, errorResult } from '../util';
import * as derive from '../derive';

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function registerReadTools(server: McpServer) {
  server.registerTool(
    'get_overview',
    {
      title: 'Financial overview',
      description:
        'Net worth, gross annual income, equity breakdown, debt-to-income, and mortgage status.',
      inputSchema: {},
      annotations: { title: 'Financial overview', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.overview(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_budget_summary',
    {
      title: 'Budget summary',
      description:
        'Monthly income vs fixed/variable expenses, per-type fixed totals, last-12-month cashflow, and savings-rate status vs target.',
      inputSchema: {},
      annotations: { title: 'Budget summary', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.budgetSummary(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_spending_analysis',
    {
      title: 'Spending analysis',
      description:
        'Spend by category for the current month, month-over-month deltas, budget-vs-actual, the top spending insight, and untracked recurring merchants.',
      inputSchema: {},
      annotations: { title: 'Spending analysis', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.spendingAnalysis(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_debt_analysis',
    {
      title: 'Debt payoff analysis',
      description:
        'Non-mortgage debt payoff plan (avalanche or snowball), baseline vs an optional extra monthly payment, with months and interest saved.',
      inputSchema: {
        extraMonthly: z
          .number()
          .min(0)
          .optional()
          .describe('Extra kr/month above the minimums to throw at the debts (default 0).'),
        strategy: z
          .enum(['avalanche', 'snowball'])
          .optional()
          .describe('avalanche = highest rate first (default); snowball = smallest balance first.'),
      },
      annotations: { title: 'Debt payoff analysis', ...readOnly },
    },
    async ({ extraMonthly, strategy }) => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.debtAnalysis(blob, extraMonthly ?? 0, strategy ?? 'avalanche'));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_savings_and_goals',
    {
      title: 'Savings & goals',
      description:
        'Emergency-fund adequacy (both the total-fixed and essential-runway measures), buffer recommendation, and per-goal progress with pace/required-monthly.',
      inputSchema: {},
      annotations: { title: 'Savings & goals', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.savingsAndGoals(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_recommendations',
    {
      title: 'Recommendations',
      description:
        'Budget plan (recommended spend vs invest, conservative-mode flag), savings-rate status, and history-based insights (mortgage/debt ahead-of-plan, equity change).',
      inputSchema: {},
      annotations: { title: 'Recommendations', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.recommendations(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_year_review',
    {
      title: 'Annual review',
      description:
        'Consolidated year-in-review for a calendar year: total income, tax paid, savings rate, top spending categories, and net-worth change. Own-account transfers are netted out and the year is capped at the current month. Omit `year` for the most recent year with data; `availableYears` lists the choices.',
      inputSchema: {
        year: z
          .number()
          .int()
          .optional()
          .describe('Calendar year, e.g. 2025. Defaults to the most recent year with data.'),
      },
      annotations: { title: 'Annual review', ...readOnly },
    },
    async ({ year }) => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.yearReviewSummary(blob, year));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'what_if',
    {
      title: 'What-if scenario',
      description:
        'Run a financial scenario. mode="prepay_vs_invest": compare paying extra on the mortgage vs investing it (after-tax). mode="extra_debt_payment": months/interest saved by paying extra on one debt (needs debtId).',
      inputSchema: {
        mode: z.enum(['prepay_vs_invest', 'extra_debt_payment']),
        extraMonthly: z.number().min(0).describe('Extra kr/month to apply in the scenario.'),
        years: z
          .number()
          .min(1)
          .optional()
          .describe('Horizon in years for prepay_vs_invest (default 15).'),
        investReturnPct: z
          .number()
          .optional()
          .describe('Expected annual investment return %; defaults to the app growth assumption.'),
        debtId: z
          .string()
          .optional()
          .describe('For extra_debt_payment: the id of the debt (see get_debt_analysis).'),
      },
      annotations: { title: 'What-if scenario', ...readOnly },
    },
    async ({ mode, extraMonthly, years, investReturnPct, debtId }) => {
      try {
        const { blob } = await getData();
        if (mode === 'prepay_vs_invest') {
          return jsonResult(
            derive.whatIfPrepayVsInvest(blob, extraMonthly, years ?? 15, investReturnPct),
          );
        }
        if (!debtId) return errorResult('extra_debt_payment requires debtId');
        return jsonResult(derive.whatIfExtraDebtPayment(blob, debtId, extraMonthly));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'list_history',
    {
      title: 'List saved revisions',
      description:
        'Recent saved revisions of the whole dataset (newest first) with timestamps and sizes. Use a rev with get_history_revision or restore_revision.',
      inputSchema: {},
      annotations: { title: 'List saved revisions', ...readOnly },
    },
    async () => {
      try {
        return jsonResult(await listHistory());
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_history_revision',
    {
      title: 'Get a past revision',
      description:
        'The full dataset as it was at a past revision (rev from list_history). Use it to see or explain what changed.',
      inputSchema: { rev: z.number().int().describe('Revision number from list_history.') },
      annotations: { title: 'Get a past revision', ...readOnly },
    },
    async ({ rev }) => {
      try {
        return jsonResult(await getHistoryRevision(rev));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_raw_data',
    {
      title: 'Raw finance data',
      description:
        'The complete persisted app-state blob (ExportPayload). Escape hatch for anything the curated tools do not cover; reason over it directly.',
      inputSchema: {},
      annotations: { title: 'Raw finance data', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(blob);
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );
}
