// Blob -> insight glue. Reproduces how the app's pages/context derive the inputs
// the pure src/lib functions expect, so MCP numbers match what the UI shows.
// Each derivation notes the app call-site it mirrors.
//
// Only pure src/lib modules are imported here (never FinanceContext.tsx, which
// pulls in React); calcActiveGrossAnnual is reimplemented below for that reason.

import type {
  ExportPayload,
  Assets,
  Goal,
  SalaryEntry,
  JobEntry,
} from '../src/context/FinanceContext';
import { computeEquityBreakdown, sumSavings } from '../src/lib/equity';
import { ageFromBirthDate } from '../src/lib/date';
import {
  calcDebtToIncome,
  calcEmergencyFundStatus,
  bufferRecommendation,
  calcRecommendations,
  calcHomeownerMortgageStatus,
} from '../src/lib/calculations';
import { planPayoff, extraPaymentSavings, sumDebtByType, lendingDebtTotal, type PayoffStrategy } from '../src/lib/debt';
import { essentialMonthlyExpenses, fixedExpenseTotalsByType } from '../src/lib/fixedExpenseTotals';
import { monthlyCashflow } from '../src/lib/monthlyCashflow';
import { savingsRateStatus } from '../src/lib/savingsRate';
import { spendByCategory, categoryMoM, budgetProgress } from '../src/lib/categoryStats';
import { topSpendInsight } from '../src/lib/insights';
import { detectRecurring } from '../src/lib/recurring';
import { prepayVsInvest } from '../src/lib/prepayVsInvest';
import { computeHistoryInsights } from '../src/lib/historyInsights';
import { goalPace } from '../src/lib/goalPace';
import { salaryAt } from '../src/lib/salary';
import { currentMonthKey, lastNMonthKeys, addMonthsKey } from '../src/lib/date';

// ---- shared helpers -------------------------------------------------------

const monthIndex = (key: string): number => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

/** Anchor `Date` for lastNMonthKeys, built from a 'YYYY-MM' key (no clock use in tests). */
function monthAnchor(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 15);
}

// ---- core scalars ---------------------------------------------------------

/**
 * Gross annual income. Mirrors FinanceContext.tsx:1608 and its reimplemented
 * calcActiveGrossAnnual (originally FinanceContext.tsx:332): sum active jobs'
 * latest salary + on-call, else fall back to monthly-net `income` * 12.
 */
export function grossAnnualIncome(blob: ExportPayload, monthKey: string): number {
  const salaries: SalaryEntry[] = blob.salaries ?? [];
  const jobs: JobEntry[] = blob.jobs ?? [];
  let fromSalaries = 0;
  for (const jobId of new Set(salaries.map((s) => s.jobId))) {
    const sal = salaryAt(monthKey, salaries.filter((s) => s.jobId === jobId));
    if (!sal) continue;
    const job = jobs.find((j) => j.id === jobId);
    if (job?.endDate && job.endDate < monthKey) continue;
    fromSalaries += sal.grossAnnual + (job?.onCallAnnual ?? 0);
  }
  if (fromSalaries > 0) return fromSalaries;
  return (blob.income ?? 0) * 12; // known approximation: monthly-net annualised
}

/** Total non-mortgage debt. Mirrors FinanceContext.tsx:1834. */
export function totalNonMortgageDebt(blob: ExportPayload): number {
  return (blob.debts ?? []).reduce((s, d) => s + Math.max(0, d.balance), 0);
}

/** Net worth. Mirrors FinanceContext.tsx:1831-1835. */
export function netWorth(blob: ExportPayload): number {
  const { totalEquity } = computeEquityBreakdown(blob.assets);
  return totalEquity - totalNonMortgageDebt(blob);
}

/** Sum of all fixed-expense lines. Mirrors FinanceContext.tsx:1568. */
export function totalFixedExpenses(blob: ExportPayload): number {
  return (blob.fixedExpenses ?? []).reduce((s, e) => s + e.amount, 0);
}

// ---- tool payloads --------------------------------------------------------

