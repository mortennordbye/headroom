// Trailing savings-rate health, derived from the same `monthlyCashflow` rows
// that feed SavingsRateChart. Pure + unit-tested so the Budget page can flag a
// slipping rate without re-deriving the money math in a component.
import type { MonthlyCashflowRow } from './monthlyCashflow';

export interface SavingsRateStatus {
  trailingRate: number;  // average savings rate over the trailing window, %
  belowTarget: boolean;  // trailing rate under the target
  shortfallPp: number;   // percentage points under target (0 when at/above)
  months: number;        // real months actually averaged
}

/**
 * Average the last `window` months' savings rate and flag when it has slipped
 * under the user's target. Months with no income (rate 0 from a blank/zero
 * income) are skipped so a data gap doesn't fake a decline. Returns null when
 * there are no real months to judge.
 */
export function savingsRateStatus(
  rows: MonthlyCashflowRow[],
  targetPct: number,
  window: number = 3,
): SavingsRateStatus | null {
  const recent = rows.slice(-window).filter((r) => r.income > 0);
  if (recent.length === 0) return null;
  const trailingRate = recent.reduce((s, r) => s + r.rate, 0) / recent.length;
  const belowTarget = trailingRate < targetPct;
  return {
    trailingRate: Math.round(trailingRate * 10) / 10,
    belowTarget,
    shortfallPp: belowTarget ? Math.round((targetPct - trailingRate) * 10) / 10 : 0,
    months: recent.length,
  };
}
