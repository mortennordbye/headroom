// Tier 1: read/insight tools. Each pulls the whole blob once, runs a derivation
// (mcp/derive.ts, which reuses src/lib), and returns structured JSON.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getData, listHistory, getHistoryRevision } from '../client';
import { jsonResult, errorResult } from '../util';
import * as derive from '../derive';

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);

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
        'Monthly net income vs fixed/variable expenses, per-type fixed totals, this month\'s savings transfers (and any one-month adjustment), last-12-month cashflow, and savings-rate status vs target.',
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
    'get_salary_and_tax',
    {
      title: 'Salary & tax',
      description:
        'Active jobs, gross annual, the full income-tax breakdown (with IPS, mortgage-interest and BSU deductions), marginal rate, derived vs effective net monthly income, the month\'s payslip, a restskatt (back-tax) estimate from this year\'s payslips, and salary/bonus/overtime history.',
      inputSchema: { month: yearMonth.optional().describe("'YYYY-MM'; defaults to the current month.") },
      annotations: { title: 'Salary & tax', ...readOnly },
    },
    async ({ month }) => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.salaryAndTax(blob, month));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_pension',
    {
      title: 'Pension',
      description:
        'OTP/IPS balances and contributions, year-by-year projection to retirement, and estimated retirement income (folketrygd, AFP, OTP, IPS) gross and after tax, with the replacement rate vs today\'s net salary.',
      inputSchema: {},
      annotations: { title: 'Pension', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.pensionSummary(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_forecast',
    {
      title: 'Net-worth forecast',
      description:
        'Year-by-year projection of gross, net, savings, net worth (nominal and real), mortgage and wealth tax, plus recorded net-worth history. Each lever defaults to the user\'s saved forecast assumption, else the app\'s data-driven seed; pass a lever to run a what-if.',
      inputSchema: {
        years: z.number().int().min(1).max(60).optional(),
        raisePct: z.number().optional().describe('Annual salary growth %.'),
        savingsPct: z.number().min(0).max(100).optional().describe('Share of net income saved, %.'),
        returnPct: z.number().optional().describe('Annual investment return %.'),
        inflationPct: z.number().optional().describe('Annual inflation %; defaults to 3 (live CPI is not available here).'),
      },
      annotations: { title: 'Net-worth forecast', ...readOnly },
    },
    async (overrides) => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.forecast(blob, overrides));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_mortgage',
    {
      title: 'Mortgage',
      description:
        'The active mortgage: balance, rate, term, monthly payment, payoff timeline, loan-to-value, purchase-vs-value metrics, actual paydown vs plan, remaining interest and the yearly amortization schedule.',
      inputSchema: {},
      annotations: { title: 'Mortgage', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.mortgage(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_housing',
    {
      title: 'Housing & borrowing capacity',
      description:
        'Borrowing capacity (5x income and 15% equity rules, stress test) from live data with the user\'s manual overrides, the planned purchase, and second-home / rental scenarios with their portfolio aggregate.',
      inputSchema: {},
      annotations: { title: 'Housing & borrowing capacity', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.housing(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_employer_cost',
    {
      title: 'Employer cost & billing',
      description:
        'What the user costs their employer (salary, holiday pay, employer tax, pension, overhead), break-even and target hourly rates, the billed rate\'s margin, and the fair salary at the target margin. Follows the solve-for mode saved on the page.',
      inputSchema: {},
      annotations: { title: 'Employer cost & billing', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.employerCost(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'get_assets_and_debts',
    {
      title: 'Assets & debts',
      description:
        'Every balance with its id: assets (incl. savings accounts), equity breakdown, debts, mortgage/loan settings, savings transfers, fixed expenses, the wealth-tax estimate and the last 12 snapshots\' net worth. Use the ids with the write tools.',
      inputSchema: {},
      annotations: { title: 'Assets & debts', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.assetsAndDebts(blob));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  server.registerTool(
    'query_transactions',
    {
      title: 'Query transactions',
      description:
        'Search transactions, newest first. All filters are optional and combine. Totals and per-category sums cover every match, not just the returned rows. Own-account transfers are excluded unless excludeTransfers=false.',
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional().describe("Inclusive start, 'YYYY-MM' or 'YYYY-MM-DD'."),
        to: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional().describe("Inclusive end, 'YYYY-MM' or 'YYYY-MM-DD'."),
        category: z.string().optional().describe('Category key, e.g. groceries, dining.'),
        text: z.string().optional().describe('Case-insensitive match on description or merchant.'),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
        kind: z.enum(['income', 'expense']).optional(),
        excludeTransfers: z.boolean().optional().describe('Default true.'),
        limit: z.number().int().min(1).max(1000).optional().describe('Rows to return (default 100).'),
      },
      annotations: { title: 'Query transactions', ...readOnly },
    },
    async (q) => {
      try {
        const { blob } = await getData();
        return jsonResult(derive.queryTransactions(blob, q));
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
