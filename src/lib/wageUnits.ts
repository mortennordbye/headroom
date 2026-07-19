/**
 * Bidirectional wage-unit conversion for the Lønnskalkulator: convert a gross
 * annual salary into per-month / week / day / hour / minute / second rates and
 * back. Every rate derives from a single canonical annual figure, so editing any
 * unit round-trips through `toAnnual`.
 *
 * Fixed textbook assumptions (matching the common Norwegian Lønnskalkulator):
 * 52 weeks/year, 260 work days/year, 1950 work hours/year (a 37,5-hour week).
 * These are before tax and deliberately NOT tied to a job's real contracted
 * hours — the tool stays generic. `1950` and `52` were previously scattered
 * literals; this centralizes them for the calculator.
 */

export type WageUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

/** How many of each unit make up one year (the conversion divisors). */
export const WAGE_UNITS_PER_YEAR: Record<WageUnit, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 1950,
  minute: 1950 * 60,
  second: 1950 * 60 * 60,
};

/** Units in display order (annual → second). */
export const WAGE_UNIT_ORDER: WageUnit[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];

/** Guard: finite and ≥ 0, else 0 (money-math safety). */
function sane(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The rate for one unit, given the gross annual. */
export function fromAnnual(annual: number, unit: WageUnit): number {
  return sane(annual) / WAGE_UNITS_PER_YEAR[unit];
}

/** The gross annual implied by a rate entered in one unit. */
export function toAnnual(value: number, unit: WageUnit): number {
  return sane(value) * WAGE_UNITS_PER_YEAR[unit];
}

/** All seven rates for a gross annual, keyed by unit. */
export function wageBreakdown(annual: number): Record<WageUnit, number> {
  return {
    year: fromAnnual(annual, 'year'),
    month: fromAnnual(annual, 'month'),
    week: fromAnnual(annual, 'week'),
    day: fromAnnual(annual, 'day'),
    hour: fromAnnual(annual, 'hour'),
    minute: fromAnnual(annual, 'minute'),
    second: fromAnnual(annual, 'second'),
  };
}
