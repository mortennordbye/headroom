/**
 * Market pay for IT occupations: the "Marked" marker on the Avansert salary axis.
 * The server (GET /api/wage-stats/occupation, server/wageStats.js) gives SSB's
 * agreed monthly wage × 12 for one STYRK-08 code; this moves it forward to the
 * model year.
 */

/** STYRK-08 codes the picker offers; the server allows the same list. 2523 is left out: SSB suppresses it. */
export const STYRK_CODES = ['25', '2511', '2512', '2513', '2514', '2519', '2521', '2522', '2529'] as const;
export type StyrkCode = typeof STYRK_CODES[number];
export const DEFAULT_STYRK: StyrkCode = '2512';

export const isStyrkCode = (v: unknown): v is StyrkCode =>
  typeof v === 'string' && (STYRK_CODES as readonly string[]).includes(v);

/**
 * Assumed wage growth per year from the SSB year to the model year. The app has
 * no wage-growth constant or wage index, so this is a stated round number near
 * the recent yearly growth in Norway (about 4–5 % in 2023–2025).
 */
export const MARKET_WAGE_GROWTH_PCT = 4;

/** The server's answer for one code (annual kr). */
export interface OccupationWage {
  code: string;
  available: true;
  label: string;
  year: number;
  median: number;
  p25?: number;
  p75?: number;
  measure: string;
  source: string;
  stale?: boolean;
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Move an annual wage from `fromYear` to `toYear` with the growth constant; never backwards. */
export function projectWage(annual: number, fromYear: number, toYear: number, growthPct = MARKET_WAGE_GROWTH_PCT): number {
  const years = Math.max(0, Math.round(toYear - fromYear));
  return Math.round(annual * (1 + growthPct / 100) ** years);
}

export interface MarketWage {
  year: number;
  median: number;
  /** Median, p25 and p75 moved to the model year. */
  projected: { median: number; p25: number | null; p75: number | null };
}

/**
 * Check a response from the occupation route and move it to `modelYear`. Null
 * when the median or year is not usable; a bad quartile only drops the band.
 */
export function marketWage(data: unknown, modelYear: number): MarketWage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<OccupationWage>;
  if (d.available !== true) return null;
  if (!finitePositive(d.median) || !Number.isInteger(d.year) || !Number.isFinite(modelYear)) return null;
  const year = d.year as number;
  const p = (v: unknown) => (finitePositive(v) ? projectWage(v, year, modelYear) : null);
  const p25 = p(d.p25);
  const p75 = p(d.p75);
  const band = p25 != null && p75 != null && p75 > p25;
  return {
    year,
    median: d.median,
    projected: { median: projectWage(d.median, year, modelYear), p25: band ? p25 : null, p75: band ? p75 : null },
  };
}
