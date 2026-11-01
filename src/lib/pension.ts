// Pension wealth projection, shared by PensionPage (year-by-year series) and
// ForecastPage (final value only). Pure + unit-tested. Contributions land at the
// END of each year and then grow; the closed form matches the iterative
// year-by-year recurrence `next = prev * (1 + r) + contribution`.

import { folketrygdParamsFor } from './folketrygd';
import type { BonusEntry } from '../context/FinanceContext';

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

type OtpBonus = Pick<BonusEntry, 'date' | 'amount' | 'type'>;

/**
 * Sum of the bonuses dated with `prefix` ('yyyy-' or 'yyyy-MM'), skipping
 * `skip` types and entries with no date or a non-positive/NaN amount.
 */
function sumBonuses(bonuses: readonly OtpBonus[], prefix: string, skip: readonly string[]): number {
  return bonuses.reduce(
    (s, b) => (typeof b.date === 'string' && b.date.startsWith(prefix) && !skip.includes(b.type) && b.amount > 0
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
 * The pay an OTP contribution is calculated on for `year`. By law the base is
 * all pay received in the contribution year (innskuddspensjonsloven § 5-5 første
 * ledd), but a scheme may leave out varying or temporary supplements (§ 5-5
 * annet ledd bokstav a), and many base it on fixed salary. So bonuses paid in
 * `year` count only when `includeBonuses` says the user's scheme includes them.
 * Holiday-pay entries are left out because `fixedGross` already covers that pay
 * and they are not bonuses, not because the law excludes them. The 12G cap is
 * applied later, by `otpAnnualContribution`.
 */
export function otpPensionableIncome(
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  year: number,
  includeBonuses: boolean,
): number {
  const base = Math.max(0, fixedGross);
  if (!includeBonuses) return base;
  return base + sumBonuses(bonuses, `${year}-`, NOT_BONUS);
}

/**
 * The yearly OTP base to project forward from `year` until retirement. One
 * year's bonuses are not a promise of the same every year, so the recurring
 * estimate is the previous full calendar year's bonuses, leaving out signing
 * bonuses (one-off) and holiday pay (covered by `fixedGross`). Only when
 * `includeBonuses` says the scheme counts bonuses.
 */
export function otpProjectedPensionableIncome(
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  year: number,
  includeBonuses: boolean,
): number {
  const base = Math.max(0, fixedGross);
  if (!includeBonuses) return base;
  return base + sumBonuses(bonuses, `${year - 1}-`, NOT_RECURRING);
}

/**
 * The OTP contribution to post for `month` ('yyyy-MM'): a twelfth of the yearly
 * contribution on fixed pay, plus `totalPct` of any bonus dated in `month` when
 * `includeBonuses`. The 12G cap of the month's own year holds across that year:
 * a bonus only counts for the room left under 12G once the full year's fixed
 * pay and the year's earlier bonuses are in, so the twelve months sum to
 * `otpAnnualContribution(otpPensionableIncome(...))`. With bonuses off this is
 * the fixed twelfth every month, as before.
 */
export function otpContributionForMonth(
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  totalPct: number,
  month: string,
  includeBonuses: boolean,
): number {
  const year = Number(month.slice(0, 4));
  const fixed = Math.max(0, fixedGross);
  const fixedPart = otpAnnualContribution(fixed, totalPct, year) / 12;
  if (!includeBonuses) return fixedPart;
  const yearBonuses = bonuses.filter(b => typeof b.date === 'string' && b.date.startsWith(`${year}-`));
  const thisMonth = sumBonuses(yearBonuses, month, NOT_BONUS);
  if (thisMonth <= 0) return fixedPart;
  const earlier = sumBonuses(yearBonuses.filter(b => b.date.slice(0, 7) < month), `${year}-`, NOT_BONUS);
  const before = otpAnnualContribution(fixed + earlier, totalPct, year);
  const after = otpAnnualContribution(fixed + earlier + thisMonth, totalPct, year);
  return fixedPart + (after - before);
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
