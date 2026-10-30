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
  DailyTransaction,
  Pension,
} from '../src/context/FinanceContext';
import { computeEquityBreakdown, sumSavings } from '../src/lib/equity';
import { activeCoOwners, myHouseDebt, myHouseValue, myPrimaryHomeWealthValue, ownershipShares } from '../src/lib/ownership';
import { ageFromBirthDate } from '../src/lib/date';
import {
  calcDebtToIncome,
  calcEmergencyFundStatus,
  bufferRecommendation,
  calcRecommendations,
  calcHomeownerMortgageStatus,
  calcAmortizationSchedule,
  calcBorrowingCapacity,
  calcMonthlyPayment,
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
import { activeJobBreakdown } from '../src/lib/salary';
import { isSpend } from '../src/lib/spend';
import { excludedTransferIds } from '../src/lib/transferRules';
import { withoutOneOffs } from '../src/lib/segments';
import { yearReview, availableReportYears } from '../src/lib/yearReview';
import { currentMonthKey, lastNMonthKeys, addMonthsKey, monthsBetween, yearOf } from '../src/lib/date';
import { effectiveRemainingMonths, paymentTermMonths, splitTermMonths, termMonthsFromYears } from '../src/lib/loanTerm';
import {
  calcTaxByRegion,
  calcMarginalTaxRate,
  calcPensionIncomeTax,
  calcWealthTax,
  IPS_MAX_DEDUCTION,
  RENTEFRADRAG_RATE_PCT,
  TAX_YEAR,
} from '../src/lib/norwegianTax';
import { restskattEstimate } from '../src/lib/restskatt';
import { cardNetForMonth } from '../src/lib/forskuddstrekk';
import { feriepengerSurplus } from '../src/lib/feriepenger';
import { projectPensionWealth } from '../src/lib/pension';
import { inTodaysKroner, DEFAULT_INFLATION_PCT } from '../src/lib/inflation';
import { estimateBeholdning, projectBeholdning, annualFolketrygdPension } from '../src/lib/folketrygd';
import { estimateAfpGrunnlag, annualAfp } from '../src/lib/afp';
import { projectForecast } from '../src/lib/forecastProjection';
import { netWorthFromSnapshot } from '../src/lib/netWorth';
import { paydownVsPlan } from '../src/lib/paydown';
import { currentResidence, residenceMetrics, loanTimeline } from '../src/lib/property';
import { summarizeScenario, calcPortfolio } from '../src/lib/secondHome';
import {
  calcEmployerCost,
  calcBillableHours,
  calcBillingRate,
  calcBilledRate,
  calcFairGross,
  DEFAULT_EMPLOYER_COST_CONFIG,
  FERIEPENGER_DEFAULT_PCT,
  DEFAULT_BILLING_CONFIG,
} from '../src/lib/employerCost';
import { calcBsuTaxCredit } from '../src/lib/bsu';
import {
  savingsBase,
  resolveSavingsAmounts,
  resolveSavingsForMonth,
  savingsContributionTotal,
  targetRateOfIncome,
  planSavingsRateSeries,
} from '../src/lib/savingsRate';

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

/** Gross annual from the salary system alone (0 when none). Mirrors calcActiveGrossAnnual. */
export function activeGrossAnnual(blob: ExportPayload, monthKey: string): number {
  return activeJobBreakdown(blob.salaries ?? [], blob.jobs ?? [], monthKey).reduce((s, c) => s + c.gross, 0);
}

/**
 * Gross annual income. Mirrors FinanceContext `grossAnnualIncome`: active jobs'
 * salary + on-call, else the monthly-net `income` * 12.
 */
export function grossAnnualIncome(blob: ExportPayload, monthKey: string): number {
  const fromSalaries = activeGrossAnnual(blob, monthKey);
  if (fromSalaries > 0) return fromSalaries;
  return (blob.income ?? 0) * 12; // known approximation: monthly-net annualised
}

/** Year-one mortgage interest for the active housing mode. Mirrors FinanceContext `annualMortgageInterest`. */
export function annualMortgageInterest(blob: ExportPayload): number {
  const homeowner = (blob.housingMode ?? 'first_buyer') === 'homeowner';
  const balance = homeowner ? blob.homeowner?.currentMortgageBalance : blob.loan?.laanebelop;
  const rate = homeowner ? blob.homeowner?.rente : blob.loan?.rente;
  const term = homeowner ? paymentTermMonths(blob.homeowner) / 12 : blob.loan?.nedbetalingstid;
  if (!(balance! > 0) || !(rate! > 0) || !(term! > 0)) return 0;
  const interest = calcAmortizationSchedule(balance!, rate!, term!)[0]?.interestPaid ?? 0;
  // Rentefradrag follows the user's share of a joint loan (homeowner only).
  return homeowner ? interest * ownershipShares(blob.assets).debt : interest;
}

/** BSU tax credit for the year. Mirrors the credit inside FinanceContext `derivedNetMonthlyFor`. */
function bsuCredit(blob: ExportPayload): number {
  const birthYear = blob.pension?.birthYear ?? 0;
  return calcBsuTaxCredit(blob.assets.bsuAnnualContribution ?? 0, {
    age: birthYear > 1900 ? new Date().getFullYear() - birthYear : -1,
    ownsHome: (blob.housingMode ?? 'first_buyer') !== 'first_buyer',
  });
}

/** Income tax on a gross annual, with every deduction the app applies. */
/** The flat rate for region 'generic'. Mirrors DEFAULT_TAX_RATES.customTaxRatePct. */
const customTaxRate = (blob: ExportPayload): number => blob.customTaxRatePct ?? 30;

export function taxFor(blob: ExportPayload, grossAnnual: number, withBsuCredit = true) {
  return calcTaxByRegion(
    grossAnnual,
    blob.region ?? 'no',
    customTaxRate(blob),
    blob.pension?.ipsAnnualContribution ?? 0,
    annualMortgageInterest(blob),
    withBsuCredit ? bsuCredit(blob) : 0,
  );
}

/** Holiday pay above salary for an income year. Mirrors FinanceContext `holidaySurplusFor`. */
export function holidaySurplus(blob: ExportPayload, year: number): number {
  if ((blob.region ?? 'no') !== 'no') return 0;
  const sats = blob.employerCostConfig?.feriepengesatsPct ?? FERIEPENGER_DEFAULT_PCT;
  return feriepengerSurplus(year, (k) => activeGrossAnnual(blob, k), sats);
}

/**
 * Net monthly income derived from the salary system for a month, including that
 * month's budget-opted bonus/overtime after tax. Mirrors FinanceContext
 * `derivedNetMonthlyFor`; falls back to the static `income` without salaries.
 */
export function netMonthlyFor(blob: ExportPayload, monthKey: string): number {
  const income = blob.income ?? 0;
  if ((blob.salaries ?? []).length === 0) return income;
  const totalAnnual = activeGrossAnnual(blob, monthKey);
  if (totalAnnual === 0) return income;
  const surplus = holidaySurplus(blob, Number(monthKey.slice(0, 4)));
  const baseNetAnnual = taxFor(blob, totalAnnual + surplus).netAnnual;
  const extraGross =
    (blob.bonuses ?? []).reduce((s, b) => (b.includeInBudget && b.date.startsWith(monthKey) ? s + b.amount : s), 0) +
    (blob.overtime ?? []).reduce((s, o) => (o.includeInBudget && o.date.startsWith(monthKey) ? s + o.amount : s), 0);
  const onCard = cardNetForMonth(
    blob.taxCard, blob.region ?? 'no', monthKey,
    totalAnnual, extraGross, blob.pension?.ipsAnnualContribution ?? 0, surplus,
  );
  if (onCard != null) return onCard;
  if (extraGross <= 0) return Math.round(baseNetAnnual / 12);
  const netWithExtra = taxFor(blob, totalAnnual + surplus + extraGross).netAnnual;
  return Math.round(baseNetAnnual / 12 + (netWithExtra - baseNetAnnual));
}

/** The month's net income: its manual override, else the derived figure. Mirrors `effectiveIncome`. */
export function effectiveIncome(blob: ExportPayload, monthKey: string): number {
  return blob.monthlyIncomes?.[monthKey] ?? netMonthlyFor(blob, monthKey);
}

/**
 * The month's savings plan resolved to kroner, honouring a one-month adjustment
 * (`savingsMonthOverrides`). Mirrors FinanceContext savingsPool / viewSavings /
 * savingsContributions / totalFixedExpenses for a live month.
 */
export function savingsView(blob: ExportPayload, monthKey: string) {
  const income = effectiveIncome(blob, monthKey);
  const fixed = blob.fixedExpenses ?? [];
  const pool = savingsBase(income, fixed);
  const target = blob.savingsTargetPercent ?? 20;
  const savings = blob.savings ?? [];
  const monthSaving = blob.savingsMonthOverrides?.[monthKey];
  const plan = resolveSavingsAmounts(savings, pool, target);
  const view = monthSaving === undefined ? plan : resolveSavingsForMonth(savings, pool, target, monthSaving);
  const contributions = savingsContributionTotal(view);
  const planContributions = savingsContributionTotal(plan);
  const fixedTotal = fixed.reduce((s, e) => s + e.amount, 0);
  return {
    income,
    pool,
    target,
    monthSaving,
    savings: view,
    contributions,
    planContributions,
    fixedTotal,
    totalFixed: fixedTotal + contributions,
  };
}

/** Last-12-month net income series, its mean and volatility. Mirrors `incomeSeries`/`averageIncome`/`incomeVolatility`. */
function incomeStats(blob: ExportPayload, monthKey: string) {
  const values = lastNMonthKeys(monthAnchor(monthKey), 12).map(
    (m) => blob.monthlyIncomes?.[m] ?? netMonthlyFor(blob, m),
  );
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { average: Math.round(mean), volatility: mean > 0 ? Math.sqrt(variance) / mean : 0 };
}

/**
 * The budget plan for a month plus the whole month's planned saving. Mirrors
 * FinanceContext calcRecommendations / plannedMonthlySaving / planMonthlySaving.
 */
function budgetPlan(blob: ExportPayload, monthKey: string) {
  const v = savingsView(blob, monthKey);
  const { average, volatility } = incomeStats(blob, monthKey);
  const monthTargetPct = v.monthSaving === undefined
    ? v.target
    : v.pool > 0 ? Math.min(100, (v.monthSaving / v.pool) * 100) : 0;
  const plan = calcRecommendations(v.income, average, v.totalFixed, volatility, monthTargetPct, v.contributions);
  let planMonthlySaving = v.contributions + Math.max(0, plan.recommendedInvestment);
  if (v.monthSaving !== undefined) {
    const base = calcRecommendations(v.income, average, v.fixedTotal + v.planContributions, volatility, v.target, v.planContributions);
    planMonthlySaving = v.planContributions + Math.max(0, base.recommendedInvestment);
  }
  return { view: v, plan, planMonthlySaving };
}

/** Total non-mortgage debt. Mirrors FinanceContext.tsx:1834. */
export function totalNonMortgageDebt(blob: ExportPayload): number {
  return (blob.debts ?? []).reduce((s, d) => s + Math.max(0, d.balance), 0);
}

/** Net worth. Mirrors FinanceContext.tsx:1831-1835. `monthKey` picks the
 *  co-owners in force (default: today). */
export function netWorth(blob: ExportPayload, monthKey?: string): number {
  const { totalEquity } = computeEquityBreakdown(blob.assets, monthKey);
  return totalEquity - totalNonMortgageDebt(blob);
}

/**
 * Everything reserved before free-to-spend: the fixed expenses plus the month's
 * resolved savings transfers. Mirrors the app's `totalFixedExpenses` — savings do
 * leave the account, so the budget reserves them, even though they are not spend.
 */
export function totalFixedExpenses(blob: ExportPayload, monthKey = currentMonthKey()): number {
  return savingsView(blob, monthKey).totalFixed;
}

// ---- tool payloads --------------------------------------------------------

export function overview(blob: ExportPayload, monthKey = currentMonthKey()) {
  const gross = grossAnnualIncome(blob, monthKey);
  const nonMortgageDebt = totalNonMortgageDebt(blob);
  const breakdown = computeEquityBreakdown(blob.assets, monthKey);
  // DTI includes the mortgage and counts revolving lines at their full credit
  // frame (capacityDebt), mirroring DashboardPage.tsx: the headline uses the
  // user's share of a joint mortgage, `dtiFullLoan` the whole loan (the bank's view).
  const shares = ownershipShares(blob.assets, monthKey);
  const myDebt = myHouseDebt(blob.assets, monthKey);
  const dti = calcDebtToIncome(myDebt + lendingDebtTotal(blob.debts ?? []), gross);
  const dtiFullLoan = calcDebtToIncome(blob.assets.houseDebt + lendingDebtTotal(blob.debts ?? []), gross);
  const hasMortgage = blob.assets.houseDebt > 0;
  const mortgageStatus = hasMortgage
    ? calcHomeownerMortgageStatus(
        blob.homeowner?.currentMortgageBalance ?? blob.assets.houseDebt,
        blob.homeowner?.originalLoanAmount ?? blob.assets.houseDebt,
        blob.homeowner?.rente ?? blob.loan?.rente ?? 0,
        blob.homeowner ? paymentTermMonths(blob.homeowner) / 12 : blob.loan?.nedbetalingstid ?? 0,
        RENTEFRADRAG_RATE_PCT,
      )
    : null;
  const mortgage = mortgageStatus
    ? { ...mortgageStatus, annualTaxDeduction: mortgageStatus.annualTaxDeduction * shares.debt }
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
    netWorth: Math.round(netWorth(blob, monthKey)),
    grossAnnualIncome: Math.round(gross),
    monthlyNetIncome: Math.round(effectiveIncome(blob, monthKey)),
    equityBreakdown: breakdown,
    debt: {
      nonMortgage: Math.round(nonMortgageDebt),
      // The user's share of the mortgage; mortgageFullLoan is the whole joint loan.
      mortgage: Math.round(myDebt),
      mortgageFullLoan: Math.round(blob.assets.houseDebt),
      studentLoan: Math.round(sumDebtByType(blob.debts ?? [], 'student')),
      debtToIncome: dti,
      debtToIncomeFullLoan: dtiFullLoan,
    },
    mortgage,
  };
}

