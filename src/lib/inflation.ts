// Inflation helpers shared by the Forecast and Pension pages: the current
// 12-month CPI change from the SSB series, and converting a future amount into
// today's kroner. Pure + unit-tested.
import type { InflationPoint } from '../context/FinanceContext';
import { addMonthsKey } from './date';

/** Used when the CPI series is empty or can't give a 12-month change. */
export const DEFAULT_INFLATION_PCT = 3;

/**
 * The latest 12-month CPI change in percent, to one decimal: the newest month
 * against the same month a year earlier. Falls back to DEFAULT_INFLATION_PCT
 * when the series is empty, has no point 12 months back, or isn't positive.
 */
export function latestInflationPct(points: InflationPoint[]): number {
  if (points.length === 0) return DEFAULT_INFLATION_PCT;
  let latest = points[0];
  for (const p of points) if (p.month > latest.month) latest = p;
  const prior = points.find(p => p.month === addMonthsKey(latest.month, -12));
  if (!prior || prior.cpiIndex <= 0) return DEFAULT_INFLATION_PCT;
  const pct = (latest.cpiIndex / prior.cpiIndex - 1) * 100;
  return Number.isFinite(pct) && pct > 0 ? Math.round(pct * 10) / 10 : DEFAULT_INFLATION_PCT;
}

/** An amount `years` from now, expressed in today's kroner at `inflationPct` a year. */
export function inTodaysKroner(amount: number, years: number, inflationPct: number): number {
  const factor = Math.pow(1 + Math.max(0, inflationPct) / 100, Math.max(0, years));
  return Number.isFinite(factor) && factor > 0 ? amount / factor : amount;
}