export function overview(blob: ExportPayload, monthKey = currentMonthKey()) {
  const gross = grossAnnualIncome(blob, monthKey);
  const nonMortgageDebt = totalNonMortgageDebt(blob);
  const breakdown = computeEquityBreakdown(blob.assets);
  // DTI includes the mortgage and counts revolving lines at their full credit
  // frame (capacityDebt), mirroring DashboardPage.tsx.
  const dti = calcDebtToIncome(blob.assets.houseDebt + lendingDebtTotal(blob.debts ?? []), gross);
  const hasMortgage = blob.assets.houseDebt > 0;
  const mortgage = hasMortgage
    ? calcHomeownerMortgageStatus(
        blob.homeowner?.currentMortgageBalance ?? blob.assets.houseDebt,
        blob.homeowner?.originalLoanAmount ?? blob.assets.houseDebt,
        blob.homeowner?.rente ?? blob.loan?.rente ?? 0,
        blob.homeowner?.nedbetalingstid ?? blob.loan?.nedbetalingstid ?? 0,
        blob.homeowner?.skattefradragssats ?? 22,
      )
    : null;
  const currentJob = (blob.jobs ?? []).find((j) => !j.endDate);
  return {
    monthKey,
    // Optional user profile — identity context the user set in Settings. `currentJob`
    // is derived from the active (open-ended) job, not stored on the profile.
    profile: {
      name: blob.profile?.name || '',
      age: ageFromBirthDate(blob.profile?.birthDate),
      currentJob: currentJob ? [currentJob.role, currentJob.employer].filter(Boolean).join(' · ') : '',
    },
    // Free-text context the user keeps about their plans / long-term goals. Read
    // it before advising; use set_ai_context to record new context.
    notes: blob.aiContext ?? '',
    // The user's savings goals with live progress (see get_savings_and_goals for detail).
    goals: (blob.goals ?? []).map((g) => ({
      name: g.name,
      target: g.target,
      deadline: g.deadline ?? null,
      progressPct: g.target > 0 ? Math.round((goalCurrentValue(g, blob.assets) / g.target) * 100) : 0,
    })),
    netWorth: Math.round(netWorth(blob)),
    grossAnnualIncome: Math.round(gross),
    monthlyNetIncome: blob.income ?? 0,
    equityBreakdown: breakdown,
    debt: {
      nonMortgage: Math.round(nonMortgageDebt),
      mortgage: Math.round(blob.assets.houseDebt),
      studentLoan: Math.round(sumDebtByType(blob.debts ?? [], 'student')),
      debtToIncome: dti,
    },
    mortgage,
  };
}

export function budgetSummary(blob: ExportPayload, monthKey = currentMonthKey()) {
  const fixedTotal = totalFixedExpenses(blob);
  const months = lastNMonthKeys(monthAnchor(monthKey), 12);
  const region = blob.region ?? 'no';
  const seasonal =
    region === 'no'
      ? {
          grossAnnual: grossAnnualIncome(blob, monthKey),
          feriepengesatsPct: blob.employerCostConfig?.feriepengesatsPct ?? 12,
        }
      : null;
  const fallbackIncome = Math.round(blob.monthlyIncomes?.[monthKey] ?? blob.income ?? 0);
  const rows = monthlyCashflow(
    months,
    blob.dailyTransactions ?? [],
    blob.monthlyIncomes ?? {},
    fallbackIncome,
    fixedTotal,
    seasonal,
  );
  const savingsTarget = blob.savingsTargetPercent ?? 20;
  return {
    monthKey,
    monthlyNetIncome: fallbackIncome,
    totalFixedExpenses: Math.round(fixedTotal),
    essentialMonthlyExpenses: Math.round(essentialMonthlyExpenses(blob.fixedExpenses ?? [])),
    fixedByType: fixedExpenseTotalsByType(blob.fixedExpenses ?? []),
    savingsTargetPercent: savingsTarget,
    savingsRate: savingsRateStatus(rows, savingsTarget),
    cashflowLast12: rows,
  };
}

export function spendingAnalysis(blob: ExportPayload, monthKey = currentMonthKey()) {
  const txs = blob.dailyTransactions ?? [];
  const prior6 = lastNMonthKeys(monthAnchor(addMonthsKey(monthKey, -1)), 6);
  return {
    monthKey,
    // Excludes kind === 'income' only, matching the app's spend charts. Internal
    // transfers are NOT rule-filtered here (the app does that upstream via
    // transferRules); treat category totals as gross of own-account transfers.
    byCategory: spendByCategory(txs, monthKey),
    monthOverMonth: categoryMoM(txs, monthKey, addMonthsKey(monthKey, -1)),
    budgetProgress: budgetProgress(txs, monthKey, blob.categoryBudgets ?? {}),
    headline: topSpendInsight(txs, monthKey, prior6),
    recurringUntracked: detectRecurring(txs, blob.fixedExpenses ?? [], monthKey),
  };
}

export function debtAnalysis(
  blob: ExportPayload,
  extraMonthly = 0,
  strategy: PayoffStrategy = 'avalanche',
  monthKey = currentMonthKey(),
) {
  const debts = blob.debts ?? [];
  const baseline = planPayoff(debts, 0, strategy, monthKey);
  const withExtra = planPayoff(debts, extraMonthly, strategy, monthKey);
  return {
    monthKey,
    strategy,
    extraMonthly,
    totalBalance: Math.round(totalNonMortgageDebt(blob)),
    baseline,
    withExtra,
    monthsSaved: baseline.feasible && withExtra.feasible ? baseline.months - withExtra.months : 0,
    interestSaved:
      baseline.feasible && withExtra.feasible
        ? Math.round(baseline.totalInterest - withExtra.totalInterest)
        : 0,
  };
}

