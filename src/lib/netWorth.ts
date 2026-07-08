export interface NetWorthPoint {
  monthKey: string;
  value: number;
  estimated: boolean;
}

const MONTHLY_GROWTH = 1.005; // ~6% annual, for back-projecting leading gaps

/**
 * Build a net-worth series over the given chronological `monthKeys`.
 *
 * `history` supplies recorded anchor values; the LAST month is always anchored
 * to `currentNetWorth` (unless history already has it). Months without an
 * anchor are filled and tagged `estimated`:
 *   - between two anchors → linear interpolation,
 *   - before the first anchor → gentle back-projection at ~6%/yr,
 *   - after the last anchor → carry the previous value forward.
 */
export function buildNetWorthSeries(
  monthKeys: string[],
  history: Record<string, number>,
  currentNetWorth: number,
): NetWorthPoint[] {
  const last = monthKeys.length - 1;

  // Known anchor values per grid index (current month = live net worth).
  const values: (number | null)[] = monthKeys.map((k, i) => {
    if (i === last) return history[k] ?? Math.round(currentNetWorth);
    return history[k] ?? null;
  });
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
    } else {
      // Trailing gap (only if no later anchor) → carry the previous value.
      value = values[prev as number] as number;
    }
    return { monthKey, value: Math.round(value), estimated: true };
  });
}