/** Feriepenger/half-trekk shaping of un-overridden months (Norway only). Mirrors CashflowChart/BudgetPage. */
function seasonalConfig(blob: ExportPayload, monthKey: string) {
  return (blob.region ?? 'no') === 'no'
    ? {
        grossAnnual: grossAnnualIncome(blob, monthKey),
        feriepengesatsPct: blob.employerCostConfig?.feriepengesatsPct ?? 12,
      }
    : null;
}

/**
 * Trailing savings-rate health, plan-based like BudgetPage's banner: income and
 * planned fixed expenses only, measured against the target restated as a share
 * of income (the stored percent is a share of what's left after expenses).
 */
function savingsRateHealth(blob: ExportPayload, monthKey: string, v: ReturnType<typeof savingsView>) {
  const months = lastNMonthKeys(monthAnchor(monthKey), 12);
  const targetRateOfIncomePct = targetRateOfIncome(v.income, v.fixedTotal + v.planContributions, v.planContributions, v.target);
  const rows = planSavingsRateSeries(months, blob.monthlyIncomes ?? {}, Math.round(v.income), v.fixedTotal, seasonalConfig(blob, monthKey));
  return { targetRateOfIncomePct, status: savingsRateStatus(rows, targetRateOfIncomePct) };
}

export function budgetSummary(blob: ExportPayload, monthKey = currentMonthKey()) {
  const v = savingsView(blob, monthKey);
  const months = lastNMonthKeys(monthAnchor(monthKey), 12);
  const seasonal = seasonalConfig(blob, monthKey);
  const income = Math.round(v.income);
  // Literal cashflow, as CashflowChart: transfers netted out, budgeted bills
  // reconciled against their imported payments.
  const rows = monthlyCashflow(
    months,
    nonTransferTransactions(blob),
    blob.monthlyIncomes ?? {},
    income,
    v.totalFixed,
    seasonal,
    blob.fixedExpenses ?? [],
  );
  const health = savingsRateHealth(blob, monthKey, v);
  return {
    monthKey,
    monthlyNetIncome: income,
    totalFixedExpenses: Math.round(v.totalFixed),
    essentialMonthlyExpenses: Math.round(essentialMonthlyExpenses(blob.fixedExpenses ?? [])),
    fixedByType: fixedExpenseTotalsByType(blob.fixedExpenses ?? []),
    savingsTargetPercent: v.target,
    // This month's savings transfers, resolved to kroner. `monthAdjustment` is the
    // one-month saving the user set for this month (null = follows the plan).
    monthlySavings: Math.round(v.contributions),
    monthAdjustment: v.monthSaving ?? null,
    // `savingsRate.trailingRate` is a share of income: compare it with
    // `savingsRateTargetOfIncomePct`, not with `savingsTargetPercent`.
    savingsRateTargetOfIncomePct: Math.round(health.targetRateOfIncomePct * 10) / 10,
    savingsRate: health.status,
    cashflowLast12: rows,
  };
}

