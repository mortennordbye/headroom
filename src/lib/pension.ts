// Pension wealth projection, shared by PensionPage (year-by-year series) and
// ForecastPage (final value only). Pure + unit-tested. Contributions land at the
// END of each year and then grow; the closed form matches the iterative
// year-by-year recurrence `next = prev * (1 + r) + contribution`.

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
