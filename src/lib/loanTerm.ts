import { monthDiff } from './property';
import { currentMonthKey } from './date';

// Remaining mortgage term (homeowner). The stored `nedbetalingstid` is in years
// (a multiple of 1/12 once months are entered) and holds the term as of
// `nedbetalingstidAsOf`. Two readers, never mixed:
//  • display (remaining term, payoff date, projections): effectiveRemainingMonths
//    counts down from the month the term was entered.
//  • money (payment, year-one interest, rentefradrag, amortization of the current
//    balance): paymentTermMonths prices the balance over the term left at the
//    month that balance was written, so an un-updated balance doesn't make the
//    payment creep upward as the display term counts down.

/** The term fields read here. Loose on purpose: snapshots and imported blobs may
 *  carry missing or wrongly-typed values. */
export interface TermFields {
  nedbetalingstid?: unknown;
  nedbetalingstidAsOf?: unknown;
  currentMortgageBalanceAsOf?: unknown;
}

const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}/.test(v);

/** Whole months in a term given in years. Non-finite or negative → 0. */
export function termMonthsFromYears(years: unknown): number {
  const n = typeof years === 'number' ? years : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 12);
}

export function splitTermMonths(months: number): { years: number; months: number } {
  const m = Number.isFinite(months) && months > 0 ? Math.round(months) : 0;
  return { years: Math.floor(m / 12), months: m % 12 };
}

/** Years (possibly fractional) from a years + months pair. */
export function yearsFromParts(years: number, months: number): number {
  return (Math.round(years) * 12 + Math.round(months)) / 12;
}

/** Remaining months at `refMonth`. A missing asOf means no countdown. */
export function effectiveRemainingMonths(h: TermFields | null | undefined, refMonth: string = currentMonthKey()): number {
  const term = termMonthsFromYears(h?.nedbetalingstid);
  if (!isMonthKey(h?.nedbetalingstidAsOf)) return term;
  return Math.max(0, term - Math.max(0, monthDiff(h.nedbetalingstidAsOf, refMonth)));
}

/** Months to price the current balance over: the term left at the balance's
 *  month. A balance older than the term entry gets the extra months back. */
export function paymentTermMonths(h: TermFields | null | undefined): number {
  const term = termMonthsFromYears(h?.nedbetalingstid);
  if (!isMonthKey(h?.nedbetalingstidAsOf) || !isMonthKey(h?.currentMortgageBalanceAsOf)) return term;
  return Math.max(0, term - monthDiff(h.nedbetalingstidAsOf, h.currentMortgageBalanceAsOf));
}

/** "24 år 3 mnd" / "24 yrs 3 mo"; a zero part is left out. */
export function formatTerm(months: number, t: { years: string; months: string }): string {
  const p = splitTermMonths(months);
  if (p.years === 0 && p.months === 0) return `0 ${t.years}`;
  const parts: string[] = [];
  if (p.years > 0) parts.push(`${p.years} ${t.years}`);
  if (p.months > 0) parts.push(`${p.months} ${t.months}`);
  return parts.join(' ');
}

/** Whole years 0-50 and months 0-11, at least one month in total. */
export function isValidTermParts(years: number, months: number): boolean {
  return Number.isInteger(years) && Number.isInteger(months)
    && years >= 0 && years <= 50 && months >= 0 && months <= 11
    && years * 12 + months >= 1;
}

/** A term saved before the countdown existed has no entry month: treat it as
 *  entered at `monthKey` (and the balance too, unless it has its own stamp).
 *  Returns the input unchanged when nothing needs stamping. */
export function stampLegacyTerm<T extends { nedbetalingstid: number; nedbetalingstidAsOf?: string; currentMortgageBalanceAsOf?: string }>(
  h: T,
  monthKey: string,
): T {
  if (!(h.nedbetalingstid > 0) || h.nedbetalingstidAsOf) return h;
  return { ...h, nedbetalingstidAsOf: monthKey, currentMortgageBalanceAsOf: h.currentMortgageBalanceAsOf ?? monthKey };
}
