/**
 * Fully-loaded employer cost of a salary, and the consultant billing rate that
 * recovers it.
 *
 * Norway-first: gross salary carries feriepenger (holiday pay), employer OTP
 * pension, and arbeidsgiveravgift (employer national insurance) — the last is
 * levied on the *combined* base (salary + feriepenger + employer OTP). The
 * temporary extra 5% AGA over ~850k was abolished from 2025, so a single
 * configurable rate is correct for 2026.
 *
 * The math is country-agnostic apart from one flag: in Norway monthly-paid
 * staff keep their salary through the holiday weeks and ferietrekk takes those
 * weeks back, so only the holiday pay above that is extra cost
 * (`holidayPayInSalary`, see `feriepengerSurplus`). Otherwise the difference
 * between Norway and a "generic" setup is the default rates and the labels, and
 * the page passes whichever percentages apply.
 *
 * Estimate, not payroll: feriepenger are accrued on this year's salary and paid
 * the following year, and AGA varies by geographic zone — both are folded into
 * a steady-state annual figure here.
 */

import { feriepengerSurplus } from './feriepenger';

// Norwegian defaults (2026, zone I).
export const FERIEPENGER_DEFAULT_PCT = 12; // 5-week (avtalefestet); 10.2% is the 4-week minimum
export const AGA_DEFAULT_PCT = 14.1; // arbeidsgiveravgift, zone I

// Typical Norwegian per-employee fixed overhead (knowledge worker / consultant),
// annual. There is no single official statistic for this, so it's a transparent
// rule-of-thumb buildup — adjust on the page for your situation:
//   office / workspace    ~45 000  (rent, power, cleaning, shared areas)
//   IT equipment          ~15 000  (laptop / phone / peripherals, ~3-yr amortised)
//   software & licences   ~15 000  (M365, professional tools)
//   insurance & misc      ~15 000  (yrkesskade, mobile / broadband, HSE)
//                         ─────────
//                          90 000
export const OVERHEAD_DEFAULT_NOK = 90_000;

export interface EmployerCostConfig {
  feriepengesatsPct: number; // holiday pay % of gross (generic: benefits/leave %)
  payrollTaxPct: number;     // arbeidsgiveravgift % (generic: payroll tax %)
  overheadAnnual: number;    // flat kr/yr (equipment, software, office, insurance)
  overheadPct: number;       // additional overhead as % of gross
}

export interface EmployerCostBreakdown {
  gross: number;
  feriepenger: number;       // holiday pay on top of salary (see holidayPayPct)
  employerPension: number;   // gross * employerPensionPct (passed in from Pension)
  payrollTaxBase: number;    // gross + feriepenger + employerPension
  payrollTax: number;        // payrollTaxBase * payrollTax
  overhead: number;          // overheadAnnual + gross * overheadPct
  totalEmployerCost: number;
  loadingPct: number;        // (total / gross - 1) * 100 — how much above salary
}

/**
 * Holiday pay as a % of gross that comes on top of 12 months' salary. With
 * `holidayPayInSalary` (Norwegian monthly pay) that is the sats minus the
 * ferietrekk for the holiday weeks, at a steady salary: about 2.4% on the 12%
 * rate. Otherwise the whole sats.
 */
export function holidayPayPct(satsPct: number, holidayPayInSalary: boolean): number {
  if (!holidayPayInSalary) return Math.max(0, satsPct);
  return Math.max(0, feriepengerSurplus(0, () => 1, satsPct) * 100);
}

/**
 * @param grossAnnual       annual gross salary
 * @param employerPensionPct employer pension % of gross (Norway: pension.otpEmployerPct)
 * @param holidayPayInSalary true for Norwegian monthly pay (ferietrekk applies)
 */
export function calcEmployerCost(
  grossAnnual: number,
  employerPensionPct: number,
  config: EmployerCostConfig,
  holidayPayInSalary = false,
): EmployerCostBreakdown {
  const gross = Math.max(0, grossAnnual);
  const feriepenger = gross * (holidayPayPct(config.feriepengesatsPct, holidayPayInSalary) / 100);
  const employerPension = gross * (Math.max(0, employerPensionPct) / 100);
  const payrollTaxBase = gross + feriepenger + employerPension;
  const payrollTax = payrollTaxBase * (Math.max(0, config.payrollTaxPct) / 100);
  const overhead = Math.max(0, config.overheadAnnual) + gross * (Math.max(0, config.overheadPct) / 100);
  const totalEmployerCost = gross + feriepenger + employerPension + payrollTax + overhead;
  const loadingPct = gross > 0 ? (totalEmployerCost / gross - 1) * 100 : 0;
  return {
    gross,
    feriepenger,
    employerPension,
    payrollTaxBase,
    payrollTax,
    overhead,
    totalEmployerCost,
    loadingPct,
  };
}

export interface BillingRateConfig {
  workHoursPerYear: number;             // gross contracted hours (e.g. 1950)
  utilizationPct: number;               // billable share of work hours (e.g. 80)
  billableHoursOverride: number | null; // if set, used directly instead of work*util
  targetMarginPct: number;              // profit as % of revenue (clamped 0..95)
  hoursPerDay: number;                  // for the day-rate (e.g. 7.5)
  billedHourly: number | null;          // what the client is actually billed for you, if known
  solveFor: SolveFor;                   // which of salary / rate / margin the calculator derives
}

