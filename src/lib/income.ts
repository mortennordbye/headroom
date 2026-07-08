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