function goalCurrentValue(goal: Goal, assets: Assets): number {
  switch (goal.source) {
    case 'manual':
      return goal.manualCurrent ?? 0;
    case 'bsu':
      return assets.bsu ?? 0;
    case 'bufferAccount':
      return assets.bufferAccount ?? 0;
    case 'portfolio':
      return assets.portfolio ?? 0;
    case 'savings':
      return sumSavings(assets);
    case 'savingsAccount':
      return (assets.savingsAccounts ?? []).find((a) => a.id === goal.savingsAccountId)?.balance ?? 0;
    case 'totalEquity':
      return computeEquityBreakdown(assets).totalEquity;
    default:
      return 0;
  }
}

export function savingsAndGoals(blob: ExportPayload, monthKey = currentMonthKey()) {
  const buffer = blob.assets.bufferAccount ?? 0;
  const fixedTotal = totalFixedExpenses(blob);
  const essential = essentialMonthlyExpenses(blob.fixedExpenses ?? []);
  // Two app call-sites use different denominators; expose both (see derivation report).
  const efDashboard = calcEmergencyFundStatus(buffer, fixedTotal); // DashboardPage.tsx:131
  const efRunway = calcEmergencyFundStatus(buffer, essential); // EmergencyFundGauge.tsx:22

  // Real monthly pace for net-worth-linked goals, from recorded history.
  const nwSeries = Object.entries(blob.netWorthHistory ?? {}).map(([m, v]) => ({
    monthKey: m,
    value: v,
  }));

  const goals = (blob.goals ?? []).map((g) => {
    const current = goalCurrentValue(g, blob.assets);
    const remaining = Math.max(0, g.target - current);
    const deadlineMonths =
      g.deadline && g.deadline >= monthKey ? monthIndex(g.deadline) - monthIndex(monthKey) : null;
    const series = g.source === 'totalEquity' ? nwSeries : [];
    const pace = goalPace(series, remaining, deadlineMonths);
    return {
      id: g.id,
      name: g.name,
      source: g.source,
      target: g.target,
      current: Math.round(current),
      remaining: Math.round(remaining),
      progressPct: g.target > 0 ? Math.round((current / g.target) * 100) : 0,
      deadline: g.deadline ?? null,
      pace,
    };
  });

  return {
    monthKey,
    bufferAccount: Math.round(buffer),
    emergencyFund: {
      vsTotalFixed: { ...efDashboard, recommendation: bufferRecommendation(efDashboard) },
      vsEssentialRunway: efRunway,
    },
    goals,
  };
}

export function recommendations(blob: ExportPayload, monthKey = currentMonthKey()) {
  const fixedTotal = totalFixedExpenses(blob);
  const months = lastNMonthKeys(monthAnchor(monthKey), 12);
  const rows = monthlyCashflow(
    months,
    blob.dailyTransactions ?? [],
    blob.monthlyIncomes ?? {},
    Math.round(blob.income ?? 0),
    fixedTotal,
  );
  const incomes = rows.map((r) => r.income).filter((x) => x > 0);
  const averageIncome = incomes.length ? incomes.reduce((s, x) => s + x, 0) / incomes.length : 0;
  const mean = averageIncome;
  const variance = incomes.length
    ? incomes.reduce((s, x) => s + (x - mean) ** 2, 0) / incomes.length
    : 0;
  const volatility = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const effectiveIncome = Math.round(blob.monthlyIncomes?.[monthKey] ?? blob.income ?? 0);
  const savingsTarget = blob.savingsTargetPercent ?? 20;

  return {
    monthKey,
    budgetPlan: calcRecommendations(effectiveIncome, averageIncome, fixedTotal, volatility, savingsTarget),
    savingsRate: savingsRateStatus(rows, savingsTarget),
    history: computeHistoryInsights(
      blob.balanceSnapshots ?? {},
      blob.netWorthHistory ?? {},
      netWorth(blob),
      monthKey,
    ),
  };
}

// ---- what-if scenarios ----------------------------------------------------

export function whatIfPrepayVsInvest(
  blob: ExportPayload,
  extraMonthly: number,
  years: number,
  investReturnPct?: number,
) {
  const mortgageRate = blob.homeowner?.rente ?? blob.loan?.rente ?? 0;
  const returnPct = investReturnPct ?? blob.growthReturnRate ?? 7;
  const deduction = blob.homeowner?.skattefradragssats ?? 22;
  return prepayVsInvest(extraMonthly, mortgageRate, returnPct, years, deduction, blob.assets.taxRate ?? 0);
}

export function whatIfExtraDebtPayment(
  blob: ExportPayload,
  debtId: string,
  extraMonthly: number,
) {
  const debt = (blob.debts ?? []).find((d) => d.id === debtId);
  if (!debt) throw new Error(`no debt with id "${debtId}"`);
  const basePayment = debt.minPayment;
  return {
    debt: { id: debt.id, name: debt.name, balance: debt.balance, rate: debt.rate },
    ...extraPaymentSavings(debt.balance, debt.rate, basePayment, extraMonthly),
  };
}
