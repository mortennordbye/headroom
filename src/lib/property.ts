import type { Residence } from '../context/FinanceContext';
import { addMonthsKey, currentMonthKey } from './date';

/** Whole-month difference between two 'yyyy-MM' keys (`to - from`). Negative if
 *  `to` precedes `from`. Ignores any day component. */
export function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
}

/** True when a residence has no recorded move-out (still the current home). */
function isCurrent(r: Residence): boolean {
  return r.moveOutDate == null || r.moveOutDate === '';
}

/**
 * The home the user lives in now: the entry with no `moveOutDate`, preferring the
 * latest `moveInDate` when several qualify. Falls back to the overall latest
 * `moveInDate`, else the last entry. Returns undefined for an empty list.
 */
export function currentResidence(residences: Residence[]): Residence | undefined {
  if (residences.length === 0) return undefined;
  const byMoveInDesc = (a: Residence, b: Residence) =>
    (b.moveInDate ?? '').localeCompare(a.moveInDate ?? '');
  const open = residences.filter(isCurrent).sort(byMoveInDesc);
  if (open.length > 0) return open[0];
  return [...residences].sort(byMoveInDesc)[0];
}

/** Residences sorted newest move-in first, for the history timeline. */
export function sortResidences(residences: Residence[]): Residence[] {
  return [...residences].sort((a, b) =>
    (b.moveInDate ?? '').localeCompare(a.moveInDate ?? ''));
}

export interface ResidenceMetrics {
  /** Appreciation in kr of `currentValue` over the purchase price, or null when
   *  the purchase price is unknown. */
  gainKr: number | null;
  /** Appreciation as a percent of the purchase price, or null when unknown/zero. */
  gainPct: number | null;
  /** Years owned from `moveInDate` to `nowKey`, or null when unknown. */
  yearsOwned: number | null;
  /** Compound annual growth rate as a percent, or null when it can't be derived. */
  annualizedPct: number | null;
}

/**
 * Purchase-vs-value metrics for the current home. `currentValue` is the live
 * house value (`assets.houseValue`). Every field is independently guarded so a
 * missing purchase price or move-in date yields null rather than NaN.
 */
export function residenceMetrics(
  res: Residence | undefined,
  currentValue: number,
  nowKey: string = currentMonthKey(),
): ResidenceMetrics {
  const price = res?.purchasePrice;
  const hasPrice = typeof price === 'number' && price > 0;
  const gainKr = hasPrice ? currentValue - price : null;
  const gainPct = hasPrice ? ((currentValue - price) / price) * 100 : null;

  let yearsOwned: number | null = null;
  if (res?.moveInDate) {
    const months = monthDiff(res.moveInDate, nowKey);
    yearsOwned = months > 0 ? months / 12 : null;
  }

  let annualizedPct: number | null = null;
  if (hasPrice && yearsOwned != null && yearsOwned > 0 && currentValue > 0) {
    annualizedPct = (Math.pow(currentValue / price, 1 / yearsOwned) - 1) * 100;
  }

  return { gainKr, gainPct, yearsOwned, annualizedPct };
}

export interface LoanTimeline {
  /** Payoff month 'yyyy-MM' (now + remaining term), or null when the remaining
   *  term is non-positive. Derivable without an origination date. */
  payoffDate: string | null;
  /** Whole months remaining until payoff, or null when the term is non-positive. */
  monthsRemaining: number | null;
  /** Whole months elapsed since origination, or null when `startDate` is unset. */
  monthsElapsed: number | null;
  /** Progress through the full (elapsed + remaining) term as a percent, or null
   *  when `startDate` is unset. */
  elapsedPct: number | null;
}

/**
 * Derive payoff date and elapsed/remaining months for the mortgage. In the
 * homeowner model `remainingYears` (`nedbetalingstid`) is the term left on the
 * *current* balance, so payoff = now + remaining and the origination `startDate`
 * only feeds the "elapsed" figures. Returns all-null when the remaining term is
 * non-positive; elapsed/pct stay null until a `startDate` is set.
 */
export function loanTimeline(
  startDate: string | undefined,
  remainingYears: number,
  nowKey: string = currentMonthKey(),
): LoanTimeline {
  const monthsRemaining = Math.round(remainingYears * 12);
  if (monthsRemaining <= 0) {
    return { payoffDate: null, monthsRemaining: null, monthsElapsed: null, elapsedPct: null };
  }
  const payoffDate = addMonthsKey(nowKey, monthsRemaining);

  let monthsElapsed: number | null = null;
  let elapsedPct: number | null = null;
  if (startDate) {
    monthsElapsed = Math.max(0, monthDiff(startDate, nowKey));
    const total = monthsElapsed + monthsRemaining;
    elapsedPct = total > 0 ? (monthsElapsed / total) * 100 : null;
  }
  return { payoffDate, monthsRemaining, monthsElapsed, elapsedPct };
}
