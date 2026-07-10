import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import {
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  format,
  subMonths
} from 'date-fns';
import { calcRecommendations } from '../lib/calculations';
import type { ConservativeReason } from '../lib/calculations';
import { computeEquityBreakdown } from '../lib/equity';
import { calcTaxByRegion } from '../lib/norwegianTax';
import { getDemoData } from '../lib/demoData';
import { translations, type Language, type Translations } from '../i18n/translations';

// Re-exported so existing consumers can keep importing these from the context.
export type { Language } from '../i18n/translations';
import { categorizeWithRules, type CategoryRule } from '../lib/categorize';
import type { LabelRule } from '../lib/labelRules';
import type { CategoryKey } from '../lib/categories';
import { reconcile, runningEnvelopeBalance, discretionarySpendForMonth, type Reconciliation } from '../lib/envelopes';
import { findInternalTransferIds } from '../lib/transfers';
import { lastNMonthKeys, currentMonthKey } from '../lib/date';
import { accountGroupLabel, accountGroupKey } from '../lib/account';
import { sumDebtByType } from '../lib/debt';
import { dedupeBankTransactions } from '../lib/bankDedup';
import { salaryAt } from '../lib/salary';
import { stableStringify } from '../lib/stableStringify';
import { sanitizePayload } from '../lib/sanitizePayload';
import {
  type EmployerCostConfig,
  type BillingRateConfig,
  DEFAULT_EMPLOYER_COST_CONFIG,
  DEFAULT_BILLING_CONFIG,
} from '../lib/employerCost';
import { makeId } from '../lib/savingsMigration';
import {
  makePayloadRegistry,
  applyPersistedFields,
  derivePayload,
  type PayloadSetters,
} from '../lib/payloadRegistry';

// --- Types ---

// Category of a fixed expense — drives its colour role in the budget charts.
export type ExpenseType = 'fixed' | 'variable' | 'subscription' | 'insurance';

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  type?: ExpenseType; // optional for back-compat with older stored/imported data
  /**
   * Optional link to a tracked transaction category (e.g. 'groceries'). When set,
   * this fixed expense becomes an *envelope*: its amount is still reserved up front,
   * but real transactions in that category draw down the envelope instead of hitting
   * the daily budget a second time (see src/lib/envelopes.ts). Absent on committed
   * bills that never appear as tracked spending (mortgage, insurance) and on all
   * legacy/imported data — those behave exactly as before.
   */
  category?: CategoryKey;
  /**
   * Optional merchant/text pattern that ties THIS fixed expense to its own
   * transactions (e.g. a mortgage's account number, or "Ruter"). More precise
   * than `category`: only transactions matching it draw this envelope down, so
   * a small budgeted line isn't falsely "over budget" from unrelated spend in a
   * broad category. When set, it takes priority over `category` for matching.
   */
  match?: string;
}

// Non-mortgage debts (studielån, forbrukslån, kredittkort, …). Modeled separately
// from the mortgage (which lives in Assets.houseDebt) and reduce net worth.
export type DebtType = 'student' | 'consumer' | 'credit_card' | 'other';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  balance: number;      // current outstanding principal
  rate: number;         // annual nominal interest rate, %
  minPayment: number;   // normal monthly payment
  /**
   * A revolving balance paid in full every month (e.g. a credit card you always
   * clear). It's a real current liability — it still reduces net worth — but it
   * never amortizes and accrues no modelled interest, so it's excluded from the
   * payoff planner/projection. rate/minPayment are irrelevant when this is set.
   */
  revolving?: boolean;
}

export interface DailyTransaction {
  id: string;
  date: string; // ISO string
  description: string;
  amount: number;
  category?: string;
  /**
   * Whether this row is money out ('expense') or money in ('income'). Income is
   * excluded from "spent" / burn-rate / category charts and instead adds to the
   * running balance. Missing on legacy rows — treat undefined as 'expense'.
   */
  kind?: 'income' | 'expense';
  /** Cleaned counterparty name from the bank feed (richer than `description`). */
  merchant?: string;
  /** ISO 18245 merchant category code from the bank feed, when provided. */
  mcc?: string;
  /**
   * Which connected account/bank this row came from, for the per-account badge.
   * `account` is a stable key; `accountName`/`bank` are display strings. Display
   * only — set by bank sync, never touched by the money math. Absent on manual
   * rows and legacy imports.
   */
  account?: string;
  accountName?: string;
  bank?: string;
  /**
   * How `category` was set. 'auto' = the rule engine; 'manual' = a user edit.
   * Manual labels are never overwritten by re-sync or re-categorization.
   * Missing on legacy rows — treat as 'auto'.
   */
  categorySource?: 'auto' | 'manual';
}

export interface TransactionTemplate {
  id: string;
  description: string;
  amount: number;
  category?: string;
}

// A named cash savings account (e.g. "Sparekonto", "Feriekonto"). Multiple are
// supported; each adds to net worth and can back a goal. The legacy scalar
// `savings` below is superseded by `savingsAccounts` once that array exists — see
// sumSavings() in lib/equity.ts, which prefers the accounts and falls back to the
// scalar for pre-migration/older snapshot data.
export interface SavingsAccount {
  id: string;
  name: string;
  balance: number;
}

export interface Assets {
  portfolio: number;
  unrealizedGain: number;
  taxRate: number;
  bsu: number;
  /**
   * Legacy single savings, superseded by savingsAccounts. Import-time input
   * only: applyPayload absorbs it into savingsAccounts and writes 0, so live
   * state (and every persisted blob after one load) always carries 0.
   */
  savings?: number;
  savingsAccounts?: SavingsAccount[];
  houseValue: number;
  houseDebt: number;
  crypto: number;
  cryptoUnrealizedGain: number;
  cryptoTaxRate: number;
  bufferAccount: number;
}

export interface Pension {
  otpBalance: number;                  // OTP (employer-mandated) current balance in kr
  otpEmployerPct: number;              // % of gross salary employer pays (typ 2–7)
  otpEmployeePct: number;              // optional employee top-up % (0 default)
  otpGrowthRate: number;               // annual return % (default 5%)
  ipsBalance: number;                  // IPS (voluntary) current balance in kr
  ipsAnnualContribution: number;       // kr/year (NAV cap 15 000 in 2025)
  ipsGrowthRate: number;               // annual return % (default 7%)
  birthYear: number;                   // 0 = unset
  retirementAge: number;               // default 67
}

export interface LoanData {
  arslonn: number;
  eksisterendeGjeld: number;
  egenkapital: number;
  laanebelop: number;
  rente: number;
  nedbetalingstid: number;
  termingebyr: number;
  etableringsgebyr: number;
  skattefradragssats: number;
  betingetLaan: number;
  kjoepesum: number;
  gyldigTil: string;
}


export type Region = 'no' | 'generic';

export type HousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

export interface HomeownerData {
  currentMortgageBalance: number;
  originalLoanAmount: number;
  rente: number;
  nedbetalingstid: number;
  termingebyr: number;
  skattefradragssats: number;
}

export interface TransitionData {
  currentHouseValue: number;
  currentMortgageBalance: number;
  agentFeePercent: number;
  documentFee: number;
  otherSaleCosts: number;
  bridgeMonths: number;
  bridgeLoanRate: number;
}

// --- Salary tracker types ---

export interface JobEntry {
  id: string;
  startDate: string;              // 'YYYY-MM'
  endDate: string | null;         // null = current
  employer: string;
  role: string;
  contractedHoursPerWeek: number; // e.g. 37.5
  onCallAnnual?: number | null;   // extra gross income per year from on-call rotation
  notes?: string;
}

export type SalaryChangeType = 'initial' | 'raise' | 'promotion' | 'job_change' | 'adjustment';

export interface SalaryEntry {
  id: string;
  jobId: string;
  effectiveDate: string;          // 'YYYY-MM'
  grossAnnual: number;            // NOK
  changeType: SalaryChangeType;
  notes?: string;
}

/**
 * Total gross annual employment income (base + on-call) active in a given month.
 * Picks the latest applicable salary PER job (so salary history works) and SUMS
 * across all jobs that are still active that month (so concurrent jobs count).
 * Must aggregate before tax — progressive brackets apply to combined income.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function calcActiveGrossAnnual(
  salaries: SalaryEntry[],
  jobs: JobEntry[],
  monthKey: string,
): number {
  // Latest applicable salary PER job via the shared `salaryAt` selection, then
  // summed across jobs still active this month.
  let total = 0;
  for (const jobId of new Set(salaries.map(s => s.jobId))) {
    const sal = salaryAt(monthKey, salaries.filter(s => s.jobId === jobId));
    if (!sal) continue;
    const job = jobs.find(j => j.id === jobId);
    if (job?.endDate && job.endDate < monthKey) continue; // skip jobs that ended before this month
    total += sal.grossAnnual + (job?.onCallAnnual ?? 0);
  }
  return total;
}

export type BonusType = 'annual' | 'performance' | 'signing' | 'holiday_pay' | 'profit_share' | 'other';

export interface BonusEntry {
  id: string;
  date: string;                   // 'YYYY-MM-DD'
  amount: number;                 // gross NOK
  type: BonusType;
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  includeInBudget?: boolean;      // count this gross toward the month's budget income
  notes?: string;
}

export interface OvertimeEntry {
  id: string;
  date: string;                   // 'YYYY-MM-DD'
  hours: number;
  amount: number;                 // gross NOK paid
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  includeInBudget?: boolean;      // count this gross toward the month's budget income
  notes?: string;
}

export interface HoursSnapshot {
  id: string;
  periodMonth: string;            // 'YYYY-MM'
  actualHoursPerWeek: number;
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  notes?: string;
}

/**
 * A payslip's actual figures for one month, imported from a PDF and stored
 * per month (keyed 'YYYY-MM') to give the budget real numbers instead of
 * tax-estimated ones. `net` also drives that month's budget income (via a
 * matching monthly-income override set at import time).
 */
export interface MonthlyPayslip {
  gross: number;        // period gross pay (Bruttolønn)
  net: number;          // period net pay (Netto til utbetaling)
  tax: number;          // period tax withheld (Forskuddstrekk), positive
  base: number;         // base monthly salary (Månedslønn)
  holidayPay?: number;  // holiday pay accrued this year (period column)
}

export interface InflationPoint {
  month: string;                  // 'YYYY-MM'
  cpiIndex: number;
  yoyPercent: number;
}

export type GoalSource = 'manual' | 'bsu' | 'savings' | 'savingsAccount' | 'totalEquity' | 'portfolio' | 'bufferAccount';

export interface Goal {
  id: string;
  name: string;
  target: number;                 // NOK
  source: GoalSource;
  manualCurrent?: number;         // used when source === 'manual'
  savingsAccountId?: string;      // used when source === 'savingsAccount'
  deadline?: string;              // optional 'YYYY-MM'
  notes?: string;
}

export interface WageStatPoint {
  year: number;
  median: number;                 // gross annual NOK, national median for full-time employees
}


const DEFAULT_FIXED_EXPENSES: FixedExpense[] = [
  { id: '1', name: 'Huslån',          amount: 12000, type: 'fixed'        },
  { id: '2', name: 'Felleskostnader', amount: 3000,  type: 'fixed'        },
  { id: '3', name: 'Forsikring',      amount: 400,   type: 'insurance'    },
  { id: '4', name: 'Strøm',           amount: 1000,  type: 'fixed'        },
  { id: '5', name: 'Trening',         amount: 500,   type: 'subscription' },
  { id: '6', name: 'Mobil',           amount: 400,   type: 'subscription' },
  { id: '7', name: 'Mat',             amount: 5000,  type: 'variable'     },
];

