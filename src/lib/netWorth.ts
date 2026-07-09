import type { BalanceSnapshot } from '../context/FinanceContext';
import { computeEquityBreakdown } from './equity';

export interface NetWorthPoint {
  monthKey: string;
  value: number;
  estimated: boolean;
}

const MONTHLY_GROWTH = 1.005; // ~6% annual, for back-projecting leading gaps

/**
 * Net worth derived from a snapshot: post-tax equity (the one true equity
 * function) minus that month's non-mortgage debts. Matches the Dashboard
 * headline formula. Older snapshots without `debts` render equity-only, exactly
 * as `netWorthHistory` recorded them at the time.
 */
export function netWorthFromSnapshot(snap: BalanceSnapshot): number {
  const equity = computeEquityBreakdown(snap.assets).totalEquity;
  const debt = (snap.debts ?? []).reduce((s, d) => s + Math.max(0, d.balance), 0);
  return Math.round(equity - debt);
}

/**
 * Fill a fixed month grid from a sparse array of known anchor values (one per
 * grid index, `null` where unknown). Gaps are filled and tagged `estimated`:
 *   - between two anchors → linear interpolation,
 *   - before the first anchor → gentle back-projection at ~6%/yr,
 *   - after the last anchor → carry the previous value forward.
 * Shared by both series builders so there is one interpolation definition.
 */
function fillSeries(monthKeys: string[], values: (number | null)[]): NetWorthPoint[] {
  const anchorIdx = values.flatMap((v, i) => (v !== null ? [i] : []));

  return monthKeys.map((monthKey, i) => {
    if (values[i] !== null) return { monthKey, value: values[i] as number, estimated: false };

    const prev = anchorIdx.filter(a => a < i).pop();
    const next = anchorIdx.find(a => a > i);
    let value: number;
    if (prev !== undefined && next !== undefined) {
      // Linear interpolation between the surrounding anchors.
      const t = (i - prev) / (next - prev);
      value = (values[prev] as number) + ((values[next] as number) - (values[prev] as number)) * t;
    } else if (next !== undefined) {
      // Leading gap → gentle back-projection from the first anchor.
      value = (values[next] as number) / Math.pow(MONTHLY_GROWTH, next - i);
    } else if (prev !== undefined) {
      // Trailing gap → carry the previous value.
      value = values[prev] as number;
    } else {
      // No anchors at all — degenerate; keep it a finite 0 rather than NaN.
      value = 0;
    }
    return { monthKey, value: Math.round(value), estimated: true };
  });
}

/**
 * Build a net-worth series over the given chronological `monthKeys`.
 *
 * `history` supplies recorded anchor values; the LAST month is always anchored
 * to `currentNetWorth` (unless history already has it). Months without an anchor
 * are filled and tagged `estimated`.
 */
export function buildNetWorthSeries(
  monthKeys: string[],
  history: Record<string, number>,
  currentNetWorth: number,
): NetWorthPoint[] {
  const last = monthKeys.length - 1;
  const values = monthKeys.map((k, i) => {
    if (i === last) return history[k] ?? Math.round(currentNetWorth);
    return history[k] ?? null;
  });
  return fillSeries(monthKeys, values);
}

/**
 * The one precedence definition (HISTORY_PLAN §4.2) reconciling the two history
 * stores. Per month, the anchor value is:
 *   1. the snapshot-derived net worth, when a snapshot exists (authoritative);
 *   2. else the scalar `netWorthHistory[month]` (lightweight hand-backfill / the
 *      pre-debt-historization era);
 *   3. else interpolation, tagged `estimated`.
 * The last month still anchors to the live `currentNetWorth` when neither store
 * has it, so the chart can never diverge from the headline figure.
 */
export function netWorthSeriesFrom(
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
  monthKeys: string[],
  currentNetWorth: number,
): NetWorthPoint[] {
  const last = monthKeys.length - 1;
  const values = monthKeys.map((k, i) => {
    const snap = snapshots[k];
    if (snap) return netWorthFromSnapshot(snap);
    if (k in history) return history[k];
    if (i === last) return Math.round(currentNetWorth);
    return null;
  });
  return fillSeries(monthKeys, values);
}
