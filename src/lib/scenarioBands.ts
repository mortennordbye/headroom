// Scenario bands for a net-worth projection: a single deterministic line
// overstates certainty, so this runs the same year-by-year compounding at the
// base return and at ±`deltaPct` to produce bear/base/bull totals. Pure +
// unit-tested. The contributions are held identical across scenarios — they
// depend on income and savings rate, not on the return — so only the growth
// rate varies between the three legs.

/** Finite-or-0 guard. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export interface NetWorthBand {
  yearIndex: number;
  base: number;
  bear: number;
  bull: number;
}

/** Compound `start` at `ratePct`, adding `contributions[y]` after each step.
 *  Mirrors the Forecast recurrence: nw[0] = start; nw[y] = nw[y-1]·(1+r) + c[y]. */
function project(start: number, contributions: number[], ratePct: number, years: number): number[] {
  const out: number[] = [];
  let nw = start;
  for (let y = 0; y <= years; y++) {
    if (y > 0) nw = nw * (1 + ratePct / 100) + finite(contributions[y]);
    out.push(nw);
  }
  return out;
}

export function netWorthBands(
  startNetWorth: number,
  contributions: number[],
  baseReturnPct: number,
  deltaPct: number,
  years: number,
): NetWorthBand[] {
  const start = finite(startNetWorth);
  const delta = Math.max(0, deltaPct);
  const base = project(start, contributions, baseReturnPct, years);
  const bear = project(start, contributions, baseReturnPct - delta, years);
  const bull = project(start, contributions, baseReturnPct + delta, years);
  return base.map((_, y) => ({
    yearIndex: y,
    base: Math.round(base[y]),
    bear: Math.round(bear[y]),
    bull: Math.round(bull[y]),
  }));
}