/** Transactions with internal (own-account) transfers netted out, mirroring the
 *  app's `nonTransferTransactions` (two-legged pairs + transferRule matches). */
function nonTransferTransactions(blob: ExportPayload) {
  const txs = blob.dailyTransactions ?? [];
  const excluded = excludedTransferIds(txs, blob.transferRules ?? []);
  return txs.filter((tx) => !excluded.has(tx.id));
}

export function spendingAnalysis(blob: ExportPayload, monthKey = currentMonthKey()) {
  // Net out own-account transfers exactly as the app's budget analysis does
  // (transferRules + auto-detected pairs), so category totals aren't inflated by
  // card payments / savings moves that show up as an expense + a matching income.
  // One-offs are left out too, as in the app's spending analysis.
  const txs = withoutOneOffs(nonTransferTransactions(blob));
  const prior6 = lastNMonthKeys(monthAnchor(addMonthsKey(monthKey, -1)), 6);
  return {
    monthKey,
    byCategory: spendByCategory(txs, monthKey),
    monthOverMonth: categoryMoM(txs, monthKey, addMonthsKey(monthKey, -1)),
    budgetProgress: budgetProgress(txs, monthKey, blob.categoryBudgets ?? {}),
    headline: topSpendInsight(txs, monthKey, prior6),
    recurringUntracked: detectRecurring(txs, blob.fixedExpenses ?? [], monthKey),
  };
}

