// Small income comparison helpers shared across pages.

/**
 * Percentage difference between a month's effective income and the trailing
 * average income. Positive means above average, negative below. Returns 0 when
 * the average is non-positive (no baseline to compare against — avoids
 * divide-by-zero). Callers localize the label; this returns the raw number.
 */
export function incomeDiffPct(effectiveIncome: number, averageIncome: number): number {
  return averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;
}

/**
 * Whether a manual monthly-income override no longer matches the net income the
 * salary system currently derives for that month (salary, tax or IPS changed
 * after it was entered). Differences under 1 kr count as equal; a missing or
 * non-finite value is never reported as stale.
 */
export function isIncomeOverrideStale(override: number | undefined, derived: number): boolean {
  if (override === undefined || !Number.isFinite(override) || !Number.isFinite(derived)) return false;
  return Math.abs(override - derived) >= 1;
}
