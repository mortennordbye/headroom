/**
 * Year-keyed Norwegian constants for the company model (companyCost.ts): the
 * public holidays that fall on a weekday, and the corporate tax rate. Same
 * pattern as `TAX_PARAMS` in norwegianTax.ts: add next year's entry here.
 */

// Public holidays (helligdager and the two høytidsdager 1 and 17 May), ISO dates.
// Weekend dates are listed too, so the list is the full year and the weekday
// count is derived, not typed in.
// Sources: lov om helligdager og helligdagsfred § 2
// (https://lovdata.no/dokument/NL/lov/1995-02-24-12) for the days, lov om
// 1. og 17. mai som høgtidsdager (https://lovdata.no/dokument/NL/lov/1947-04-26-1).
// Easter Sunday 2026 is 5 April; the other movable days follow from it (§ 2).
export const PUBLIC_HOLIDAYS: Record<number, string[]> = {
  2026: [
    '2026-01-01', // Første nyttårsdag (Thu)
    '2026-04-02', // Skjærtorsdag (Thu)
    '2026-04-03', // Langfredag (Fri)
    '2026-04-05', // Første påskedag (Sun)
    '2026-04-06', // Andre påskedag (Mon)
    '2026-05-01', // Offentlig høytidsdag (Fri)
    '2026-05-14', // Kristi himmelfartsdag (Thu)
    '2026-05-17', // Grunnlovsdag (Sun)
    '2026-05-24', // Første pinsedag (Sun)
    '2026-05-25', // Andre pinsedag (Mon)
    '2026-12-25', // Første juledag (Fri)
    '2026-12-26', // Andre juledag (Sat)
  ],
};

// Corporate income tax (skatt på alminnelig inntekt for selskap), percent.
// Source: regjeringen.no, Skattesatser 2026
// (https://www.regjeringen.no/no/tema/okonomi-og-budsjett/skatter-og-avgifter/skattesatser-2026/id3121978/).
export const CORPORATE_TAX_PCT: Record<number, number> = {
  2025: 22,
  2026: 22,
};

/** The newest year at or before `year` that has an entry in `table`, else the oldest. */
function knownYear(table: Record<number, unknown>, year: number): number {
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const past = years.filter((y) => y <= year);
  return past.length > 0 ? past[past.length - 1] : years[0];
}

const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** Monday–Friday days in a calendar year (2026: 261). */
export function weekdaysInYear(year: number): number {
  let n = 0;
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWeekday(d)) n++;
  }
  return n;
}

/**
 * Public holidays that fall on a weekday (2026: 8). A year without a list uses
 * the newest known year's count, as an estimate.
 */
export function weekdayHolidays(year: number): number {
  const list = PUBLIC_HOLIDAYS[knownYear(PUBLIC_HOLIDAYS, year)];
  return list.filter((iso) => isWeekday(new Date(`${iso}T00:00:00Z`))).length;
}

/** Corporate tax % for `year` (the newest known year when not listed). */
export function corporateTaxPct(year: number): number {
  return CORPORATE_TAX_PCT[knownYear(CORPORATE_TAX_PCT, year)];
}
