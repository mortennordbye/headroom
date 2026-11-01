// Tier 1: read/insight tools. Each pulls the whole blob once, runs a derivation
// (mcp/derive.ts, which reuses src/lib), and returns structured JSON.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getData, listHistory, getHistoryRevision, getInflation } from '../client';
import { latestInflationPct, DEFAULT_INFLATION_PCT } from '../../src/lib/inflation';
import { jsonResult, errorResult } from '../util';
import * as derive from '../derive';
import { CATEGORY_KEYS } from '../../src/lib/categories';

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthOrDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/);

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
        'Monthly net income vs fixed/variable expenses, per-type fixed totals, this month\'s savings transfers (and any one-month adjustment), last-12-month cashflow (each row reports savings transfers as `saved`, apart from `expenses`; net = income - expenses - saved), and plan-based savings-rate health. savingsRate.trailingRate is a share of income: compare it with savingsRateTargetOfIncomePct, not savingsTargetPercent (which is a share of what is left after expenses).',
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
        'Budget plan (recommended spend vs invest, conservative-mode flag), plannedMonthlySaving (automated transfers, the allocation plan loan paydowns as planLoanPaydown, plus the unallocated target), savings-rate health vs savingsRateTargetOfIncomePct, and history-based insights (mortgage/debt ahead-of-plan, equity change).',
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
          .describe('Horizon in years for prepay_vs_invest; defaults to the saved Forecast horizon (else 15).'),
        investReturnPct: z
          .number()
          .optional()
          .describe('Expected annual investment return %; defaults to the saved Forecast return (else the app growth assumption).'),
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
            derive.whatIfPrepayVsInvest(blob, extraMonthly, years, investReturnPct),
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
        'OTP/IPS balances and contributions, year-by-year projection to retirement, and estimated retirement income (folketrygd, AFP, OTP, IPS) gross and after tax, with the replacement rate vs today\'s net salary. All retirement income (retirementIncomeAnnual, netPensionMonthly, replacementRatePct) is in today\'s kroner, as the Pension page shows it: OTP/IPS payouts are discounted by the current CPI rate, folketrygd and AFP are at today\'s G. inTodaysKroner repeats the same figures. Balances and the projection are nominal.',
      inputSchema: {},
      annotations: { title: 'Pension', ...readOnly },
    },
    async () => {
      try {
        const { blob } = await getData();
        // Same CPI rate the app uses; it only loads CPI for Norway, else the default.
        const inflationPct = (blob.region ?? 'no') === 'no' ? latestInflationPct(await getInflation()) : DEFAULT_INFLATION_PCT;
        return jsonResult(derive.pensionSummary(blob, undefined, inflationPct));
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
        raisePct: z.number().min(-20).max(30).optional().describe('Annual salary growth %.'),
        savingsPct: z.number().min(0).max(100).optional().describe('Share of net income saved, %.'),
        returnPct: z.number().min(-20).max(30).optional().describe('Annual investment return %.'),
        inflationPct: z.number().min(-5).max(20).optional().describe('Annual inflation %; defaults to 3 (live CPI is not available here).'),
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
        'The mortgage the housing mode follows: loanKind "current" is a homeowner\'s real mortgage, "planned" is the loan being planned for a purchase (first-buyer / transitioning). Balance, rate, term, monthly payment, remaining interest and yearly amortization; for homeowners also payoff timeline, loan-to-value and purchase-vs-value metrics. Includes actual paydown vs plan from recorded snapshots. When transitioning, `current` is the loan still owed on the home being sold (balance, rate, remaining term, payment) and `planned` the purchase loan; both are null in the other modes.',
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
        'Borrowing capacity for a purchase, as the Bolig page\'s calculator computes it (5x income and 15% equity rules, stress test, the planned loan\'s rate and term), from live data with the user\'s manual overrides. Existing debt here is non-mortgage debt only: it sizes a purchase that replaces the current home. For room to borrow on top of the current mortgage, use get_overview debt.debtToIncome.borrowingHeadroom. Also the planned purchase and second-home / rental scenarios with their portfolio aggregate.',
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
        'Every balance with its id: assets (incl. savings accounts), equity breakdown, debts, mortgage/loan settings, savings transfers, fixed expenses, BSU room against the annual and lifetime caps (lifetimeBasis says whether it counts entered deposits or falls back to the balance), the wealth-tax estimate and the last 12 snapshots\' net worth. Use the debt, savings-account and fixed-expense ids with the matching write tools.',
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
        'Search transactions, newest first. All filters are optional and combine. Amounts are positive; direction is `kind` (rows categorised income count as income). Totals and per-category sums cover every match, not just the returned rows. Own-account transfers are excluded unless excludeTransfers=false.',
      inputSchema: {
        from: monthOrDay.optional().describe("Inclusive start, 'YYYY-MM' or 'YYYY-MM-DD'."),
        to: monthOrDay.optional().describe("Inclusive end, 'YYYY-MM' or 'YYYY-MM-DD'."),
        category: z.enum(CATEGORY_KEYS as [string, ...string[]]).optional(),
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
        'Saved revisions of the whole dataset (newest first, kept 90 days): timestamp, size, who made it (source: ui, mcp, import, bank-sync, restore, undo), a label, and the top-level keys it changed. Use a rev with get_history_revision, undo_change (revert one change) or restore_revision (roll everything back).',
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
