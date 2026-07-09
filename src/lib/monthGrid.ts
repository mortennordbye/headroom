import { monthsBetween } from './date';

/**
 * Expand recorded rows onto a continuous monthly grid from the first to the last
 * recorded month, inserting a `gap` row for any month with no record. A line
 * chart fed this (with `connectNulls={false}` on its value series) then *breaks*
 * at unrecorded months instead of drawing a straight segment across them — so a
 * skipped month reads as a gap, not as continuous data (HISTORY_PLAN §2:
 * interpolated/absent points must be marked, never silently substituted).
 */
export function fillMonthGaps<T>(
  recorded: T[],
  monthKeyOf: (row: T) => string,
  gap: (monthKey: string) => T,
): T[] {
  if (recorded.length === 0) return [];
  const byKey = new Map(recorded.map(r => [monthKeyOf(r), r] as const));
  const first = monthKeyOf(recorded[0]);
  const last = monthKeyOf(recorded[recorded.length - 1]);
  return monthsBetween(first, last).map(k => byKey.get(k) ?? gap(k));
}
