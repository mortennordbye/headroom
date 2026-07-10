// Goal completion ETA from actual pace. A goal knows its remaining amount and
// (optionally) a deadline; this projects when it's actually reached by measuring
// the recent monthly pace of its source balance (from snapshot history) and
// comparing that to the deadline. Pure + unit-tested.
//
// Pace is the per-month change across the trailing `window` months of the
// series, using real month gaps so a missing month doesn't distort it. Only the
// slope matters, so contributions and market drift are treated the same — this
// is "your recent trajectory", not a savings-only figure.

/** Finite-or-0 guard. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

const monthIndex = (key: string): number => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

const MAX_ETA_MONTHS = 1200; // 100 years — beyond this counts as "not at this pace"

export interface GoalSourcePoint {
  monthKey: string; // 'YYYY-MM'
  value: number;
}

export interface GoalPace {
  monthlyPace: number;                 // avg monthly change over the window (can be ≤ 0)
  monthsToTarget: number | null;       // ceil(remaining / pace); null if not progressing
  monthsAheadOrBehind: number | null;  // deadline − ETA; >0 = ahead (needs a deadline)
  onTrack: boolean | null;             // ETA within the deadline (needs a deadline)
  requiredMonthly: number | null;      // remaining / months to deadline (needs a deadline)
}

export function goalPace(
  series: GoalSourcePoint[],
  remaining: number,
  deadlineMonthsFromNow?: number | null,
  window = 6,
): GoalPace {
  const rem = Math.max(0, finite(remaining));
  const pts = [...series]
    .filter(p => Number.isFinite(p.value))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // Recent monthly pace: change per month across the trailing `window` months.
  let monthlyPace = 0;
  if (pts.length >= 2) {
    const lastIdx = monthIndex(pts[pts.length - 1].monthKey);
    const recent = pts.filter(p => monthIndex(p.monthKey) >= lastIdx - window);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = monthIndex(last.monthKey) - monthIndex(first.monthKey);
    if (span > 0) monthlyPace = (last.value - first.value) / span;
  }

  let monthsToTarget: number | null;
  if (rem <= 0) monthsToTarget = 0;
  else if (monthlyPace > 0) {
    const m = Math.ceil(rem / monthlyPace);
    monthsToTarget = m > MAX_ETA_MONTHS ? null : m;
  } else monthsToTarget = null;

  const hasDeadline = deadlineMonthsFromNow != null;
  const monthsAheadOrBehind =
    hasDeadline && monthsToTarget != null ? (deadlineMonthsFromNow as number) - monthsToTarget : null;
  const onTrack =
    hasDeadline && monthsToTarget != null ? monthsToTarget <= (deadlineMonthsFromNow as number) : null;
  const requiredMonthly =
    hasDeadline && (deadlineMonthsFromNow as number) > 0 && rem > 0
      ? rem / (deadlineMonthsFromNow as number)
      : null;

  return { monthlyPace, monthsToTarget, monthsAheadOrBehind, onTrack, requiredMonthly };
}