// Data-based default assumptions. These are the researched starting points users
// can tune — and restore to via the per-section "restore defaults" controls.
// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_GROWTH_RATES = {
  growthReturnRate: 7,
  houseGrowthRate: 3,
  cashGrowthRate: 1,
  cryptoGrowthRate: 0,
};

// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_TAX_RATES = {
  stockTaxRate: 37.84,
  cryptoTaxRate: 22,
  customTaxRatePct: 30,
};

const DEFAULT_ASSETS: Assets = {
  portfolio: 0,
  unrealizedGain: 0,
  taxRate: DEFAULT_TAX_RATES.stockTaxRate,
  bsu: 0,
  // Retired scalar: kept at 0 here because DEFAULT_ASSETS doubles as the
  // sanitizePayload schema (number-typed keys mark what gets coerced), so an
  // imported blob with a string "savings" is still coerced before migration.
  savings: 0,
  savingsAccounts: [],
  houseValue: 0,
  houseDebt: 0,
  crypto: 0,
  cryptoUnrealizedGain: 0,
  cryptoTaxRate: DEFAULT_TAX_RATES.cryptoTaxRate,
  bufferAccount: 0,
};

const DEFAULT_HOMEOWNER: HomeownerData = {
  currentMortgageBalance: 3000000,
  originalLoanAmount: 3500000,
  rente: 5.5,
  nedbetalingstid: 25,
  termingebyr: 50,
  skattefradragssats: 22,
};

const DEFAULT_TRANSITION: TransitionData = {
  currentHouseValue: 4500000,
  currentMortgageBalance: 3000000,
  agentFeePercent: 3,
  documentFee: 7500,
  otherSaleCosts: 0,
  bridgeMonths: 2,
  bridgeLoanRate: 6.5,
};

const DEFAULT_LOAN: LoanData = {
  arslonn: 600000,
  eksisterendeGjeld: 0,
  egenkapital: 500000,
  laanebelop: 3000000,
  rente: 5.5,
  nedbetalingstid: 25,
  termingebyr: 50,
  etableringsgebyr: 0,
  skattefradragssats: 22,
  betingetLaan: 2500000,
  kjoepesum: 3500000,
  gyldigTil: '1. jan 2027',
};

// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_PENSION: Pension = {
  otpBalance: 0,
  otpEmployerPct: 5,
  otpEmployeePct: 0,
  otpGrowthRate: 5,
  ipsBalance: 0,
  ipsAnnualContribution: 0,
  ipsGrowthRate: 7,
  birthYear: 0,
  retirementAge: 67,
};

// Single source of the persisted-field list (§8.10). The object-field defaults
// (reused as sanitize schemas and by pages) are injected from the DEFAULT_*
// constants above so the registry module stays free of any context value import.
// Built once at module scope: reads/defaults never change, only the bound state.
const PAYLOAD_REGISTRY = makePayloadRegistry({
  assets: DEFAULT_ASSETS, loan: DEFAULT_LOAN, pension: DEFAULT_PENSION,
  homeowner: DEFAULT_HOMEOWNER, transition: DEFAULT_TRANSITION, fixedExpenses: DEFAULT_FIXED_EXPENSES,
});

// --- Context ---

// The context is split into three slices (§4.1) so a change to one doesn't
// re-render consumers of the others: `Settings` (prefs, display, view-month,
// formatters, onboarding, app status), `Data` (persisted domain state + its
// mutations + demo/persist), and `Derived` (computed values). `useFinance()`
// merges all three for backward compatibility; new code can subscribe to a
// single slice via useFinanceSettings/useFinanceData/useFinanceDerived.
interface FinanceSettingsContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
  displayCurrency: 'NOK' | 'USD' | 'custom';
  setDisplayCurrency: (c: 'NOK' | 'USD' | 'custom') => void;
  nokToUsd: number;
  setNokToUsd: (rate: number) => void;
  customCurrencyCode: string;
  setCustomCurrencyCode: (code: string) => void;
  customCurrencyRate: number;
  setCustomCurrencyRate: (rate: number) => void;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  savingsTargetPercent: number;
  setSavingsTargetPercent: (val: number) => void;
  growthReturnRate: number;
  setGrowthReturnRate: (val: number) => void;
  houseGrowthRate: number;
  setHouseGrowthRate: (val: number) => void;
  cashGrowthRate: number;
  setCashGrowthRate: (val: number) => void;
  cryptoGrowthRate: number;
  setCryptoGrowthRate: (val: number) => void;
  region: Region;
  setRegion: (r: Region) => void;
  customTaxRatePct: number;
  setCustomTaxRatePct: (v: number) => void;
  hiddenNavItems: string[];
  toggleNavItem: (path: string) => void;
  /** Dashboard "market assumptions still on defaults" nudge — dismissed for good. */
  assumptionsNudgeDismissed: boolean;
  dismissAssumptionsNudge: () => void;
  /** Budget "set this month's income" reminder — holds the 'yyyy-MM' the user
   *  last dismissed it for, so it reappears once a new month begins. */
  incomeReminderDismissedMonth: string;
  dismissIncomeReminder: (monthKey: string) => void;
  formatCurrency: (val: number) => string;
  formatCurrencyShort: (val: number) => string;
  restoreGrowthRateDefaults: () => void;
  restoreCustomTaxRateDefault: () => void;
  demoMode: boolean;
  toggleDemoMode: () => void;
  /** First-run guided setup. `onboardingCompleted` persists; `onboardingActive`
   *  drives the tour overlay. `startOnboarding` opens it (Settings "replay"),
   *  `completeOnboarding` marks it done and closes it. */
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  /** 'welcome' opens the essentials-first intro; 'hub' opens the full topic hub. */
  onboardingEntry: 'welcome' | 'hub';
  /** Bumped on every open/reset so the guide remounts fresh. */
  onboardingNonce: number;
  startOnboarding: (entry?: 'welcome' | 'hub') => void;
  /** Full reset: reopen from the welcome and mark the guide not-done. */
  resetGuide: () => void;
  completeOnboarding: () => void;
  dataLoadFailed: boolean;
  /** True when the most recent save failed and changes are pending a retry. */
  saveFailed: boolean;
  /** Manually re-attempt a failed save (used by the "not saved" banner). */
  retrySave: () => void;
  /** True after a newer server version was adopted (concurrent write elsewhere). */
  dataReloaded: boolean;
  /** Dismiss the "data reloaded" banner. */
  dismissDataReloaded: () => void;
}

interface FinanceDataContextType {
  income: number;
  setIncome: (val: number) => void;
  monthlyIncomes: Record<string, number>;
  setMonthlyIncomeForMonth: (monthKey: string, amount: number) => void;
  clearMonthlyIncomeForMonth: (monthKey: string) => void;
  payslips: Record<string, MonthlyPayslip>;
  setPayslip: (monthKey: string, data: MonthlyPayslip) => void;
  removePayslip: (monthKey: string) => void;
  netWorthHistory: Record<string, number>;
  setNetWorthForMonth: (monthKey: string, value: number) => void;
  clearNetWorthForMonth: (monthKey: string) => void;
  balanceSnapshots: Record<string, BalanceSnapshot>;
  /** Backfill/edit a manual snapshot for a past month (source forced to 'manual'). */
  setManualSnapshot: (monthKey: string, snapshot: BalanceSnapshot) => void;
  /** Delete a manual snapshot. Auto snapshots are left alone (they re-capture). */
  deleteManualSnapshot: (monthKey: string) => void;
  fixedExpenses: FixedExpense[];
  setFixedExpenses: (val: FixedExpense[]) => void;
  debts: Debt[];
  setDebts: (val: Debt[]) => void;
  dailyTransactions: DailyTransaction[];
  setDailyTransactions: (val: DailyTransaction[]) => void;
  accountLabels: Record<string, string>;
  setAccountLabel: (accountKey: string, name: string) => void;
  applyBankSync: (txs: DailyTransaction[], rev?: number) => void;
  categoryRules: CategoryRule[];
  addCategoryRule: (match: string, category: CategoryKey) => void;
  removeCategoryRule: (id: string) => void;
  labelRules: LabelRule[];
  addLabelRule: (match: string, label: string) => void;
  removeLabelRule: (id: string) => void;
  removeAccountData: (accountKey: string) => void;
  // Per-account view (Budget page): grouping, current filter, and the analysed
  // transaction set (internal transfers netted out + account filter applied).
  accountGroups: { key: string; label: string; count: number }[];
  dataAccounts: { key: string; bank?: string; accountName?: string }[];
  accountFilter: string | null;
  setAccountFilter: (label: string | null) => void;
  internalTransferIds: Set<string>;
  nonTransferTransactions: DailyTransaction[];
  visibleBudgetTransactions: DailyTransaction[];
  categoryBudgets: Partial<Record<CategoryKey, number>>;
  setCategoryBudget: (category: CategoryKey, amount: number | null) => void;
  recurringTemplates: TransactionTemplate[];
  setRecurringTemplates: (val: TransactionTemplate[]) => void;
  assets: Assets;
  updateAsset: (key: keyof Assets, value: number) => void;
  addSavingsAccount: (name: string, balance: number) => void;
  updateSavingsAccount: (id: string, patch: Partial<Omit<SavingsAccount, 'id'>>) => void;
  removeSavingsAccount: (id: string) => void;
  loan: LoanData;
  updateLoan: (key: keyof LoanData, value: number | string) => void;
  pension: Pension;
  updatePension: (key: keyof Pension, value: number) => void;
  housingMode: HousingMode;
  setHousingMode: (mode: HousingMode) => void;
  homeowner: HomeownerData;
  updateHomeowner: (key: keyof HomeownerData, value: number) => void;
  transition: TransitionData;
  updateTransition: (key: keyof TransitionData, value: number) => void;
  jobs: JobEntry[];
  addJob: (job: Omit<JobEntry, 'id'>) => string;
  updateJob: (id: string, patch: Partial<Omit<JobEntry, 'id'>>) => void;
  removeJob: (id: string) => void;
  salaries: SalaryEntry[];
  addSalary: (entry: Omit<SalaryEntry, 'id'>) => string;
  updateSalary: (id: string, patch: Partial<Omit<SalaryEntry, 'id'>>) => void;
  removeSalary: (id: string) => void;
  bonuses: BonusEntry[];
  addBonus: (entry: Omit<BonusEntry, 'id'>) => void;
  updateBonus: (id: string, patch: Partial<Omit<BonusEntry, 'id'>>) => void;
  removeBonus: (id: string) => void;
  overtime: OvertimeEntry[];
  addOvertime: (entry: Omit<OvertimeEntry, 'id'>) => void;
  updateOvertime: (id: string, patch: Partial<Omit<OvertimeEntry, 'id'>>) => void;
  removeOvertime: (id: string) => void;
  hoursSnapshots: HoursSnapshot[];
  addHoursSnapshot: (entry: Omit<HoursSnapshot, 'id'>) => void;
  updateHoursSnapshot: (id: string, patch: Partial<Omit<HoursSnapshot, 'id'>>) => void;
  removeHoursSnapshot: (id: string) => void;
  goals: Goal[];
  addGoal: (g: Omit<Goal, 'id'>) => void;
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id'>>) => void;
  removeGoal: (id: string) => void;
  employerCostConfig: EmployerCostConfig;
  updateEmployerCostConfig: (key: keyof EmployerCostConfig, value: number) => void;
  billingConfig: BillingRateConfig;
  updateBillingConfig: (key: keyof BillingRateConfig, value: number | null) => void;
  inflation: InflationPoint[];
  inflationStale: boolean;
  wageStats: WageStatPoint[];
  importAll: (data: Partial<ExportPayload>) => void;
  buildPayload: () => ExportPayload;
  resetAll: () => void;
  restoreAssetTaxDefaults: () => void;
  restorePensionAssumptionDefaults: () => void;
  restoreEmployerCostDefaults: () => void;
}

