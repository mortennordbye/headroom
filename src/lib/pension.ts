// Pension wealth projection, shared by PensionPage (year-by-year series) and
// ForecastPage (final value only). Pure + unit-tested. Contributions land at the
// END of each year and then grow; the closed form matches the iterative
// year-by-year recurrence `next = prev * (1 + r) + contribution`.

import { folketrygdParamsFor } from './folketrygd';
import type { BonusEntry, OvertimeEntry } from '../context/FinanceContext';

/** OTP contributions are calculated on pay up to 12G (innskuddspensjonsloven § 5-2). */
export const OTP_CONTRIBUTION_CAP_G = 12;

/** The pay (kr) above which no OTP contribution is due: 12G for `year`. */
export function otpContributionCap(year: number): number {
  return OTP_CONTRIBUTION_CAP_G * folketrygdParamsFor(year).grunnbelop;
}

/**
 * Annual OTP contribution (employer + employee) at `totalPct` percent of
 * pensionable income, with the base capped at 12G for `year`.
 */
export function otpAnnualContribution(pensionableIncome: number, totalPct: number, year: number): number {
  const base = Math.min(Math.max(0, pensionableIncome), otpContributionCap(year));
  return base * totalPct / 100;
}

/** A bonus or overtime payment as the OTP base counts it. Overtime has no `type`. */
export type OtpPay = { date: string; amount: number; type?: string };

/** The `Pension` settings that decide which pay besides fixed salary is in the OTP base. */
export interface OtpBaseScheme {
  otpIncludesBonuses?: boolean;
  otpIncludesOvertime?: boolean;
  otpJobId?: string;
}

/**
 * The bonus and overtime payments the scheme counts in the OTP base. By law the
 * base is all pay received in the contribution year (innskuddspensjonsloven
 * § 5-5 første ledd), overtime included, but a scheme may leave out varying or
 * temporary supplements (§ 5-5 annet ledd bokstav a), and many base it on fixed
 * salary. So bonuses count only with `otpIncludesBonuses` and overtime only with
 * `otpIncludesOvertime` (both read as `=== true`). With `otpJobId` set only pay
 * from that job counts, since the scheme is that employer's, and a payment not
 * linked to a job is left out; without it every job's payments count.
 */
export function otpCountedPay(
  bonuses: readonly Pick<BonusEntry, 'date' | 'amount' | 'type' | 'jobId'>[],
  overtime: readonly Pick<OvertimeEntry, 'date' | 'amount' | 'jobId'>[],
  scheme: OtpBaseScheme,
): OtpPay[] {
  const job = scheme.otpJobId;
  const fromJob = (e: { jobId?: string }) => !job || e.jobId === job;
  return [
    ...(scheme.otpIncludesBonuses === true ? bonuses.filter(fromJob) : []),
    ...(scheme.otpIncludesOvertime === true
      ? overtime.filter(fromJob).map(o => ({ date: o.date, amount: o.amount }))
      : []),
  ];
}

/**
 * Sum of the payments dated with `prefix` ('yyyy-' or 'yyyy-MM'), skipping
 * `skip` types and entries with no date or a non-positive/NaN amount.
 */
function sumBonuses(bonuses: readonly OtpPay[], prefix: string, skip: readonly string[]): number {
  return bonuses.reduce(
    (s, b) => (typeof b.date === 'string' && b.date.startsWith(prefix) && !(b.type && skip.includes(b.type)) && b.amount > 0
      ? s + b.amount
      : s),
    0,
  );
}

/** Holiday pay is not a bonus, and the fixed salary already stands for it. */
const NOT_BONUS: readonly string[] = ['holiday_pay'];
/** A signing bonus is paid once, so it is not expected to come back next year. */
const NOT_RECURRING: readonly string[] = ['holiday_pay', 'signing'];

