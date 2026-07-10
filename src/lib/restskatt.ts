// Restskatt early warning: compare the tax withheld from this year's payslips
// against what the year's income is likely to owe, months before the
// skatteoppgjør. Pure + unit-tested so the Salary tile can reuse it.
//
// Annualization is linear (recorded average × 12) on both sides. This is a
// deliberate simplification: the June feriepenger month (usually no trekk) and
// the December half-trekk aren't modeled, so a straight-line projection of
// *withholding* tends to run high — the estimate is a nudge, not a tax return.

import type { MonthlyPayslip } from '../context/FinanceContext';

/** Finite-or-0: keeps a hand-edited undefined/NaN out of the money math. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export interface RestskattEstimate {
  year: number;
  monthsRecorded: number;
  grossToDate: number;
  withheldToDate: number;
  projectedAnnualGross: number;        // linear annualization of recorded gross
  projectedAnnualWithholding: number;  // linear annualization of recorded withholding
  expectedAnnualTax: number;           // caller's tax fn on the projected gross
  /** expectedAnnualTax − projectedAnnualWithholding. >0 = under-withheld (restskatt). */
  gap: number;
  status: 'restskatt' | 'refund' | 'onTrack';
}

/**
 * `taxForGross` computes the expected annual tax for a gross figure (the caller
 * wires in region + deductions, e.g. `calcTaxByRegion(...).totalTax`). A gap is
 * only flagged past a materiality threshold (max of a flat floor and a percent
 * of expected tax) so small timing noise doesn't cry wolf. Returns null when
 * there are fewer than `minMonths` recorded payslips for the year — too little
 * to project from.
 */
export function restskattEstimate(
  payslips: Record<string, MonthlyPayslip>,
  year: number,
  taxForGross: (gross: number) => number,
  minMonths = 2,
  materialityPct = 3,
): RestskattEstimate | null {
  const prefix = `${year}-`;
  const months = Object.keys(payslips).filter(k => k.startsWith(prefix)).sort();
  if (months.length < minMonths) return null;

  let grossToDate = 0;
  let withheldToDate = 0;
  for (const m of months) {
    grossToDate += Math.max(0, finite(payslips[m].gross));
    withheldToDate += Math.max(0, finite(payslips[m].tax));
  }

  const n = months.length;
  const projectedAnnualGross = (grossToDate / n) * 12;
  const projectedAnnualWithholding = (withheldToDate / n) * 12;
  const expectedAnnualTax = Math.max(0, taxForGross(projectedAnnualGross));
  const gap = expectedAnnualTax - projectedAnnualWithholding;

  const threshold = Math.max(2000, (expectedAnnualTax * materialityPct) / 100);
  const status: RestskattEstimate['status'] =
    gap > threshold ? 'restskatt' : gap < -threshold ? 'refund' : 'onTrack';

  return {
    year,
    monthsRecorded: n,
    grossToDate,
    withheldToDate,
    projectedAnnualGross,
    projectedAnnualWithholding,
    expectedAnnualTax,
    gap,
    status,
  };
}