interface FinanceDerivedContextType {
  derivedMonthlyIncome: number;
  grossAnnualIncome: number;
  isMonthlyIncomeOverridden: boolean;
  prevMonthIncome: number;
  prevMonthSpending: number;
  /** This month's discretionary spend, transfer-netted — pair with prevMonthSpending. */
  currentMonthSpending: number;
  effectiveIncome: number;
  averageIncome: number;
  /** Last-12-months net income (override or derived), oldest → newest, keyed by month. */
  incomeSeries: { month: string; value: number }[];
  recommendedSpending: number;
  recommendedInvestment: number;
  suggestedInvestment: number;
  conservativeMode: boolean;
  conservativeReason: ConservativeReason;
  totalDebt: number;
  netWorth: number;
  studentDebt: number;
  mortgageRate: number;
  mortgageTermYears: number;
  totalResidual: number;
  totalFixedExpenses: number;
  /** Fixed expenses for the selected month: live config, or the recorded
   *  snapshot's expenses when viewing a past month (read-only). */
  viewFixedExpenses: FixedExpense[];
  /** True when `viewFixedExpenses` came from a past month's snapshot rather than
   *  live config — Budget shows a "recorded" vs "not recorded" cue accordingly. */
  fixedExpensesFromSnapshot: boolean;
  monthlyBudget: number;
  dailyBudget: number;
  dailyData: DailyDataEntry[];
  reconciliation: Reconciliation;
  totalEquity: number;
  taxOnGain: number;
  netInvestment: number;
  houseEquity: number;
  cryptoTaxOnGain: number;
  netCrypto: number;
}

type FinanceContextType = FinanceSettingsContextType & FinanceDataContextType & FinanceDerivedContextType;

// A full capture of the balance-relevant state as of a given month, so the
// balance pages can be viewed historically once snapshots accumulate. Keyed by
// 'yyyy-MM'. Recorded automatically for the current calendar month.
export interface BalanceSnapshot {
  assets: Assets;
  loan: LoanData;
  pension: Pension;
  homeowner: HomeownerData;
  transition: TransitionData;
  housingMode: HousingMode;
  /** Non-mortgage debts as of that month. Absent on snapshots recorded before
   *  debt historization — those months render equity-only, matching what
   *  `netWorthHistory` recorded at the time. */
  debts?: Debt[];
  /** Snapshot shape version. Absent = v1 (pre-completeness; only the fields
   *  above). v2 adds the optional fields below. New fields stay optional and
   *  guarded at read time so a v1 month never NaN-poisons a reader. */
  v?: number;
  /** Fixed-expense envelopes/budget composition as of that month, so historical
   *  budget-vs-actual uses the amounts that were in force then, not today's. */
  fixedExpenses?: FixedExpense[];
  /** Forward assumptions as of that month, so history-mode projections use the
   *  rates that were set then instead of the live ones. */
  assumptions?: {
    savingsTargetPercent: number;
    growthReturnRate: number;
    houseGrowthRate: number;
  };
  /** Per-category budgets as of that month. */
  categoryBudgets?: Partial<Record<CategoryKey, number>>;
  /** How the snapshot was recorded: 'auto' (the capture effect) or 'manual'
   *  (the backfill editor, Phase 2). Absent = 'auto'. */
  source?: 'auto' | 'manual';
}

export interface ExportPayload {
  income: number;
  fixedExpenses: FixedExpense[];
  dailyTransactions: DailyTransaction[];
  deletedBankIds?: string[];
  /** User-chosen friendly names for connected accounts, keyed by account key. */
  accountLabels?: Record<string, string>;
  /** User-defined categorization rules (merchant/text → category). */
  categoryRules?: CategoryRule[];
  /** User-defined display names for transactions (merchant/text → label). */
  labelRules?: LabelRule[];
  categoryBudgets?: Partial<Record<CategoryKey, number>>;
  debts?: Debt[];
  assets: Assets;
  loan: LoanData;
  pension?: Pension;
  recurringTemplates: TransactionTemplate[];
  monthlyIncomes?: Record<string, number>;
  payslips?: Record<string, MonthlyPayslip>;
  netWorthHistory?: Record<string, number>;
  balanceSnapshots?: Record<string, BalanceSnapshot>;
  housingMode?: HousingMode;
  homeowner?: HomeownerData;
  transition?: TransitionData;
  lang?: Language;
  currentMonth?: string;
  savingsTargetPercent?: number;
  growthReturnRate?: number;
  houseGrowthRate?: number;
  cashGrowthRate?: number;
  cryptoGrowthRate?: number;
  displayCurrency?: 'NOK' | 'USD' | 'custom';
  nokToUsd?: number;
  customCurrencyCode?: string;
  customCurrencyRate?: number;
  jobs?: JobEntry[];
  salaries?: SalaryEntry[];
  bonuses?: BonusEntry[];
  overtime?: OvertimeEntry[];
  hoursSnapshots?: HoursSnapshot[];
  goals?: Goal[];
  region?: Region;
  customTaxRatePct?: number;
  employerCostConfig?: EmployerCostConfig;
  billingConfig?: BillingRateConfig;
  hiddenNavItems?: string[];
  onboardingCompleted?: boolean;
  assumptionsNudgeDismissed?: boolean;
  incomeReminderDismissedMonth?: string;
}

export interface DailyDataEntry {
  date: Date;
  dateStr: string;
  spent: number;         // raw expense total that day (what actually left the account)
  discretionary: number; // portion that drew down the daily budget (spillover + non-enveloped)
  balance: number;
  transactions: DailyTransaction[];
}

// `makeId` (imported from lib/savingsMigration) is module-level so id-minting
// actions stay referentially stable (no closure over component state).

// The add/update/remove triple shared by every id-keyed array entity (jobs,
// salaries, bonuses, overtime, hours snapshots, goals). `add` mints an id and
// returns it (callers that don't need it, e.g. bonuses, ignore the return).
// Built once from a stable useState setter, so the actions stay referentially
// stable (memoize the result with empty deps).
type ArraySetter<T> = (updater: (prev: T[]) => T[]) => void;
function makeCrud<T extends { id: string }>(setter: ArraySetter<T>, prefix: string) {
  return {
    add: (entry: Omit<T, 'id'>): string => {
      const id = makeId(prefix);
      setter(prev => [...prev, { ...entry, id } as T]);
      return id;
    },
    update: (id: string, patch: Partial<Omit<T, 'id'>>): void =>
      setter(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x))),
    remove: (id: string): void => setter(prev => prev.filter(x => x.id !== id)),
  };
}

// `migrateSavingsAccounts` / `migrateSnapshotSavings` moved to
// lib/savingsMigration.ts so the payload registry (and its tests) can apply them
// without pulling in React; the registry now owns the assets/snapshot reads.