// Salary, billed rate and margin are tied by one equation (given the hours and
// cost assumptions): the calculator derives one from the other two.
export type SolveFor = 'rate' | 'salary' | 'margin';

export interface BillingRateBreakdown {
  billableHoursPerYear: number;
  breakEvenHourly: number;       // totalEmployerCost / billableHours
  targetHourly: number;          // breakEven / (1 - margin)
  dailyRate: number;             // targetHourly * hoursPerDay
  annualRevenueAtTarget: number; // targetHourly * billableHours
  profitAnnual: number;          // revenue - totalEmployerCost
  markupOnCostPct: number;       // (target / breakEven - 1) * 100 — the other framing
}

const EMPTY_BILLING: BillingRateBreakdown = {
  billableHoursPerYear: 0,
  breakEvenHourly: 0,
  targetHourly: 0,
  dailyRate: 0,
  annualRevenueAtTarget: 0,
  profitAnnual: 0,
  markupOnCostPct: 0,
};

/** Billable hours: the override when set, else work hours × utilization. */
export function calcBillableHours(config: BillingRateConfig): number {
  return config.billableHoursOverride != null && config.billableHoursOverride > 0
    ? config.billableHoursOverride
    : Math.max(0, config.workHoursPerYear) * (Math.max(0, config.utilizationPct) / 100);
}

export function calcBillingRate(
  totalEmployerCost: number,
  config: BillingRateConfig,
): BillingRateBreakdown {
  const billableHoursPerYear = calcBillableHours(config);
  if (billableHoursPerYear <= 0) return EMPTY_BILLING;

  // Margin is share of revenue: rate = cost / (1 - margin). Clamp below 1 so the
  // rate never blows up to Infinity at 100%.
  const margin = Math.min(0.95, Math.max(0, config.targetMarginPct / 100));
  const breakEvenHourly = totalEmployerCost / billableHoursPerYear;
  const targetHourly = breakEvenHourly / (1 - margin);
  const dailyRate = targetHourly * Math.max(0, config.hoursPerDay);
  const annualRevenueAtTarget = targetHourly * billableHoursPerYear;
  const profitAnnual = annualRevenueAtTarget - totalEmployerCost;
  const markupOnCostPct = breakEvenHourly > 0 ? (targetHourly / breakEvenHourly - 1) * 100 : 0;
  return {
    billableHoursPerYear,
    breakEvenHourly,
    targetHourly,
    dailyRate,
    annualRevenueAtTarget,
    profitAnnual,
    markupOnCostPct,
  };
}

export interface BilledRateBreakdown {
  annualRevenue: number;   // billedHourly * billableHours
  employerProfit: number;  // revenue - totalEmployerCost (negative = loss)
  marginPct: number;       // profit as % of revenue
  profitPerHour: number;   // profit / billableHours
}

/** The reverse question: given what the client is billed for you, what does the employer keep? */
export function calcBilledRate(
  billedHourly: number,
  billableHoursPerYear: number,
  totalEmployerCost: number,
): BilledRateBreakdown {
  const hours = Math.max(0, billableHoursPerYear);
  const annualRevenue = Math.max(0, billedHourly) * hours;
  const employerProfit = annualRevenue - totalEmployerCost;
  const marginPct = annualRevenue > 0 ? (employerProfit / annualRevenue) * 100 : 0;
  const profitPerHour = hours > 0 ? employerProfit / hours : 0;
  return { annualRevenue, employerProfit, marginPct, profitPerHour };
}

/**
 * The gross salary at which the employer keeps exactly `targetMarginPct` of the
 * revenue from `billedHourly`. Total cost is linear in gross:
 * gross * k + overheadAnnual, with k = (1 + ferie + otp) * (1 + aga) + overheadPct
 * (ferie from `holidayPayPct`),
 * so this solves gross * k + overheadAnnual = revenue * (1 - margin).
 */
export function calcFairGross(
  billedHourly: number,
  billableHoursPerYear: number,
  employerPensionPct: number,
  costConfig: EmployerCostConfig,
  targetMarginPct: number,
  holidayPayInSalary = false,
): number {
  const revenue = Math.max(0, billedHourly) * Math.max(0, billableHoursPerYear);
  const margin = Math.min(0.95, Math.max(0, targetMarginPct / 100));
  const pct = (v: number) => Math.max(0, v) / 100;
  const k = (1 + pct(holidayPayPct(costConfig.feriepengesatsPct, holidayPayInSalary)) + pct(employerPensionPct)) * (1 + pct(costConfig.payrollTaxPct))
    + pct(costConfig.overheadPct);
  return Math.max(0, (revenue * (1 - margin) - Math.max(0, costConfig.overheadAnnual)) / k);
}

export const DEFAULT_EMPLOYER_COST_CONFIG: EmployerCostConfig = {
  feriepengesatsPct: FERIEPENGER_DEFAULT_PCT,
  payrollTaxPct: AGA_DEFAULT_PCT,
  overheadAnnual: OVERHEAD_DEFAULT_NOK,
  overheadPct: 0,
};

export const DEFAULT_BILLING_CONFIG: BillingRateConfig = {
  workHoursPerYear: 1950,
  utilizationPct: 80,
  billableHoursOverride: null,
  targetMarginPct: 30,
  hoursPerDay: 7.5,
  billedHourly: null,
  solveFor: 'rate',
};
