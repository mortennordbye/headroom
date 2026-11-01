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

/**
 * The pay an OTP contribution is calculated on for `year`. By law the base is
 * all pay received in the contribution year (innskuddspensjonsloven § 5-5 første
 * ledd), but a scheme may leave out varying or temporary supplements (§ 5-5
 * annet ledd bokstav a), and many base it on fixed salary. So bonuses paid in
 * `year` count only when `includeBonuses` says the user's scheme includes them.
 * Holiday pay entries are not bonuses and never count here. The 12G cap is
 * applied later, by `otpAnnualContribution`.
 */
export function otpPensionableIncome(
  fixedGross: number,
  bonuses: readonly Pick<BonusEntry, 'date' | 'amount' | 'type'>[],
  year: number,
  includeBonuses: boolean,
): number {
  const base = Math.max(0, fixedGross);
  if (!includeBonuses) return base;
  const prefix = `${year}-`;
  const bonusTotal = bonuses.reduce(
    (s, b) => (b.type !== 'holiday_pay' && b.date.startsWith(prefix) && b.amount > 0 ? s + b.amount : s),
    0,
  );
  return base + bonusTotal;
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