const FinanceSettingsContext = createContext<FinanceSettingsContextType | undefined>(undefined);
const FinanceDataContext = createContext<FinanceDataContextType | undefined>(undefined);
const FinanceDerivedContext = createContext<FinanceDerivedContextType | undefined>(undefined);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('nb');
  const [displayCurrency, setDisplayCurrency] = useState<'NOK' | 'USD' | 'custom'>('NOK');
  const [nokToUsd, setNokToUsdState] = useState<number>(0.093);
  const [customCurrencyCode, setCustomCurrencyCode] = useState<string>('');
  const [customCurrencyRate, setCustomCurrencyRate] = useState<number>(1);

  const setNokToUsd = (rate: number) => setNokToUsdState(rate);

  const t = translations[lang];

  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const [income, setIncome] = useState<number>(55000);
  const [monthlyIncomes, setMonthlyIncomes] = useState<Record<string, number>>({});
  const [payslips, setPayslips] = useState<Record<string, MonthlyPayslip>>({});
  const [netWorthHistory, setNetWorthHistory] = useState<Record<string, number>>({});
  const [balanceSnapshots, setBalanceSnapshots] = useState<Record<string, BalanceSnapshot>>({});
  const [savingsTargetPercent, setSavingsTargetPercent] = useState<number>(20);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(DEFAULT_FIXED_EXPENSES);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>([]);
  // Ids of bank-imported (eb-) rows the user deleted. Persisted so the server's
  // sync/reconcile can't resurrect them (see server/bank.js mergeTransactions).
  const [deletedBankIds, setDeletedBankIds] = useState<string[]>([]);
  // Friendly names for connected accounts, keyed by the transaction `account`
  // key (e.g. 'ab12:uid-1'). Empty string clears back to the bank-provided name.
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  // User-defined categorization rules (merchant/text → category), applied ahead
  // of the built-in engine at the ingest/backfill chokepoint.
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  // Custom transaction display names (merchant/text → label), applied at render.
  const [labelRules, setLabelRules] = useState<LabelRule[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<Partial<Record<CategoryKey, number>>>({});
  const [recurringTemplates, setRecurringTemplates] = useState<TransactionTemplate[]>([]);
  const [assets, setAssets] = useState<Assets>(DEFAULT_ASSETS);
  const [loan, setLoan] = useState<LoanData>(DEFAULT_LOAN);
  const [pension, setPension] = useState<Pension>(DEFAULT_PENSION);
  const [housingMode, setHousingMode] = useState<HousingMode>('first_buyer');
  const [homeowner, setHomeowner] = useState<HomeownerData>(DEFAULT_HOMEOWNER);
  const [transition, setTransition] = useState<TransitionData>(DEFAULT_TRANSITION);
  const [growthReturnRate, setGrowthReturnRate] = useState<number>(DEFAULT_GROWTH_RATES.growthReturnRate);
  const [houseGrowthRate, setHouseGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.houseGrowthRate);
  const [cashGrowthRate, setCashGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.cashGrowthRate);
  const [cryptoGrowthRate, setCryptoGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.cryptoGrowthRate);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [salaries, setSalaries] = useState<SalaryEntry[]>([]);
  const [bonuses, setBonuses] = useState<BonusEntry[]>([]);
  const [overtime, setOvertime] = useState<OvertimeEntry[]>([]);
  const [hoursSnapshots, setHoursSnapshots] = useState<HoursSnapshot[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [inflation, setInflation] = useState<InflationPoint[]>([]);
  const [inflationStale, setInflationStale] = useState<boolean>(false);
  const [wageStats, setWageStats] = useState<WageStatPoint[]>([]);
  const [region, setRegion] = useState<Region>('no');
  const [customTaxRatePct, setCustomTaxRatePct] = useState<number>(DEFAULT_TAX_RATES.customTaxRatePct);
  const [employerCostConfig, setEmployerCostConfig] = useState<EmployerCostConfig>(DEFAULT_EMPLOYER_COST_CONFIG);
  const [billingConfig, setBillingConfig] = useState<BillingRateConfig>(DEFAULT_BILLING_CONFIG);
  const [hiddenNavItems, setHiddenNavItems] = useState<string[]>([]);
  const [assumptionsNudgeDismissed, setAssumptionsNudgeDismissed] = useState(false);
  const [incomeReminderDismissedMonth, setIncomeReminderDismissedMonth] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  // First-run guided setup. `onboardingCompleted` is the persisted flag;
  // `onboardingActive` (not persisted) is whether the tour overlay is showing.
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  // Where the guide opens: 'welcome' = the short essentials-first intro (new
  // users / reset), 'hub' = straight to the full topic hub (manual replay).
  const [onboardingEntry, setOnboardingEntry] = useState<'welcome' | 'hub'>('welcome');
  // Bumped on every open/reset so the guide panel always remounts fresh (picks
  // up the right entry phase) even when it was already open.
  const [onboardingNonce, setOnboardingNonce] = useState(0);

  const loaded = useRef(false);
  // Holds the user's real data while demo mode is active, so it can be restored
  // on exit. In-memory only — a page reload exits demo mode and reloads the real
  // data from the backend (which demo mode never overwrites).
  const demoSnapshot = useRef<Partial<ExportPayload> | null>(null);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Optimistic-concurrency revision last seen from the server; echoed on every
  // save so a stale write is rejected instead of clobbering a newer one.
  const revRef = useRef(0);
  // Stable-stringified content the server is known to hold (set on load, on
  // adopting a newer version, and after each successful save). doSave skips the
  // POST when the built payload matches it, so merely opening the app doesn't
  // bump the rev and trigger 409s in other open clients (3.2) — while load-time
  // migrations/sanitize fixes still differ and therefore still self-persist.
  const lastSyncedRef = useRef<string | null>(null);
  // True after we adopted a newer server version (another tab/device or the bank
  // cron wrote in between) — surfaced as a dismissable banner.
  const [dataReloaded, setDataReloaded] = useState(false);

  // Exposed setter that records soft-deletes: when a bank-imported (eb-) row is
  // removed, remember its id in `deletedBankIds` so the server won't re-add it on
  // the next sync/reconcile. Edits (row still present) are unaffected.
  const setDailyTransactionsTracked = useCallback((val: DailyTransaction[]) => {
    const nextIds = new Set(val.map((t) => t.id));
    const removedEb = dailyTransactions
      .filter((t) => typeof t.id === 'string' && t.id.startsWith('eb-') && !nextIds.has(t.id))
      .map((t) => t.id);
    if (removedEb.length) {
      setDeletedBankIds((ids) => Array.from(new Set([...ids, ...removedEb])));
    }
    setDailyTransactions(val);
  }, [dailyTransactions]);

  // ── Persist payload: single source of shape (§4.2) ──────────────────────────
  // The one place that projects app state → the persisted/exported blob. Used by
  // autosave, the demo snapshot, and Settings export. `currentMonth` is view
  // state and is added by the callers that need it, not here.
  // The field literal is projected through the registry (`derivePayload`), so its
  // key type is `BuiltPayload` — omitting any persisted field FAILS TO COMPILE.
  const buildPayload = useCallback((): ExportPayload => derivePayload(PAYLOAD_REGISTRY, {
    income, monthlyIncomes, payslips, netWorthHistory, balanceSnapshots, fixedExpenses,
    dailyTransactions, deletedBankIds, accountLabels, categoryRules, labelRules, categoryBudgets, debts, assets, loan, pension, recurringTemplates,
    housingMode, homeowner, transition, lang,
    savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate,
    displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate,
    jobs, salaries, bonuses, overtime, hoursSnapshots, goals,
    region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems, onboardingCompleted,
    assumptionsNudgeDismissed, incomeReminderDismissedMonth,
  }), [income, monthlyIncomes, payslips, netWorthHistory, balanceSnapshots, fixedExpenses,
    dailyTransactions, deletedBankIds, accountLabels, categoryRules, labelRules, categoryBudgets, debts, assets, loan, pension, recurringTemplates,
    housingMode, homeowner, transition, lang, savingsTargetPercent, growthReturnRate,
    houseGrowthRate, cashGrowthRate, cryptoGrowthRate, displayCurrency, nokToUsd,
    customCurrencyCode, customCurrencyRate, jobs, salaries, bonuses, overtime, hoursSnapshots,
    goals, region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems, onboardingCompleted,
    assumptionsNudgeDismissed, incomeReminderDismissedMonth]);

  // The one place that applies a loaded/imported blob → app state (§4.2), with
  // sanitization at the boundary (§1.5). `resetMissing` is the ONLY difference
  // between the two callers: on load (resetMissing=true) an absent Group-A field
  // resets to its default (state is fresh); on import/demo (false) it's left as
  // the current value. Group-B fields apply only when present in both paths.
  const applyPayload = useCallback((raw: Partial<ExportPayload> | null, resetMissing: boolean) => {
    if (raw == null) return; // first-run (null DB) / no snapshot → keep current state
    const data = sanitizePayload(raw, {
      assets: DEFAULT_ASSETS, loan: DEFAULT_LOAN, pension: DEFAULT_PENSION,
      homeowner: DEFAULT_HOMEOWNER, transition: DEFAULT_TRANSITION,
      employerCostConfig: DEFAULT_EMPLOYER_COST_CONFIG, billingConfig: DEFAULT_BILLING_CONFIG,
    });
    // Bind the persisted-field registry to the raw React state setters (the
    // `PayloadSetters` type makes this map exhaustive — a new field won't compile
    // until it's wired). `currentMonth` is view state and is in neither map.
    const setters: PayloadSetters = {
      income: setIncome, monthlyIncomes: setMonthlyIncomes, payslips: setPayslips,
      netWorthHistory: setNetWorthHistory, balanceSnapshots: setBalanceSnapshots,
      fixedExpenses: setFixedExpenses, dailyTransactions: setDailyTransactions,
      deletedBankIds: setDeletedBankIds, accountLabels: setAccountLabels, categoryRules: setCategoryRules,
      labelRules: setLabelRules, categoryBudgets: setCategoryBudgets, debts: setDebts, assets: setAssets,
      loan: setLoan, pension: setPension, recurringTemplates: setRecurringTemplates,
      housingMode: setHousingMode, homeowner: setHomeowner, transition: setTransition, lang: setLang,
      savingsTargetPercent: setSavingsTargetPercent, growthReturnRate: setGrowthReturnRate,
      houseGrowthRate: setHouseGrowthRate, cashGrowthRate: setCashGrowthRate, cryptoGrowthRate: setCryptoGrowthRate,
      displayCurrency: setDisplayCurrency, nokToUsd: setNokToUsdState, customCurrencyCode: setCustomCurrencyCode,
      customCurrencyRate: setCustomCurrencyRate, jobs: setJobs, salaries: setSalaries, bonuses: setBonuses,
      overtime: setOvertime, hoursSnapshots: setHoursSnapshots, goals: setGoals, region: setRegion,
      customTaxRatePct: setCustomTaxRatePct, employerCostConfig: setEmployerCostConfig,
      billingConfig: setBillingConfig, hiddenNavItems: setHiddenNavItems,
      onboardingCompleted: setOnboardingCompleted, assumptionsNudgeDismissed: setAssumptionsNudgeDismissed,
      incomeReminderDismissedMonth: setIncomeReminderDismissedMonth,
    };
    applyPersistedFields(PAYLOAD_REGISTRY, setters, data, resetMissing);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ATTEMPTS = 3;

    // Retry the initial load a few times: a transient miss (e.g. a network
    // hiccup around service-worker activation) otherwise leaves the app showing
    // empty defaults until a manual refresh. Crucially, `loaded.current` is set
    // ONLY on a successful response — including a genuinely empty DB (data ===
    // null on first run, which should be allowed to seed). If every attempt
    // fails we leave it false so the auto-save effect can never overwrite the
    // stored data with empty defaults.
    const load = async () => {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const r = await fetch('/api/data');
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (cancelled) return;
          revRef.current = Number(r.headers.get('X-Data-Rev') ?? 0);
          lastSyncedRef.current = data === null ? null : stableStringify(data);
          applyPayload(data, true);
          loaded.current = true;
          // Launch the first-run guided setup for a brand-new user (empty DB →
          // data === null) or one who reloaded mid-tour (flag explicitly false).
          // First-run always opens the gentle essentials-first welcome.
          if (data === null || data?.onboardingCompleted === false) {
            setOnboardingEntry('welcome');
            setOnboardingNonce(n => n + 1);
            setOnboardingActive(true);
          }
          return;
        } catch {
          if (attempt < ATTEMPTS) {
            await new Promise(res => setTimeout(res, attempt * 400));
          }
        }
      }
      if (!cancelled) setDataLoadFailed(true);
    };

    load();
    return () => { cancelled = true; };
  }, [applyPayload]);

  // Fetch SSB wage statistics when region is Norway. Hidden in generic mode.
  useEffect(() => {
    if (region !== 'no') {
      // Intentional reset of fetched data when leaving Norway region.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWageStats([]);
      return;
    }
    fetch('/api/wage-stats')
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (data && Array.isArray(data.points)) setWageStats(data.points);
      })
      .catch(() => {});
  }, [region]);

  // Fetch SSB inflation data when region is Norway. In 'generic' mode we
  // don't have inflation source for the user's country, so we skip the call
  // and the UI hides inflation-dependent features.
  useEffect(() => {
    if (region !== 'no') {
      // Intentional reset of fetched data when leaving Norway region.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInflation([]);
      setInflationStale(false);
      return;
    }
    const now = new Date();
    const to = format(now, 'yyyy-MM');
    const from = format(new Date(now.getFullYear() - 12, now.getMonth(), 1), 'yyyy-MM');
    fetch(`/api/inflation?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) { setInflationStale(true); return; }
        if (Array.isArray(data.points)) setInflation(data.points);
        if (data.stale) setInflationStale(true);
      })
      .catch(() => setInflationStale(true));
  }, [region]);

  // Auto-save plumbing. The save is debounced (a slider drag or paging the month
  // picker would otherwise fire dozens of full-state POSTs), in-flight requests
  // are aborted so a slow save can't land after a newer one (last-write-wins with
  // a stale payload), failures surface a banner + retry with backoff, and pending
  // changes are flushed on tab hide/close so nothing is silently lost.
  const payloadRef = useRef<ExportPayload | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const saveDirty = useRef(false);
  const saveRetries = useRef(0);
  // Lets the backoff retry re-invoke the latest doSave without the callback
  // referencing itself before it's declared.
  const doSaveRef = useRef<() => void>(() => {});

  const doSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const payload = payloadRef.current;
    if (!payload) return;
    // No-op save: state churn (load, adopt, snapshot effects) re-triggers the
    // autosave path with content the server already has — skip the network.
    const stable = stableStringify(payload);
    if (stable === lastSyncedRef.current) {
      saveDirty.current = false;
      saveRetries.current = 0;
      return;
    }
    // Supersede any in-flight save so it can't complete after this one.
    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Data-Rev': String(revRef.current) },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (res.status === 409) {
        // A newer write landed (another tab/device or the bank cron). Adopt the
        // server's version rather than clobber it, and warn the user.
        const body = await res.json().catch(() => null);
        if (body && body.current) {
          revRef.current = Number(body.currentRev ?? revRef.current);
          lastSyncedRef.current = stableStringify(body.current);
          applyPayload(body.current, true);
          saveDirty.current = false;
          saveRetries.current = 0;
          setSaveFailed(false);
          setDataReloaded(true);
        }
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      revRef.current = Number(res.headers.get('X-Data-Rev') ?? revRef.current + 1);
      lastSyncedRef.current = stable;
      saveDirty.current = false;
      saveRetries.current = 0;
      setSaveFailed(false);
    } catch {
      if (ctrl.signal.aborted) return; // replaced by a newer save — not a failure
      setSaveFailed(true);
      // Exponential backoff, capped at 30s. saveDirty stays true.
      saveRetries.current += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** (saveRetries.current - 1));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { doSaveRef.current(); }, delay);
    }
  }, [applyPayload]);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  // When a backgrounded tab regains focus, pull the latest before it can autosave
  // stale data over a newer write. Skipped if there are unsaved local edits
  // (saveDirty) so we never silently discard the user's work — that case is left
  // to the save-time 409 handler.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!loaded.current || demoMode || saveDirty.current) return;
      try {
        const r = await fetch('/api/data');
        if (!r.ok) return;
        const serverRev = Number(r.headers.get('X-Data-Rev') ?? 0);
        if (serverRev > revRef.current) {
          const data = await r.json();
          revRef.current = serverRev;
          lastSyncedRef.current = data === null ? null : stableStringify(data);
          applyPayload(data, true);
          setDataReloaded(true);
        }
      } catch { /* offline — ignore */ }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [applyPayload, demoMode]);

  // Manual retry from the banner.
  const retrySave = useCallback(() => { saveRetries.current = 0; void doSave(); }, [doSave]);

  useEffect(() => {
    if (!loaded.current) return;
    // Never persist while showing demo data — that would clobber the user's real
    // data on the backend. The real data stays safe in `demoSnapshot` until exit.
    if (demoMode) return;
    payloadRef.current = buildPayload();
    saveDirty.current = true;
    // Debounce: reschedule on every change; the trailing call flushes once quiet.
    saveRetries.current = 0;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void doSave(); }, 500);
    // NB: `currentMonth` is deliberately NOT persisted or in these deps — it's
    // view state, so paging the month picker must not fire saves, and two devices
    // shouldn't fight over which month is "current".
    // buildPayload changes whenever any persisted field changes, so it's the
    // single trigger for a save — no need to re-list every field here.
  }, [buildPayload, demoMode, doSave]);

  // Flush pending changes when the tab is hidden or closed. sendBeacon survives
  // page teardown where a normal fetch would be cancelled; the server accepts the
  // JSON blob the same as a normal POST.
  useEffect(() => {
    const flush = () => {
      if (!loaded.current || demoMode || !saveDirty.current || !payloadRef.current) return;
      // Same no-op check as doSave: closing a tab whose state matches the
      // server must not bump the rev.
      if (stableStringify(payloadRef.current) === lastSyncedRef.current) {
        saveDirty.current = false;
        return;
      }
      // sendBeacon can't set headers, so the optimistic-concurrency rev rides
      // inside the body; the server reads `_rev` as the X-Data-Rev fallback and
      // strips it before storing. Without it this flush would be
      // last-write-wins and could clobber what another tab/device just wrote.
      const ok = navigator.sendBeacon?.(
        '/api/data',
        new Blob([JSON.stringify({ ...payloadRef.current, _rev: revRef.current })], { type: 'application/json' }),
      );
      if (ok) saveDirty.current = false;
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only nag when a save is actually failing — a clean close flushes via the
      // beacon above, so we don't want to prompt on every debounced edit.
      if (saveFailed && saveDirty.current && !demoMode) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [demoMode, saveFailed]);

  // Auto-categorize the single ingest chokepoint for bank-synced rows, imports,
  // and legacy backfill. Two cases are (re)labelled by the deterministic rule
  // engine: rows with no category, and auto-labelled 'other' rows (so when the
  // ruleset improves — e.g. new MCC/keyword coverage — the existing "Annet" pile
  // upgrades itself on next load without a manual re-sync). Manual labels and
  // already-confident auto labels are never touched. Loop-safe: it only writes
  // when a row actually changes, so once nothing more can be matched it stops.
  useEffect(() => {
    let changed = false;
    const next = dailyTransactions.map((t) => {
      if (t.categorySource === 'manual') return t;         // respect user edits
      const ruleHit = categorizeWithRules({ merchant: t.merchant, description: t.description, mcc: t.mcc, kind: t.kind }, categoryRules);
      // A user rule wins over any auto label; add/remove a rule and matching rows
      // re-label. Without a rule, keep confident auto labels and only (re)label
      // the unlabeled / auto-'other' pile as the built-in ruleset improves.
      const matchedByRule = categoryRules.some((r) => {
        const m = (r.match || '').trim().toLowerCase();
        return m && ` ${t.merchant ?? ''} ${t.description ?? ''} `.toLowerCase().includes(m);
      });
      if (!matchedByRule && t.category && t.category !== 'other') return t;
      if (ruleHit.category === t.category) return t;
      changed = true;
      return { ...t, category: ruleHit.category, categorySource: ruleHit.source };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (changed) setDailyTransactions(next);
  }, [dailyTransactions, categoryRules]);

  // --- Calculations ---

  const monthKey = format(currentMonth, 'yyyy-MM');
  const prevMonthKey = format(subMonths(currentMonth, 1), 'yyyy-MM');
  const prevMonthIncome = monthlyIncomes[prevMonthKey] ?? 0;

  // The fixed expenses to *view* for the selected month. Live config for the
  // current (and future) month; for a past month with a recorded snapshot, that
  // month's captured expenses, so budget/envelope math reflects what was actually
  // fixed then rather than today's amounts. Editors always mutate live
  // `fixedExpenses`; this is read-only view data (see BudgetPage's read-only gate).
  const fixedExpensesFromSnapshot = monthKey < currentMonthKey()
    && balanceSnapshots[monthKey]?.fixedExpenses !== undefined;
  const viewFixedExpenses = fixedExpensesFromSnapshot
    ? balanceSnapshots[monthKey].fixedExpenses!
    : fixedExpenses;

  const totalFixedExpenses = useMemo(() =>
    viewFixedExpenses.reduce((sum, item) => sum + item.amount, 0),
  [viewFixedExpenses]);

  // Derived monthly net income from the salary system (latest applicable salary + on-call → tax → net).
  // Falls back to the legacy static `income` when no salaries have been entered.
  // Net monthly income derived from the salary system for an arbitrary month
  // (falls back to the legacy static `income` when no salaries exist).
  const derivedNetMonthlyFor = useCallback((mKey: string): number => {
    if (salaries.length === 0) return income;
    const totalAnnual = calcActiveGrossAnnual(salaries, jobs, mKey);
    if (totalAnnual === 0) return income;
    const baseNetAnnual = calcTaxByRegion(totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution).netAnnual;
    // Bonus/overtime entries opted into the budget: fold this month's opted-in
    // gross into the annual gross (so it's taxed at the marginal rate) and deliver
    // the after-tax value in the month it lands, not smeared across the year.
    const extraGross =
      bonuses.reduce((s, b) => (b.includeInBudget && b.date.startsWith(mKey) ? s + b.amount : s), 0) +
      overtime.reduce((s, o) => (o.includeInBudget && o.date.startsWith(mKey) ? s + o.amount : s), 0);
    if (extraGross <= 0) return Math.round(baseNetAnnual / 12);
    const netWithExtra = calcTaxByRegion(totalAnnual + extraGross, region, customTaxRatePct, pension.ipsAnnualContribution).netAnnual;
    return Math.round(baseNetAnnual / 12 + (netWithExtra - baseNetAnnual));
  }, [salaries, jobs, region, customTaxRatePct, income, pension.ipsAnnualContribution, bonuses, overtime]);

  const derivedMonthlyIncome = useMemo(
    () => derivedNetMonthlyFor(monthKey),
    [derivedNetMonthlyFor, monthKey],
  );

  // Gross annual employment income active this month (before tax) — falls back to
  // the legacy static `income` annualised when no salaries have been entered.
  const grossAnnualIncome = useMemo(() => {
    const fromSalaries = calcActiveGrossAnnual(salaries, jobs, monthKey);
    if (fromSalaries > 0) return fromSalaries;
    return income * 12;
  }, [salaries, jobs, monthKey, income]);

  const isMonthlyIncomeOverridden = monthlyIncomes[monthKey] !== undefined;

  const effectiveIncome = useMemo(() =>
    monthlyIncomes[monthKey] ?? derivedMonthlyIncome,
  [monthlyIncomes, monthKey, derivedMonthlyIncome]);

  // Last-12-months income series (relative to the selected month): each month is
  // its manual override if set, otherwise the income derived for THAT month. This
  // reflects real income history — averaging only the overrides map (any months
  // ever set, including the future) badly skews the mean and volatility.
  const incomeSeries = useMemo(
    () => lastNMonthKeys(currentMonth, 12).map((mKey) => ({
      month: mKey,
      value: monthlyIncomes[mKey] ?? derivedNetMonthlyFor(mKey),
    })),
    [monthlyIncomes, currentMonth, derivedNetMonthlyFor],
  );

  const averageIncome = useMemo(
    () => Math.round(incomeSeries.reduce((s, p) => s + p.value, 0) / incomeSeries.length),
    [incomeSeries],
  );

  const incomeVolatility = useMemo(() => {
    // Divide by the EXACT mean (not the rounded averageIncome).
    const mean = incomeSeries.reduce((s, p) => s + p.value, 0) / incomeSeries.length;
    if (mean <= 0) return 0;
    const variance = incomeSeries.reduce((s, p) => s + Math.pow(p.value - mean, 2), 0) / incomeSeries.length;
    return Math.sqrt(variance) / mean;
  }, [incomeSeries]);

  const { recommendedSpending, recommendedInvestment, suggestedInvestment, conservativeMode, conservativeReason } = useMemo(() =>
    calcRecommendations(effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent),
  [effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent]);

  const setMonthlyIncomeForMonth = useCallback((key: string, amount: number) => {
    setMonthlyIncomes(prev => ({ ...prev, [key]: amount }));
  }, []);

  const clearMonthlyIncomeForMonth = useCallback((key: string) => {
    setMonthlyIncomes(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const setPayslip = useCallback((key: string, data: MonthlyPayslip) => {
    setPayslips(prev => ({ ...prev, [key]: data }));
  }, []);

  const removePayslip = useCallback((key: string) => {
    setPayslips(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Manually record (or correct) the net worth for a past month, so the history
  // chart reflects the user's real numbers instead of interpolated estimates.
  // The current real month is not edited here — it auto-snapshots from live equity.
  const setNetWorthForMonth = useCallback((key: string, value: number) => {
    setNetWorthHistory(prev => ({ ...prev, [key]: Math.round(value) }));
  }, []);

  const clearNetWorthForMonth = useCallback((key: string) => {
    setNetWorthHistory(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Backfill/edit a manual snapshot for a past month. Forces source:'manual' and
  // v:2 so it's distinguishable from auto captures and safe to delete later. The
  // auto-capture effect only ever targets the real current month, so a manual
  // snapshot for any other month is never overwritten.
  const setManualSnapshot = useCallback((monthKey: string, snapshot: BalanceSnapshot) => {
    setBalanceSnapshots(prev => ({ ...prev, [monthKey]: { ...snapshot, source: 'manual', v: 2 } }));
  }, []);

  const deleteManualSnapshot = useCallback((monthKey: string) => {
    setBalanceSnapshots(prev => {
      if (prev[monthKey]?.source !== 'manual') return prev; // never delete auto captures
      const next = { ...prev };
      delete next[monthKey];
      return next;
    });
  }, []);

  const totalResidual = effectiveIncome - totalFixedExpenses;
  const monthlyBudget = recommendedSpending;
  const daysInMonth = getDaysInMonth(currentMonth);
  const dailyBudget = monthlyBudget / daysInMonth;

  const monthInterval = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const transactionsForMonth = useMemo(() => {
    return dailyTransactions.filter(t => {
      const date = parseISO(t.date);
      return date >= startOfMonth(currentMonth) && date <= endOfMonth(currentMonth);
    });
  }, [dailyTransactions, currentMonth]);

  // Envelope reconciliation: fixed expenses linked to a tracked category are
  // reserved up front (in totalFixedExpenses) AND their real transactions draw the
  // envelope down instead of hitting the daily budget a second time. Single source
  // of truth shared with the budget UI and charts (src/lib/envelopes.ts).
  const reconciliation = useMemo(
    () => reconcile(viewFixedExpenses, dailyTransactions, monthKey),
    [viewFixedExpenses, dailyTransactions, monthKey],
  );

  // Money moved between two of the user's own connected accounts double-counts
  // as an expense + an income; net those pairs out of the budget analysis.
  const internalTransferIds = useMemo(() => findInternalTransferIds(dailyTransactions), [dailyTransactions]);
  // All accounts, internal transfers removed — for whole-finance surfaces (e.g.
  // the savings rate) that shouldn't be narrowed to one account.
  const nonTransferTransactions = useMemo(
    () => dailyTransactions.filter((tx) => !internalTransferIds.has(tx.id)),
    [dailyTransactions, internalTransferIds],
  );

  // Both sides of the "vs last month" chip, measured identically: income and
  // internal transfers excluded, envelope-covered spend excluded — only
  // discretionary spend counts, so the chip compares like with like instead of
  // counting salary deposits or own-account moves as spending. (dailyData's
  // totalSpent is close but not identical: it is built from the raw month
  // transactions, so a transfer's expense leg still counts there.)
  const prevMonthSpending = useMemo(
    () => discretionarySpendForMonth(nonTransferTransactions, fixedExpenses, prevMonthKey),
    [nonTransferTransactions, fixedExpenses, prevMonthKey],
  );
  const currentMonthSpending = useMemo(
    () => discretionarySpendForMonth(nonTransferTransactions, viewFixedExpenses, monthKey),
    [nonTransferTransactions, viewFixedExpenses, monthKey],
  );

  // Per-account view (Budget page only, not persisted). Accounts are grouped by
  // their display label, so giving two accounts the same name merges them here.
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const accountGroups = useMemo(() => {
    // Group by the specific account (key), display its label. Accounts merge only
    // when they share a custom label (that becomes their shared key).
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const tx of dailyTransactions) {
      const key = accountGroupKey(tx, accountLabels);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { key, label: accountGroupLabel(tx, accountLabels) || key, count: 1 });
    }
    const groups = [...map.values()].sort((a, b) => b.count - a.count);
    // Disambiguate accounts that show the same label but are different accounts
    // (e.g. two unlabeled accounts under the same holder name) by a short suffix.
    const labelCounts = new Map<string, number>();
    for (const g of groups) labelCounts.set(g.label, (labelCounts.get(g.label) ?? 0) + 1);
    for (const g of groups) {
      if ((labelCounts.get(g.label) ?? 0) > 1 && g.key.includes(':')) g.label = `${g.label} · ${(g.key.split(':').pop() ?? '').slice(-4)}`;
    }
    return groups;
  }, [dailyTransactions, accountLabels]);
  // Distinct account identities seen in the transaction data (key + bank + the
  // bank-provided name). Includes historical/orphaned accounts no longer in a
  // live connection, so they can still be renamed/merged.
  const dataAccounts = useMemo(() => {
    const seen = new Map<string, { key: string; bank?: string; accountName?: string }>();
    for (const tx of dailyTransactions) {
      if (tx.account && !seen.has(tx.account)) seen.set(tx.account, { key: tx.account, bank: tx.bank, accountName: tx.accountName });
    }
    return [...seen.values()];
  }, [dailyTransactions]);
  // The transaction set the Budget spending analysis uses: internal transfers
  // removed, then narrowed to the selected account group (all when unset).
  const visibleBudgetTransactions = useMemo(
    () => (accountFilter == null
      ? nonTransferTransactions
      : nonTransferTransactions.filter((tx) => accountGroupKey(tx, accountLabels) === accountFilter)),
    [nonTransferTransactions, accountFilter, accountLabels],
  );

  const dailyData: DailyDataEntry[] = useMemo(() => {
    const orderedDays = monthInterval.map(day => format(day, 'yyyy-MM-dd'));
    // Envelope-covered spend is excluded from the running balance; only the
    // discretionary portion (spillover past a full envelope + all non-enveloped
    // spend) draws it down.
    const points = runningEnvelopeBalance(orderedDays, transactionsForMonth, dailyBudget, reconciliation);
    return monthInterval.map((day, i) => {
      const dateStr = orderedDays[i];
      const point = points[i];
      return {
        date: day,
        dateStr,
        spent: point.spent,
        discretionary: point.discretionary,
        balance: point.balance,
        transactions: transactionsForMonth.filter(t => t.date === dateStr),
      };
    });
  }, [monthInterval, transactionsForMonth, dailyBudget, reconciliation]);

  // Latent tax floored at 0: a loss (negative gain) is not a liquid asset, so it
  // must not inflate net worth. The UI clamps inputs ≥0 but JSON import does not.
  const { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, totalEquity } = computeEquityBreakdown(assets);
  // `totalEquity` is the asset-side figure (mortgage already netted in houseEquity).
  // Non-mortgage debts reduce it further to give true net worth.
  const totalDebt = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
  const netWorth = totalEquity - totalDebt;
  // Student loans are "soft" debt (low-interest, human-capital) whose real bite
  // is on borrowing capacity, not wealth. Surface net worth excluding it so a big
  // studielån doesn't make the headline equity read poorer than it feels; it
  // still counts fully in totalDebt (so gjeldsgrad/låneevne are unaffected).
  const studentDebt = sumDebtByType(debts, 'student');
  // Single source of truth for the mortgage rate/term used by net-worth projections,
  // selected by the active housing mode (first-buyer & transitioning use the `loan`
  // inputs; homeowner uses the `homeowner` inputs).
  const mortgageRate = housingMode === 'homeowner' ? homeowner.rente : loan.rente;
  const mortgageTermYears = housingMode === 'homeowner' ? homeowner.nedbetalingstid : loan.nedbetalingstid;

  // Snapshot current month's net worth (equity − non-mortgage debt, matching the
  // Dashboard headline) whenever it changes (only for the current real month)
  useEffect(() => {
    if (!loaded.current) return;
    if (monthKey !== format(new Date(), 'yyyy-MM')) return;
    // Deliberate: snapshot the current month's net worth into persisted state when it changes.
    // Returning `prev` unchanged when the value already matches keeps a plain
    // load/reload from dirtying the data (3.2).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNetWorthHistory(prev => {
      const v = Math.round(netWorth);
      return prev[monthKey] === v ? prev : { ...prev, [monthKey]: v };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netWorth]);

  // Capture the full balance state for the current calendar month whenever it
  // changes, so the balance pages can be viewed historically later. This state is
  // not month-scoped, so we always target the real current month regardless of the
  // selected month.
  useEffect(() => {
    if (!loaded.current) return;
    const nowKey = format(new Date(), 'yyyy-MM');
    const snap: BalanceSnapshot = {
      assets, loan, pension, homeowner, transition, housingMode, debts,
      v: 2,
      fixedExpenses,
      assumptions: { savingsTargetPercent, growthReturnRate, houseGrowthRate },
      categoryBudgets,
      source: 'auto',
    };
    // Skip the rewrite when the stored snapshot is structurally identical —
    // the slices get fresh identities on every load/adopt, and rewriting the
    // entry anyway would dirty the data on a plain open (3.2).
    setBalanceSnapshots(prev => (
      prev[nowKey] && stableStringify(prev[nowKey]) === stableStringify(snap)
        ? prev
        : { ...prev, [nowKey]: snap }
    ));
  }, [assets, loan, pension, homeowner, transition, housingMode, debts,
      fixedExpenses, savingsTargetPercent, growthReturnRate, houseGrowthRate, categoryBudgets]);

  // The current home's value and mortgage are one real quantity stored in three
  // slices (assets drives net worth; homeowner drives LTV/payment; transition
  // drives the sale math). Keep them in lockstep no matter which page edits, so
  // the pages can never show contradictory numbers. (Previously only
  // assets↔homeowner were mirrored, and only in homeowner mode — the transition
  // slice drifted, and demo data seeded all three independently.)
  const updateAsset = useCallback((key: keyof Assets, value: number) => {
    setAssets(prev => ({ ...prev, [key]: value }));
    if (key === 'houseDebt') {
      setHomeowner(prev => ({ ...prev, currentMortgageBalance: value }));
      setTransition(prev => ({ ...prev, currentMortgageBalance: value }));
    }
    if (key === 'houseValue') {
      setTransition(prev => ({ ...prev, currentHouseValue: value }));
    }
  }, []);

  // savingsAccounts is nested in `assets`; adapt setAssets to the array-setter
  // shape so it shares the same CRUD triple as the top-level entities.
  const savingsCrud = useMemo(
    () => makeCrud<SavingsAccount>(
      updater => setAssets(prev => ({ ...prev, savingsAccounts: updater(prev.savingsAccounts ?? []) })),
      'sav',
    ),
    [],
  );
  const addSavingsAccount = useCallback((name: string, balance: number) => {
    savingsCrud.add({ name, balance });
  }, [savingsCrud]);
  const updateSavingsAccount = savingsCrud.update;
  const removeSavingsAccount = savingsCrud.remove;

  const updateLoan = useCallback((key: keyof LoanData, value: number | string) => {
    setLoan(prev => ({ ...prev, [key]: value }));
  }, []);

  const updatePension = useCallback((key: keyof Pension, value: number) => {
    setPension(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateEmployerCostConfig = useCallback((key: keyof EmployerCostConfig, value: number) => {
    setEmployerCostConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateBillingConfig = useCallback((key: keyof BillingRateConfig, value: number | null) => {
    setBillingConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleNavItem = useCallback((path: string) => {
    setHiddenNavItems(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]);
  }, []);

  const dismissAssumptionsNudge = useCallback(() => setAssumptionsNudgeDismissed(true), []);

  const dismissIncomeReminder = useCallback((monthKey: string) => setIncomeReminderDismissedMonth(monthKey), []);

  const updateHomeowner = useCallback((key: keyof HomeownerData, value: number) => {
    setHomeowner(prev => ({ ...prev, [key]: value }));
    // Mirror the mortgage balance across the slices that hold the same real debt.
    if (key === 'currentMortgageBalance') {
      setAssets(prev => ({ ...prev, houseDebt: value }));
      setTransition(prev => ({ ...prev, currentMortgageBalance: value }));
    }
  }, []);

  const updateTransition = useCallback((key: keyof TransitionData, value: number) => {
    setTransition(prev => ({ ...prev, [key]: value }));
    // The transition slice describes the same current home as assets/homeowner —
    // mirror its value and mortgage so all three stay in lockstep.
    if (key === 'currentMortgageBalance') {
      setAssets(prev => ({ ...prev, houseDebt: value }));
      setHomeowner(prev => ({ ...prev, currentMortgageBalance: value }));
    }
    if (key === 'currentHouseValue') {
      setAssets(prev => ({ ...prev, houseValue: value }));
    }
  }, []);

  // User-facing housing-mode switch. Entering homeowner mode reconciles any
  // pre-existing drift by treating currentMortgageBalance (the actively-
  // maintained real mortgage) as canonical for net worth. Internal load paths
  // use the raw setHousingMode so they don't trigger this side effect.
  const changeHousingMode = useCallback((mode: HousingMode) => {
    setHousingMode(mode);
    if (mode === 'homeowner') {
      setAssets(prev => ({ ...prev, houseDebt: homeowner.currentMortgageBalance }));
    }
  }, [homeowner]);

  // useState setters are stable, so each CRUD bundle is built once.
  const jobsCrud = useMemo(() => makeCrud<JobEntry>(setJobs, 'job'), []);
  const salariesCrud = useMemo(() => makeCrud<SalaryEntry>(setSalaries, 'sal'), []);
  const bonusesCrud = useMemo(() => makeCrud<BonusEntry>(setBonuses, 'bon'), []);
  const overtimeCrud = useMemo(() => makeCrud<OvertimeEntry>(setOvertime, 'ot'), []);
  const hoursCrud = useMemo(() => makeCrud<HoursSnapshot>(setHoursSnapshots, 'hrs'), []);
  const goalsCrud = useMemo(() => makeCrud<Goal>(setGoals, 'goal'), []);

  const addJob = jobsCrud.add;
  const updateJob = jobsCrud.update;
  const removeJob = useCallback((id: string) => {
    jobsCrud.remove(id);
    // Cascade: remove orphaned salaries
    setSalaries(prev => prev.filter(s => s.jobId !== id));
  }, [jobsCrud]);

  const addSalary = salariesCrud.add;
  const updateSalary = salariesCrud.update;
  const removeSalary = salariesCrud.remove;

  const addBonus = bonusesCrud.add;
  const updateBonus = bonusesCrud.update;
  const removeBonus = bonusesCrud.remove;

  const addOvertime = overtimeCrud.add;
  const updateOvertime = overtimeCrud.update;
  const removeOvertime = overtimeCrud.remove;

  const addHoursSnapshot = hoursCrud.add;
  const updateHoursSnapshot = hoursCrud.update;
  const removeHoursSnapshot = hoursCrud.remove;

  const addGoal = goalsCrud.add;
  const updateGoal = goalsCrud.update;
  const removeGoal = goalsCrud.remove;

  // Set (or clear, with null / ≤0) a category's monthly budget cap.
  const setCategoryBudget = useCallback((category: CategoryKey, amount: number | null) => {
    setCategoryBudgets(prev => {
      const next = { ...prev };
      if (amount == null || amount <= 0) delete next[category];
      else next[category] = amount;
      return next;
    });
  }, []);

  // Rename a connected account. An empty/blank name clears back to the
  // bank-provided name (the entry is removed from the map).
  const setAccountLabel = useCallback((accountKey: string, name: string) => {
    setAccountLabels(prev => {
      const next = { ...prev };
      const trimmed = name.trim();
      if (trimmed) next[accountKey] = trimmed;
      else delete next[accountKey];
      return next;
    });
  }, []);

  // Add a categorization rule (merchant/text → category). Re-applying is handled
  // by the backfill effect (categoryRules is a dep). A blank match is a no-op;
  // an existing rule for the same match is replaced so its category updates.
  const addCategoryRule = useCallback((match: string, category: CategoryKey) => {
    const m = match.trim();
    if (!m) return;
    setCategoryRules(prev => [
      ...prev.filter(r => r.match.trim().toLowerCase() !== m.toLowerCase()),
      { id: makeId('rule'), match: m, category },
    ]);
  }, []);

  const removeCategoryRule = useCallback((id: string) => {
    setCategoryRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // Add a display-name rule (merchant/text → label). Same-match rules are
  // replaced so the label updates; blank match/label is a no-op.
  const addLabelRule = useCallback((match: string, label: string) => {
    const m = match.trim();
    const l = label.trim();
    if (!m || !l) return;
    setLabelRules(prev => [
      ...prev.filter(r => r.match.trim().toLowerCase() !== m.toLowerCase()),
      { id: makeId('label'), match: m, label: l },
    ]);
  }, []);

  const removeLabelRule = useCallback((id: string) => {
    setLabelRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // Remove all transactions belonging to one account (its key) and drop its
  // label — for clearing out an old/historical account no longer in use. The
  // tracked setter records deleted eb- ids so a sync can't resurrect them.
  const removeAccountData = useCallback((accountKey: string) => {
    setDailyTransactionsTracked(dailyTransactions.filter((t) => t.account !== accountKey));
    setAccountLabels((prev) => {
      const next = { ...prev };
      delete next[accountKey];
      return next;
    });
  }, [dailyTransactions, setDailyTransactionsTracked]);

  // Apply the transactions a bank sync just persisted, and adopt the server's new
  // data revision so this (initiating) tab doesn't see its own sync as an
  // external change and trigger a "data changed elsewhere" reload.
  const applyBankSync = useCallback((txs: DailyTransaction[], rev?: number) => {
    if (typeof rev === 'number' && Number.isFinite(rev)) revRef.current = rev;
    setDailyTransactionsTracked(dedupeBankTransactions(txs));
  }, [setDailyTransactionsTracked]);

  // Import / demo-restore: overlay the present fields, leaving absent ones as the
  // current value (resetMissing=false). Shares the single apply path with load.
  const importAll = useCallback((data: Partial<ExportPayload>) => applyPayload(data, false), [applyPayload]);

  // --- Demo mode: swap real data for a fictional dataset, then restore it ---
  // The real data is held in `demoSnapshot` (memory) and the auto-save effect is
  // suspended while demoMode is true, so the backend keeps the real data intact.
  // Refs so demo enter/exit stay referentially stable — they'd otherwise depend
  // on buildPayload/currentMonth (which change with state), which would churn the
  // Settings slice on every edit. Reading the latest via refs lets demoMode live
  // in Settings so Layout (settings-only) doesn't re-render on data changes.
  const buildPayloadRef = useRef(buildPayload);
  const currentMonthRef = useRef(currentMonth);
  useEffect(() => {
    buildPayloadRef.current = buildPayload;
    currentMonthRef.current = currentMonth;
  });

  const enableDemoMode = useCallback(() => {
    if (demoMode) return;
    demoSnapshot.current = { ...buildPayloadRef.current(), currentMonth: format(currentMonthRef.current, 'yyyy-MM') };
    setDemoMode(true);
    importAll(getDemoData());
  }, [demoMode, importAll]);

  const disableDemoMode = useCallback(() => {
    if (!demoMode) return;
    const snapshot = demoSnapshot.current;
    setDemoMode(false);
    if (snapshot) importAll(snapshot);
    demoSnapshot.current = null;
  }, [demoMode, importAll]);

  const toggleDemoMode = useCallback(() => {
    if (demoMode) disableDemoMode();
    else enableDemoMode();
  }, [demoMode, disableDemoMode, enableDemoMode]);

  const resetAll = useCallback(() => {
    setIncome(0);
    setMonthlyIncomes({});
    setPayslips({});
    setNetWorthHistory({});
    setBalanceSnapshots({});
    setFixedExpenses([]);
    setDebts([]);
    setDailyTransactions([]);
    setDeletedBankIds([]);
    setAccountLabels({});
    setCategoryRules([]);
    setLabelRules([]);
    setCategoryBudgets({});
    setRecurringTemplates([]);
    setAssets(DEFAULT_ASSETS);
    setLoan({
      arslonn: 0, eksisterendeGjeld: 0, egenkapital: 0,
      laanebelop: 0, rente: 0, nedbetalingstid: 0, termingebyr: 0,
      etableringsgebyr: 0, skattefradragssats: 0,
      betingetLaan: 0, kjoepesum: 0, gyldigTil: '',
    });
    setHomeowner({
      currentMortgageBalance: 0, originalLoanAmount: 0,
      rente: 0, nedbetalingstid: 0, termingebyr: 0, skattefradragssats: 0,
    });
    setTransition({
      currentHouseValue: 0, currentMortgageBalance: 0,
      agentFeePercent: 0, documentFee: 0, otherSaleCosts: 0,
      bridgeMonths: 0, bridgeLoanRate: 0,
    });
    setPension(DEFAULT_PENSION);
    setJobs([]);
    setSalaries([]);
    setBonuses([]);
    setOvertime([]);
    setHoursSnapshots([]);
    setGoals([]);
    setEmployerCostConfig(DEFAULT_EMPLOYER_COST_CONFIG);
    setBillingConfig(DEFAULT_BILLING_CONFIG);
    // A full wipe is effectively a fresh start — re-run the guided setup from the top.
    setOnboardingCompleted(false);
    setAssumptionsNudgeDismissed(false);
    setIncomeReminderDismissedMonth('');
    setOnboardingEntry('welcome');
    setOnboardingNonce(n => n + 1);
    setOnboardingActive(true);
  }, []);

  // --- First-run guided setup controls ---
  // Manual open (header ?, Settings replay) jumps to the full hub by default;
  // pass 'welcome' to start from the gentle intro.
  const startOnboarding = useCallback((entry: 'welcome' | 'hub' = 'hub') => {
    setOnboardingEntry(entry);
    setOnboardingNonce(n => n + 1);
    setOnboardingActive(true);
  }, []);
  // Full reset: mark the guide un-done AND reopen it from the welcome, so it
  // behaves exactly like a first run (and auto-launches again on next load).
  const resetGuide = useCallback(() => {
    setOnboardingCompleted(false);
    setOnboardingEntry('welcome');
    setOnboardingNonce(n => n + 1);
    setOnboardingActive(true);
  }, []);
  const completeOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    setOnboardingActive(false);
  }, []);

  // --- Restore data-based defaults (assumptions only — never touches balances/data) ---
  const restoreGrowthRateDefaults = useCallback(() => {
    setGrowthReturnRate(DEFAULT_GROWTH_RATES.growthReturnRate);
    setHouseGrowthRate(DEFAULT_GROWTH_RATES.houseGrowthRate);
    setCashGrowthRate(DEFAULT_GROWTH_RATES.cashGrowthRate);
    setCryptoGrowthRate(DEFAULT_GROWTH_RATES.cryptoGrowthRate);
  }, []);

  const restoreAssetTaxDefaults = useCallback(() => {
    updateAsset('taxRate', DEFAULT_TAX_RATES.stockTaxRate);
    updateAsset('cryptoTaxRate', DEFAULT_TAX_RATES.cryptoTaxRate);
  }, [updateAsset]);

  const restoreCustomTaxRateDefault = useCallback(() => {
    setCustomTaxRatePct(DEFAULT_TAX_RATES.customTaxRatePct);
  }, []);

  const restorePensionAssumptionDefaults = useCallback(() => {
    updatePension('otpEmployerPct', DEFAULT_PENSION.otpEmployerPct);
    updatePension('otpEmployeePct', DEFAULT_PENSION.otpEmployeePct);
    updatePension('otpGrowthRate', DEFAULT_PENSION.otpGrowthRate);
    updatePension('ipsGrowthRate', DEFAULT_PENSION.ipsGrowthRate);
    updatePension('retirementAge', DEFAULT_PENSION.retirementAge);
  }, [updatePension]);

  const restoreEmployerCostDefaults = useCallback(() => {
    setEmployerCostConfig(DEFAULT_EMPLOYER_COST_CONFIG);
    setBillingConfig(DEFAULT_BILLING_CONFIG);
  }, []);

  const formatCurrency = useCallback((val: number) => {
    if (displayCurrency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(val * nokToUsd);
    }
    if (displayCurrency === 'custom' && customCurrencyCode) {
      const converted = val * customCurrencyRate;
      try {
        return new Intl.NumberFormat('en', {
          style: 'currency',
          currency: customCurrencyCode.toUpperCase(),
        }).format(converted);
      } catch {
        return `${customCurrencyCode.toUpperCase()} ${converted.toFixed(2)}`;
      }
    }
    return new Intl.NumberFormat(lang === 'nb' ? 'nb-NO' : 'en-US', {
      style: 'currency',
      currency: 'NOK',
    }).format(val);
  }, [displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate, lang]);

  // Like formatCurrency but without decimals — for chart labels/legends where
  // 2-decimal precision is noise. Respects the user's display currency so
  // converted values (USD/custom) stay correct.
  const formatCurrencyShort = useCallback((val: number) => {
    if (displayCurrency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
      }).format(val * nokToUsd);
    }
    if (displayCurrency === 'custom' && customCurrencyCode) {
      const converted = val * customCurrencyRate;
      try {
        return new Intl.NumberFormat('en', {
          style: 'currency', currency: customCurrencyCode.toUpperCase(), maximumFractionDigits: 0,
        }).format(converted);
      } catch {
        return `${customCurrencyCode.toUpperCase()} ${Math.round(converted).toLocaleString('en-US')}`;
      }
    }
    return new Intl.NumberFormat(lang === 'nb' ? 'nb-NO' : 'en-US', {
      style: 'currency', currency: 'NOK', maximumFractionDigits: 0,
    }).format(val);
  }, [displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate, lang]);

  const dismissDataReloaded = useCallback(() => setDataReloaded(false), []);

  const settingsValue = useMemo<FinanceSettingsContextType>(() => ({
    lang, setLang, t, displayCurrency, setDisplayCurrency, nokToUsd, setNokToUsd,
    customCurrencyCode, setCustomCurrencyCode, customCurrencyRate, setCustomCurrencyRate,
    currentMonth, setCurrentMonth,
    savingsTargetPercent, setSavingsTargetPercent,
    growthReturnRate, setGrowthReturnRate, houseGrowthRate, setHouseGrowthRate,
    cashGrowthRate, setCashGrowthRate, cryptoGrowthRate, setCryptoGrowthRate,
    region, setRegion, customTaxRatePct, setCustomTaxRatePct,
    hiddenNavItems, toggleNavItem,
    assumptionsNudgeDismissed, dismissAssumptionsNudge,
    incomeReminderDismissedMonth, dismissIncomeReminder,
    formatCurrency, formatCurrencyShort,
    restoreGrowthRateDefaults, restoreCustomTaxRateDefault,
    demoMode, toggleDemoMode,
    onboardingCompleted, onboardingActive, onboardingEntry, onboardingNonce,
    startOnboarding, resetGuide, completeOnboarding,
    dataLoadFailed, saveFailed, retrySave, dataReloaded, dismissDataReloaded,
  }), [
    lang, t, displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate,
    currentMonth, savingsTargetPercent, growthReturnRate, houseGrowthRate,
    cashGrowthRate, cryptoGrowthRate, region, customTaxRatePct, hiddenNavItems, toggleNavItem,
    assumptionsNudgeDismissed, dismissAssumptionsNudge,
    incomeReminderDismissedMonth, dismissIncomeReminder,
    formatCurrency, formatCurrencyShort, restoreGrowthRateDefaults, restoreCustomTaxRateDefault,
    demoMode, toggleDemoMode,
    onboardingCompleted, onboardingActive, onboardingEntry, onboardingNonce,
    startOnboarding, resetGuide, completeOnboarding,
    dataLoadFailed, saveFailed, retrySave, dataReloaded, dismissDataReloaded,
  ]);

  const dataValue = useMemo<FinanceDataContextType>(() => ({
    income, setIncome,
    monthlyIncomes, setMonthlyIncomeForMonth, clearMonthlyIncomeForMonth,
    payslips, setPayslip, removePayslip,
    netWorthHistory, setNetWorthForMonth, clearNetWorthForMonth, balanceSnapshots,
    setManualSnapshot, deleteManualSnapshot,
    fixedExpenses, setFixedExpenses,
    debts, setDebts,
    dailyTransactions, setDailyTransactions: setDailyTransactionsTracked,
    accountLabels, setAccountLabel, applyBankSync,
    categoryRules, addCategoryRule, removeCategoryRule, labelRules, addLabelRule, removeLabelRule, removeAccountData,
    accountGroups, dataAccounts, accountFilter, setAccountFilter, internalTransferIds, nonTransferTransactions, visibleBudgetTransactions,
    categoryBudgets, setCategoryBudget,
    recurringTemplates, setRecurringTemplates,
    assets, updateAsset, addSavingsAccount, updateSavingsAccount, removeSavingsAccount,
    loan, updateLoan, pension, updatePension,
    housingMode, setHousingMode: changeHousingMode, homeowner, updateHomeowner, transition, updateTransition,
    jobs, addJob, updateJob, removeJob,
    salaries, addSalary, updateSalary, removeSalary,
    bonuses, addBonus, updateBonus, removeBonus,
    overtime, addOvertime, updateOvertime, removeOvertime,
    hoursSnapshots, addHoursSnapshot, updateHoursSnapshot, removeHoursSnapshot,
    goals, addGoal, updateGoal, removeGoal,
    employerCostConfig, updateEmployerCostConfig, billingConfig, updateBillingConfig,
    inflation, inflationStale, wageStats,
    importAll, buildPayload, resetAll,
    restoreAssetTaxDefaults, restorePensionAssumptionDefaults, restoreEmployerCostDefaults,
  }), [
    income, monthlyIncomes, setMonthlyIncomeForMonth, clearMonthlyIncomeForMonth,
    payslips, setPayslip, removePayslip, netWorthHistory, setNetWorthForMonth,
    clearNetWorthForMonth, balanceSnapshots, setManualSnapshot, deleteManualSnapshot,
    fixedExpenses, debts, dailyTransactions,
    setDailyTransactionsTracked, accountLabels, setAccountLabel, applyBankSync,
    categoryRules, addCategoryRule, removeCategoryRule, labelRules, addLabelRule, removeLabelRule, removeAccountData,
    accountGroups, dataAccounts, accountFilter, setAccountFilter, internalTransferIds, nonTransferTransactions, visibleBudgetTransactions,
    categoryBudgets, setCategoryBudget, recurringTemplates,
    assets, updateAsset, addSavingsAccount, updateSavingsAccount, removeSavingsAccount,
    loan, updateLoan, pension, updatePension, housingMode,
    changeHousingMode, homeowner, updateHomeowner, transition, updateTransition,
    jobs, addJob, updateJob, removeJob, salaries, addSalary, updateSalary, removeSalary,
    bonuses, addBonus, updateBonus, removeBonus, overtime, addOvertime, updateOvertime,
    removeOvertime, hoursSnapshots, addHoursSnapshot, updateHoursSnapshot, removeHoursSnapshot,
    goals, addGoal, updateGoal, removeGoal, employerCostConfig, updateEmployerCostConfig,
    billingConfig, updateBillingConfig, inflation, inflationStale, wageStats,
    importAll, buildPayload, resetAll, restoreAssetTaxDefaults,
    restorePensionAssumptionDefaults, restoreEmployerCostDefaults,
  ]);

  const derivedValue = useMemo<FinanceDerivedContextType>(() => ({
    derivedMonthlyIncome, grossAnnualIncome, isMonthlyIncomeOverridden,
    prevMonthIncome, prevMonthSpending, currentMonthSpending, effectiveIncome, averageIncome, incomeSeries,
    recommendedSpending, recommendedInvestment, suggestedInvestment, conservativeMode, conservativeReason,
    totalDebt, netWorth, studentDebt, mortgageRate, mortgageTermYears,
    totalResidual, totalFixedExpenses, viewFixedExpenses, fixedExpensesFromSnapshot,
    monthlyBudget, dailyBudget, dailyData, reconciliation,
    totalEquity, taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto,
  }), [
    derivedMonthlyIncome, grossAnnualIncome, isMonthlyIncomeOverridden,
    prevMonthIncome, prevMonthSpending, currentMonthSpending, effectiveIncome, averageIncome, incomeSeries,
    recommendedSpending, recommendedInvestment, suggestedInvestment, conservativeMode, conservativeReason,
    totalDebt, netWorth, studentDebt, mortgageRate, mortgageTermYears,
    totalResidual, totalFixedExpenses, viewFixedExpenses, fixedExpensesFromSnapshot,
    monthlyBudget, dailyBudget, dailyData, reconciliation,
    totalEquity, taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto,
  ]);

  return (
    <FinanceSettingsContext.Provider value={settingsValue}>
      <FinanceDataContext.Provider value={dataValue}>
        <FinanceDerivedContext.Provider value={derivedValue}>
          {children}
        </FinanceDerivedContext.Provider>
      </FinanceDataContext.Provider>
    </FinanceSettingsContext.Provider>
  );
}

function useSlice<T>(ctx: React.Context<T | undefined>, hook: string): T {
  const value = useContext(ctx);
  if (value === undefined) throw new Error(`${hook} must be used within a FinanceProvider`);
  return value;
}

// Granular subscriptions — a component that reads only one slice re-renders only
// when that slice changes. Prefer these in hot components; useFinance() below
// stays as the backward-compatible union for everything else.
// eslint-disable-next-line react-refresh/only-export-components
export const useFinanceSettings = () => useSlice(FinanceSettingsContext, 'useFinanceSettings');
// eslint-disable-next-line react-refresh/only-export-components
export const useFinanceData = () => useSlice(FinanceDataContext, 'useFinanceData');
// eslint-disable-next-line react-refresh/only-export-components
export const useFinanceDerived = () => useSlice(FinanceDerivedContext, 'useFinanceDerived');

// Backward-compatible combined view. The merged object is memoized on the three
// slice identities, so it only changes when a slice actually changes.
// eslint-disable-next-line react-refresh/only-export-components
export function useFinance(): FinanceContextType {
  const settings = useFinanceSettings();
  const data = useFinanceData();
  const derived = useFinanceDerived();
  return useMemo(() => ({ ...settings, ...data, ...derived }), [settings, data, derived]);
}
