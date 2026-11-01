// Scenario bands for a net-worth projection: a single deterministic line
// overstates certainty, so this runs the same year-by-year compounding at the
// base return and at ±`deltaPct` to produce bear/base/bull totals. Pure +
// unit-tested. The contributions are held identical across scenarios — they
// depend on income and savings rate, not on the return — so only the growth
// rate varies between the three legs.

import type { BucketRates } from './calculations';

/** Return spread (percentage points) either side of the base for every band. */
export const BAND_DELTA_PP = 3;

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

/**
 * Bear/bull band around the total of a stacked bucket projection (Assets growth,
 * Dashboard 15-year). Uses the Forecast band's ±`deltaPct` spread with the home
 * held to its own path, but it is not the same calculation: each financial
 * bucket (stocks, crypto, cash) has its own rate shifted, and `project` reruns
 * the chart's own model per leg, so wealth tax is recomputed for each. The band
 * follows that chart's `total` (assets less all debt) and always contains it.
 * Non-finite legs fall back to the base total.
 */
export function withTotalBand<P extends { total: number }>(
  base: P[],
  rates: BucketRates,
  deltaPct: number,
  project: (rates: BucketRates) => { total: number }[],
): (P & { band: [number, number] })[] {
  const delta = Math.max(0, finite(deltaPct));
  const shift = (d: number): BucketRates => ({
    ...rates,
    stocks: rates.stocks + d,
    crypto: rates.crypto + d,
    cash: rates.cash + d,
  });
  const bear = project(shift(-delta));
  const bull = project(shift(delta));
  return base.map((p, i) => {
    const total = finite(p.total);
    const lo = Number.isFinite(bear[i]?.total) ? bear[i].total : total;
    const hi = Number.isFinite(bull[i]?.total) ? bull[i].total : total;
    return { ...p, band: [Math.min(lo, hi, total), Math.max(lo, hi, total)] };
  });
}