/**
 * The pay an OTP contribution is calculated on for `year`: fixed pay plus the
 * `counted` bonus and overtime payments (see `otpCountedPay`) dated in `year`.
 * Holiday-pay entries are left out because `fixedGross` already covers that pay
 * and they are not bonuses, not because the law excludes them. The 12G cap is
 * applied later, by `otpAnnualContribution`.
 */
export function otpPensionableIncome(
  fixedGross: number,
  counted: readonly OtpPay[],
  year: number,
): number {
  return Math.max(0, fixedGross) + sumBonuses(counted, `${year}-`, NOT_BONUS);
}

/**
 * The yearly OTP base to project forward from `year` until retirement. One
 * year's bonuses or overtime are not a promise of the same every year, so the
 * recurring estimate is the previous full calendar year's `counted` payments,
 * leaving out signing bonuses (one-off) and holiday pay (covered by `fixedGross`).
 */
export function otpProjectedPensionableIncome(
  fixedGross: number,
  counted: readonly OtpPay[],
  year: number,
): number {
  return Math.max(0, fixedGross) + sumBonuses(counted, `${year - 1}-`, NOT_RECURRING);
}

/**
 * The bonus and overtime part of the year's OTP contribution earned up to and
 * including `month` ('yyyy-MM'): `totalPct` of the `counted` payments dated in
 * that year up to the month, counted only for the room left under that year's
 * 12G once the full year's `fixedGross` is in. Added to twelve fixed twelfths it
 * gives `otpAnnualContribution(otpPensionableIncome(...))` for the year.
 */
export function otpBonusShareToDate(
  fixedGross: number,
  bonuses: readonly OtpPay[],
  totalPct: number,
  month: string,
): number {
  const year = Number(month.slice(0, 4));
  const fixed = Math.max(0, fixedGross);
  const toDate = bonuses.filter(b => typeof b.date === 'string' && b.date.slice(0, 7) <= month);
  const bonusTotal = sumBonuses(toDate, `${year}-`, NOT_BONUS);
  return otpAnnualContribution(fixed + bonusTotal, totalPct, year) - otpAnnualContribution(fixed, totalPct, year);
}

/**
 * Balance after `years` full years of annual growth at `ratePct` percent with a
 * fixed end-of-year contribution. `years <= 0` returns `start`; a ~0% rate
 * degrades to linear accumulation (no annuity denominator).
 */
export function pensionFutureValue(start: number, contribution: number, ratePct: number, years: number): number {
  const r = ratePct / 100;
  if (years <= 0) return start;
  if (Math.abs(r) < 1e-9) return start + contribution * years;
  return start * Math.pow(1 + r, years) + contribution * (Math.pow(1 + r, years) - 1) / r;
}

export interface PensionProjectionParams {
  otpBalance: number;
  ipsBalance: number;
  otpAnnualContribution: number;
  ipsAnnualContribution: number;
  otpGrowthRate: number; // percent
  ipsGrowthRate: number; // percent
  yearsToRetire: number;
  startYear: number;
}

export interface PensionYear {
  year: number;
  otp: number;
  ips: number;
  total: number;
}

/**
 * Year-by-year OTP + IPS balances from now (year 0 = today's balances) through
 * retirement, inclusive. Rounded at the output edge; `total` is rounded from the
 * unrounded sum so it always equals what the chart's stacked bars display.
 */
export function projectPensionWealth(p: PensionProjectionParams): PensionYear[] {
  const out: PensionYear[] = [];
  for (let y = 0; y <= p.yearsToRetire; y++) {
    const otp = pensionFutureValue(p.otpBalance, p.otpAnnualContribution, p.otpGrowthRate, y);
    const ips = pensionFutureValue(p.ipsBalance, p.ipsAnnualContribution, p.ipsGrowthRate, y);
    out.push({ year: p.startYear + y, otp: Math.round(otp), ips: Math.round(ips), total: Math.round(otp + ips) });
  }
  return out;
}
