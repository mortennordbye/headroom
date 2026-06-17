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
 * The math is country-agnostic: the only difference between Norway and a
 * "generic" international setup is the default rates and the labels shown in the
 * UI. So there is deliberately NO `region` parameter here (unlike
 * `calcTaxByRegion`, whose math actually branches) — the page passes whichever
 * percentages apply. Do not "fix" this by adding a region switch.
 *
 * Estimate, not payroll: feriepenger are accrued on this year's salary and paid
 * the following year, and AGA varies by geographic zone — both are folded into
 * a steady-state annual figure here.
 */

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
  feriepenger: number;       // gross * feriepengesats
  employerPension: number;   // gross * employerPensionPct (passed in from Pension)
  payrollTaxBase: number;    // gross + feriepenger + employerPension
  payrollTax: number;        // payrollTaxBase * payrollTax
  overhead: number;          // overheadAnnual + gross * overheadPct
  totalEmployerCost: number;
  loadingPct: number;        // (total / gross - 1) * 100 — how much above salary
}

/**
 * @param grossAnnual       annual gross salary
 * @param employerPensionPct employer pension % of gross (Norway: pension.otpEmployerPct)
 */
export function calcEmployerCost(
  grossAnnual: number,
  employerPensionPct: number,
  config: EmployerCostConfig,
): EmployerCostBreakdown {
  const gross = Math.max(0, grossAnnual);
  const feriepenger = gross * (Math.max(0, config.feriepengesatsPct) / 100);
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
}

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

export function calcBillingRate(
  totalEmployerCost: number,
  config: BillingRateConfig,
): BillingRateBreakdown {
  const billableHoursPerYear = config.billableHoursOverride != null && config.billableHoursOverride > 0
    ? config.billableHoursOverride
    : Math.max(0, config.workHoursPerYear) * (Math.max(0, config.utilizationPct) / 100);
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
};