/**
 * Consolidated annual review for a calendar year: income, tax paid, savings rate,
 * top spending categories, and net-worth change. Mirrors YearReviewPage — nets
 * out transfers and caps at the current month. `year` defaults to the most recent
 * year with data. Monthly net income is the per-month override when present, else
 * the salary-derived net for that month, as the page does.
 */
export function yearReviewSummary(
  blob: ExportPayload,
  year?: number,
  monthKey = currentMonthKey(),
) {
  const txs = nonTransferTransactions(blob);
  const payslips = blob.payslips ?? {};
  const snapshots = blob.balanceSnapshots ?? {};
  const history = blob.netWorthHistory ?? {};
  const years = availableReportYears({
    transactions: txs, payslips, snapshots, netWorthHistory: history, nowMonthKey: monthKey,
  });
  const targetYear = year && years.includes(year) ? year : (years[0] ?? yearOf(monthKey));

  const incomeByMonth: Record<string, number> = {};
  for (const m of monthsBetween(`${targetYear}-01`, `${targetYear}-12`)) {
    incomeByMonth[m] = blob.monthlyIncomes?.[m] ?? netMonthlyFor(blob, m);
  }

  const review = yearReview(targetYear, {
    transactions: txs,
    incomeByMonth,
    totalFixedExpenses: totalFixedExpenses(blob, monthKey),
    payslips,
    snapshots,
    netWorthHistory: history,
    currentNetWorth: netWorth(blob, monthKey),
    nowMonthKey: monthKey,
  });
  return { availableYears: years, ...review };
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
  const fixedTotal = totalFixedExpenses(blob, monthKey);
  const essential = essentialMonthlyExpenses(blob.fixedExpenses ?? []);
  // Two app call-sites use different denominators; expose both (see derivation report).
  const efDashboard = calcEmergencyFundStatus(buffer, fixedTotal);
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
  const { view: v, plan, planMonthlySaving } = budgetPlan(blob, monthKey);
  const health = savingsRateHealth(blob, monthKey, v);
  return {
    monthKey,
    budgetPlan: plan,
    plannedMonthlySaving: Math.round(planMonthlySaving),
    savingsRateTargetOfIncomePct: Math.round(health.targetRateOfIncomePct * 10) / 10,
    savingsRate: health.status,
    history: computeHistoryInsights(
      blob.balanceSnapshots ?? {},
      blob.netWorthHistory ?? {},
      netWorth(blob, monthKey),
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
  return prepayVsInvest(extraMonthly, mortgageRate, returnPct, years, RENTEFRADRAG_RATE_PCT, blob.assets.taxRate ?? 0);
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

// ---- salary, tax, pension, forecast, housing, employer cost --------------

/**
 * Salary and income tax for a month. Mirrors SalaryPage (active jobs, marginal
 * rate, restskatt) and FinanceContext (net monthly, with every deduction).
 */
export function salaryAndTax(blob: ExportPayload, monthKey = currentMonthKey()) {
  const region = blob.region ?? 'no';
  const jobs = activeJobBreakdown(blob.salaries ?? [], blob.jobs ?? [], monthKey);
  // Salary-system gross only: the `income * 12` fallback is annualised NET pay,
  // so taxing it would invent a breakdown. Without salaries there is none.
  const gross = activeGrossAnnual(blob, monthKey);
  const tax = gross > 0 ? taxFor(blob, gross) : null;
  const ips = blob.pension?.ipsAnnualContribution ?? 0;
  const payslips = blob.payslips ?? {};
  const year = yearOf(monthKey);
  return {
    monthKey,
    region,
    activeJobs: jobs.map((c) => ({
      jobId: c.jobId,
      employer: c.job?.employer ?? '',
      role: c.job?.role ?? '',
      baseAnnual: c.base,
      onCallAnnual: c.onCall,
      grossAnnual: c.gross,
    })),
    // Several active jobs at once is either real concurrent work or a job change
    // whose old end date was never set; the Salary page warns on it.
    overlappingJobs: jobs.length > 1,
    grossAnnual: Math.round(gross),
    tax,
    // Rate on the next krone of combined gross, after the mortgage-interest
    // deduction. SalaryPage shows it for the latest salary without that deduction,
    // so the two differ with concurrent jobs or a large interest deduction.
    marginalTaxRatePct: gross <= 0
      ? null
      : region === 'no'
        ? calcMarginalTaxRate(gross, ips, TAX_YEAR, annualMortgageInterest(blob))
        : customTaxRate(blob),
    annualMortgageInterestDeduction: Math.round(annualMortgageInterest(blob)),
    netMonthlyDerived: netMonthlyFor(blob, monthKey),
    netMonthlyEffective: Math.round(effectiveIncome(blob, monthKey)),
    netMonthlyOverridden: blob.monthlyIncomes?.[monthKey] !== undefined,
    payslip: payslips[monthKey] ?? null,
    restskatt: region === 'no'
      ? restskattEstimate(payslips, year, (g) => taxFor(blob, g).totalTax)
      : null,
    salaryHistory: [...(blob.salaries ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    bonusesThisYear: (blob.bonuses ?? []).filter((b) => b.date.startsWith(String(year))),
    overtimeThisYear: (blob.overtime ?? []).filter((o) => o.date.startsWith(String(year))),
  };
}

/**
 * Copy of FinanceContext DEFAULT_PENSION (that module pulls in React). The app
 * merges a stored pension over it on load, so a partial object never reaches the
 * math; this does the same.
 */
const DEFAULT_PENSION: Pension = {
  otpBalance: 0, otpEmployerPct: 5, otpEmployeePct: 0, otpGrowthRate: 5,
  ipsBalance: 0, ipsAnnualContribution: 0, ipsGrowthRate: 7,
  birthYear: 0, retirementAge: 67, folketrygdBeholdning: 0, folketrygdSingle: true,
  pensionPayoutYears: 10, afpEligible: false, otpAutoPost: false, ipsAutoPost: false,
};

/**
 * Pension projection and retirement income. Mirrors PensionPage, including the
 * today's-kroner view: OTP/IPS payouts discounted by `inflationPct` (the app's
 * current CPI rate) over the years to retirement; folketrygd/AFP are already at today's G.
 */
export function pensionSummary(blob: ExportPayload, monthKey = currentMonthKey(), inflationPct = DEFAULT_INFLATION_PCT) {
  if (!blob.pension) return { configured: false as const };
  const p: Pension = { ...DEFAULT_PENSION, ...blob.pension };
  const region = blob.region ?? 'no';
  const customRate = customTaxRate(blob);
  const currentYear = yearOf(monthKey);
  const hasBirthYear = p.birthYear > 1900;
  const yearsToRetire = hasBirthYear ? Math.max(0, p.retirementAge - (currentYear - p.birthYear)) : 0;
  const pensionableIncome = activeGrossAnnual(blob, monthKey);
  const otpAnnualContribution = pensionableIncome * (p.otpEmployerPct + p.otpEmployeePct) / 100;
  const ipsAnnualContribution = Math.min(p.ipsAnnualContribution, IPS_MAX_DEDUCTION);
  const ipsDeductionRate = region === 'generic' ? customRate / 100 : 0.22;
  const projection = projectPensionWealth({
    otpBalance: p.otpBalance,
    ipsBalance: p.ipsBalance,
    otpAnnualContribution,
    ipsAnnualContribution,
    otpGrowthRate: p.otpGrowthRate,
    ipsGrowthRate: p.ipsGrowthRate,
    yearsToRetire,
    startYear: currentYear,
  });
  const atRetirement = projection.length > 0 ? projection[projection.length - 1] : null;
  const currentBeholdning = p.folketrygdBeholdning > 0
    ? p.folketrygdBeholdning
    : estimateBeholdning({ birthYear: p.birthYear, currentYear, annualIncome: pensionableIncome });
  const beholdningAtRetire = projectBeholdning(currentBeholdning, pensionableIncome, yearsToRetire, TAX_YEAR);
  const folketrygd = annualFolketrygdPension({
    beholdning: beholdningAtRetire,
    birthYear: p.birthYear,
    retirementAge: p.retirementAge,
    single: p.folketrygdSingle ?? true,
    year: TAX_YEAR,
  });
  const payoutYears = Math.max(1, p.pensionPayoutYears || 10);
  const otpAnnualPayout = (atRetirement?.otp ?? p.otpBalance) / payoutYears;
  const ipsAnnualPayout = (atRetirement?.ips ?? p.ipsBalance) / payoutYears;
  const afpAnnualAmount = p.afpEligible
    ? annualAfp({
        grunnlag: estimateAfpGrunnlag({ birthYear: p.birthYear, annualIncome: pensionableIncome, year: TAX_YEAR }),
        birthYear: p.birthYear,
        retirementAge: p.retirementAge,
      })
    : 0;
  const grossPensionAnnual = folketrygd.annual + afpAnnualAmount + otpAnnualPayout + ipsAnnualPayout;
  const pensionTax = region === 'no'
    ? calcPensionIncomeTax(grossPensionAnnual, TAX_YEAR)
    : calcTaxByRegion(grossPensionAnnual, region, customRate);
  const currentNetAnnual = calcTaxByRegion(pensionableIncome, region, customRate, ipsAnnualContribution, 0).netAnnual;
  const grossTodayAnnual = folketrygd.annual + afpAnnualAmount
    + inTodaysKroner(otpAnnualPayout + ipsAnnualPayout, yearsToRetire, inflationPct);
  const netTodayAnnual = (region === 'no'
    ? calcPensionIncomeTax(grossTodayAnnual, TAX_YEAR)
    : calcTaxByRegion(grossTodayAnnual, region, customRate)).netAnnual;
  return {
    configured: true as const,
    settings: p,
    hasBirthYear,
    yearsToRetire,
    pensionableIncome: Math.round(pensionableIncome),
    otpAnnualContribution: Math.round(otpAnnualContribution),
    ipsAnnualContribution: Math.round(ipsAnnualContribution),
    ipsAnnualTaxSaving: Math.round(ipsAnnualContribution * ipsDeductionRate),
    balanceNow: Math.round(p.otpBalance + p.ipsBalance),
    balanceAtRetirement: Math.round(atRetirement?.total ?? p.otpBalance + p.ipsBalance),
    projection,
    retirementIncomeAnnual: {
      folketrygd: Math.round(folketrygd.annual),
      afp: Math.round(afpAnnualAmount),
      otp: Math.round(otpAnnualPayout),
      ips: Math.round(ipsAnnualPayout),
      gross: Math.round(grossPensionAnnual),
      net: Math.round(pensionTax.netAnnual),
    },
    // Folketrygd/AFP in today's kroner, OTP/IPS in kroner of the retirement year.
    netPensionMonthly: Math.round(pensionTax.netAnnual / 12),
    replacementRatePct: currentNetAnnual > 0 ? Math.round((pensionTax.netAnnual / currentNetAnnual) * 1000) / 10 : 0,
    // Everything in today's kroner: the fair comparison with today's salary.
    inTodaysKroner: {
      inflationPct,
      grossAnnual: Math.round(grossTodayAnnual),
      netMonthly: Math.round(netTodayAnnual / 12),
      replacementRatePct: currentNetAnnual > 0 ? Math.round((netTodayAnnual / currentNetAnnual) * 1000) / 10 : 0,
    },
  };
}

/**
 * The mortgage the active housing mode follows. Mirrors ForecastPage. `termYears`
 * prices the payment (homeowner: the term as of the balance's month);
 * `remainingMonths` is the term left at `monthKey` (loanTerm.ts).
 */
function activeMortgage(blob: ExportPayload, monthKey: string) {
  const homeowner = (blob.housingMode ?? 'first_buyer') === 'homeowner';
  const h = blob.homeowner;
  const loanTerm = blob.loan?.nedbetalingstid ?? 25;
  const hasTerm = h?.nedbetalingstid != null;
  return {
    balance: (homeowner ? h?.currentMortgageBalance : blob.loan?.laanebelop) ?? 0,
    ratePct: (homeowner ? h?.rente : blob.loan?.rente) ?? 5,
    termYears: homeowner ? (hasTerm ? paymentTermMonths(h) / 12 : 25) : loanTerm,
    remainingMonths: homeowner ? (hasTerm ? effectiveRemainingMonths(h, monthKey) : 300) : termMonthsFromYears(loanTerm),
  };
}

export interface ForecastOverrides {
  years?: number;
  raisePct?: number;
  savingsPct?: number;
  returnPct?: number;
  inflationPct?: number;
}

/**
 * Net-worth forecast. Mirrors ForecastPage scenario A: each lever is the user's
 * stored assumption, else the page's data-driven seed. CPI isn't in the blob, so
 * the inflation seed is the page's 3% fallback unless overridden.
 */
export function forecast(blob: ExportPayload, overrides: ForecastOverrides = {}, monthKey = currentMonthKey()) {
  const a = blob.forecastAssumptions?.a;
  const currentGross = grossAnnualIncome(blob, monthKey);
  const sorted = [...(blob.salaries ?? [])].sort((x, y) => x.effectiveDate.localeCompare(y.effectiveDate));
  let raiseSeed = 4.5;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const [fy, fm] = first.effectiveDate.split('-').map(Number);
    const [ly, lm] = last.effectiveDate.split('-').map(Number);
    const yrs = ((ly - fy) * 12 + (lm - fm)) / 12;
    if (yrs > 0 && first.grossAnnual > 0) {
      const cagr = (Math.pow(last.grossAnnual / first.grossAnnual, 1 / yrs) - 1) * 100;
      if (Number.isFinite(cagr) && cagr > 0) raiseSeed = Math.round(cagr * 10) / 10;
    }
  }
  const net = taxFor(blob, currentGross, false).netAnnual;
  const { planMonthlySaving } = budgetPlan(blob, monthKey);
  const savingsPctRaw = net > 0 ? (planMonthlySaving * 12 / net) * 100 : 0;
  const savingsSeed = Number.isFinite(savingsPctRaw) && savingsPctRaw > 0 ? Math.min(90, Math.round(savingsPctRaw)) : 25;

  const scenario = {
    raisePct: overrides.raisePct ?? a?.raisePct ?? raiseSeed,
    savingsPct: overrides.savingsPct ?? a?.savingsPct ?? savingsSeed,
    returnPct: overrides.returnPct ?? a?.returnPct ?? blob.growthReturnRate ?? 7,
    inflationPct: overrides.inflationPct ?? a?.inflationPct ?? 3,
    years: overrides.years ?? a?.years ?? 15,
    extraMonthly: a?.extraMonthly ?? 5000,
  };
  const m = activeMortgage(blob, monthKey);
  const eq = computeEquityBreakdown(blob.assets, monthKey);
  // Mirrors ForecastPage: the user's share of a joint mortgage (homeowner) and home.
  const shares = ownershipShares(blob.assets, monthKey);
  const startingMortgage = (blob.housingMode ?? 'first_buyer') === 'homeowner' ? m.balance * shares.debt : m.balance;
  const rows = projectForecast(
    {
      currentGross,
      startingMortgage,
      mortgageRatePct: m.ratePct,
      annualMortgagePayment: calcMonthlyPayment(startingMortgage, m.ratePct, m.termYears) * 12,
      region: blob.region ?? 'no',
      customTaxRatePct: customTaxRate(blob),
      ipsAnnualContribution: blob.pension?.ipsAnnualContribution ?? 0,
      startYear: yearOf(monthKey),
      startHomeValue: myHouseValue(blob.assets, monthKey),
      startHomeDebt: myHouseDebt(blob.assets, monthKey),
      homeDebtTermYears: m.remainingMonths / 12,
      homeOwnShare: shares.own,
      houseGrowthPct: blob.houseGrowthRate ?? 3,
      startShares: eq.netInvestment,
      startOtherAssets: eq.netCrypto + sumSavings(blob.assets) + blob.assets.bsu + blob.assets.bufferAccount,
      debts: blob.debts ?? [],
      monthKey,
    },
    scenario,
  );
  const history = Object.entries(blob.netWorthHistory ?? {})
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([month, value]) => ({ month, value }));
  return { monthKey, scenario, projection: rows, netWorthHistory: history };
}

/** Mortgage details: amortization, payoff timeline, paydown vs plan. Mirrors BoligPage (homeowner). */
export function mortgage(blob: ExportPayload, monthKey = currentMonthKey()) {
  const housingMode = blob.housingMode ?? 'first_buyer';
  const m = activeMortgage(blob, monthKey);
  const remaining = splitTermMonths(m.remainingMonths);
  const timeline = housingMode === 'homeowner' ? loanTimeline(blob.homeowner?.startDate, m.remainingMonths / 12, monthKey) : null;
  const schedule = m.balance > 0 && m.termYears > 0 ? calcAmortizationSchedule(m.balance, m.ratePct, m.termYears) : [];
  const houseValue = blob.assets.houseValue;
  const monthlyFee = housingMode === 'homeowner' ? blob.homeowner?.termingebyr ?? 0 : blob.loan?.termingebyr ?? 0;
  const monthlyPayment = calcMonthlyPayment(m.balance, m.ratePct, m.termYears) + monthlyFee;
  const shares = ownershipShares(blob.assets, monthKey);
  const status = housingMode === 'homeowner' && blob.homeowner
    ? calcHomeownerMortgageStatus(
        blob.homeowner.currentMortgageBalance,
        blob.homeowner.originalLoanAmount,
        blob.homeowner.rente,
        paymentTermMonths(blob.homeowner) / 12,
        RENTEFRADRAG_RATE_PCT,
      )
    : null;
  return {
    monthKey,
    housingMode,
    // 'current' = the homeowner's real mortgage; 'planned' = the loan being planned
    // for a purchase (first-buyer / transitioning), not a debt that exists yet.
    loanKind: housingMode === 'homeowner' ? 'current' : 'planned',
    balance: Math.round(m.balance),
    ratePct: m.ratePct,
    // Term left at monthKey (counts down for the current mortgage).
    termYears: Math.round((m.remainingMonths / 12) * 100) / 100,
    remainingMonths: m.remainingMonths,
    remainingTerm: { years: remaining.years, months: remaining.months },
    payoffMonth: housingMode === 'homeowner' ? timeline?.payoffDate ?? null : null,
    // Balance, payment and LTV are the whole property's (the bank's view). The
    // ownership block is the user's share; rentefradrag follows the loan share.
    monthlyPayment: Math.round(monthlyPayment),
    ownership: {
      ownershipPct: Math.round(shares.own * 1000) / 10,
      debtSharePct: Math.round(shares.debt * 1000) / 10,
      // The full stored list (pass it back whole to set_co_owners); `active`
      // is the subset in force at monthKey.
      coOwners: blob.assets.coOwners ?? [],
      activeCoOwners: activeCoOwners(blob.assets.coOwners, monthKey),
      myHouseValue: Math.round(myHouseValue(blob.assets, monthKey)),
      myHouseDebt: Math.round(myHouseDebt(blob.assets, monthKey)),
      myMonthlyPayment: housingMode === 'homeowner' ? Math.round(monthlyPayment * shares.debt) : null,
    },
    status: status ? { ...status, annualTaxDeduction: status.annualTaxDeduction * shares.debt } : null,
    notifiedRate: blob.homeowner?.notifiedRate != null
      ? { ratePct: blob.homeowner.notifiedRate, from: blob.homeowner.notifiedRateFrom ?? null }
      : null,
    timeline,
    // Only an owned home has a value to measure against (BoligPage shows these to homeowners only).
    loanToValuePct: housingMode === 'homeowner' && houseValue > 0 ? Math.round((m.balance / houseValue) * 1000) / 10 : null,
    residence: housingMode === 'homeowner'
      ? residenceMetrics(currentResidence(blob.residences ?? []), houseValue, monthKey)
      : null,
    paydownVsPlan: paydownVsPlan(blob.balanceSnapshots ?? {}),
    totalInterestRemaining: Math.round(schedule.reduce((s, y) => s + y.interestPaid, 0)),
    amortizationByYear: schedule,
  };
}

/**
 * Borrowing capacity and second-home scenarios. Mirrors BoligPage's capacity
 * (live inputs, with the user's manual overrides) and SecondHomePanel's
 * portfolio / comparison.
 */
export function housing(blob: ExportPayload, monthKey = currentMonthKey()) {
  const eq = computeEquityBreakdown(blob.assets);
  const o = blob.capacityOverrides;
  const capacityDebt = lendingDebtTotal(blob.debts ?? []);
  const liquidEquity = Math.round(blob.assets.bsu + sumSavings(blob.assets) + blob.assets.bufferAccount + eq.netInvestment);
  const gross = grossAnnualIncome(blob, monthKey);
  const inputs = {
    grossAnnualIncome: o?.arslonn ?? gross,
    existingDebt: o?.gjeld ?? capacityDebt,
    equity: o?.egenkapital ?? liquidEquity,
    ratePct: blob.loan?.rente ?? 5,
    termYears: blob.loan?.nedbetalingstid ?? 25,
    overridden: { income: o?.arslonn != null, debt: o?.gjeld != null, equity: o?.egenkapital != null },
  };
  const scenarios = blob.secondHomeScenarios ?? [];
  return {
    monthKey,
    housingMode: blob.housingMode ?? 'first_buyer',
    borrowingCapacity: {
      inputs,
      result: calcBorrowingCapacity(inputs.grossAnnualIncome, inputs.equity, inputs.existingDebt, inputs.ratePct, inputs.termYears),
    },
    plannedPurchase: blob.loan ?? null,
    secondHome: {
      portfolio: calcPortfolio(scenarios, gross, capacityDebt),
      scenarios: scenarios.map((s) => ({ id: s.id, name: s.name, strategy: s.strategy, summary: summarizeScenario(s) })),
    },
  };
}

/** Employer cost, billing rate and margin. Mirrors EmployerCostPage, incl. its solve-for mode. */
export function employerCost(blob: ExportPayload, monthKey = currentMonthKey()) {
  const costConfig = { ...DEFAULT_EMPLOYER_COST_CONFIG, ...blob.employerCostConfig };
  const billing = { ...DEFAULT_BILLING_CONFIG, ...blob.billingConfig };
  const derivedGross = activeGrossAnnual(blob, monthKey);
  const storedGross = blob.employerSalaryOverride ?? derivedGross;
  const storedRate = billing.billedHourly ?? 0;
  const otpPct = blob.pension?.otpEmployerPct ?? 5;
  const isNo = (blob.region ?? 'no') === 'no';
  const hours = calcBillableHours(billing);
  const gross = billing.solveFor === 'salary'
    ? calcFairGross(storedRate, hours, otpPct, costConfig, billing.targetMarginPct, isNo)
    : storedGross;
  const cost = calcEmployerCost(gross, otpPct, costConfig, isNo);
  const breakEven = calcBillingRate(cost.totalEmployerCost, billing);
  const rate = billing.solveFor === 'rate' ? breakEven.targetHourly : storedRate;
  const result = calcBilledRate(rate, hours, cost.totalEmployerCost);
  return {
    monthKey,
    solveFor: billing.solveFor,
    grossAnnual: Math.round(gross),
    salaryFromOverride: blob.employerSalaryOverride != null,
    billableHoursPerYear: hours,
    hourlyRate: Math.round(rate),
    dailyRate: Math.round(rate * Math.max(0, billing.hoursPerDay)),
    marginPct: billing.solveFor === 'margin' ? result.marginPct : billing.targetMarginPct,
    markupOverBreakEvenPct: breakEven.breakEvenHourly > 0 ? (rate / breakEven.breakEvenHourly - 1) * 100 : 0,
    fairGrossAtTargetMargin: billing.solveFor === 'margin'
      ? Math.round(calcFairGross(rate, hours, otpPct, costConfig, billing.targetMarginPct, isNo))
      : null,
    employerCost: cost,
    billing: breakEven,
    billed: result,
    config: { employerCost: costConfig, billing },
  };
}

/** Every balance with its id, for the write tools, plus recent snapshots and wealth tax. */
export function assetsAndDebts(blob: ExportPayload) {
  const eq = computeEquityBreakdown(blob.assets);
  const snapshots = Object.keys(blob.balanceSnapshots ?? {}).sort().slice(-12);
  const nonMortgageDebt = totalNonMortgageDebt(blob);
  return {
    assets: blob.assets,
    equityBreakdown: eq,
    netWorth: Math.round(netWorth(blob)),
    debts: blob.debts ?? [],
    mortgage: { housingMode: blob.housingMode ?? 'first_buyer', homeowner: blob.homeowner ?? null, loan: blob.loan ?? null },
    savingsTransfers: blob.savings ?? [],
    fixedExpenses: blob.fixedExpenses ?? [],
    // Formuesskatt estimate as AssetPage shows it (Norway only).
    wealthTax: (blob.region ?? 'no') === 'no'
      ? calcWealthTax({
          primaryHomeValue: myPrimaryHomeWealthValue(blob.assets),
          shares: blob.assets.portfolio,
          otherAssets: blob.assets.crypto + sumSavings(blob.assets) + blob.assets.bsu + blob.assets.bufferAccount,
          debt: myHouseDebt(blob.assets) + nonMortgageDebt,
        })
      : null,
    recentSnapshots: snapshots.map((m) => ({ month: m, netWorth: netWorthFromSnapshot(blob.balanceSnapshots![m]) })),
  };
}

export interface TransactionQuery {
  from?: string;
  to?: string;
  category?: string;
  text?: string;
  minAmount?: number;
  maxAmount?: number;
  kind?: 'income' | 'expense';
  excludeTransfers?: boolean;
  limit?: number;
}

/** Filter transactions, newest first, with totals over every match (not just the returned page). */
export function queryTransactions(blob: ExportPayload, q: TransactionQuery) {
  const source = q.excludeTransfers === false ? blob.dailyTransactions ?? [] : nonTransferTransactions(blob);
  const text = q.text?.toLowerCase();
  const matches = source.filter((tx: DailyTransaction) => {
    // Compare at the bound's own precision, so 'YYYY-MM' and 'YYYY-MM-DD' both work inclusively.
    if (q.from && tx.date.slice(0, q.from.length) < q.from) return false;
    if (q.to && tx.date.slice(0, q.to.length) > q.to) return false;
    if (q.category && (tx.category || 'other') !== q.category) return false;
    if (q.kind && (isSpend(tx) ? 'expense' : 'income') !== q.kind) return false;
    if (q.minAmount != null && tx.amount < q.minAmount) return false;
    if (q.maxAmount != null && tx.amount > q.maxAmount) return false;
    if (text && !`${tx.description} ${tx.merchant ?? ''}`.toLowerCase().includes(text)) return false;
    return true;
  });
  matches.sort((a, b) => b.date.localeCompare(a.date));
  const byCategory: Record<string, number> = {};
  let expenses = 0;
  let income = 0;
  for (const tx of matches) {
    if (!isSpend(tx)) {
      income += tx.amount;
    } else {
      expenses += tx.amount;
      const c = tx.category || 'other';
      byCategory[c] = (byCategory[c] ?? 0) + tx.amount;
    }
  }
  const limit = q.limit ?? 100;
  return {
    count: matches.length,
    returned: Math.min(limit, matches.length),
    totalExpenses: Math.round(expenses),
    totalIncome: Math.round(income),
    expensesByCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Math.round(v)])),
    transactions: matches.slice(0, limit),
  };
}
