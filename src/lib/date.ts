import { format, parseISO, isValid, differenceInYears } from 'date-fns';

/**
 * Whole years from a 'YYYY-MM-DD' birth date to `now` (defaults to today).
 * Returns null for an absent, unparseable, or future date, so callers can hide
 * the age rather than render a nonsense number. `now` is injectable for tests.
 */
export function ageFromBirthDate(birthDate: string | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const dob = parseISO(birthDate);
  if (!isValid(dob) || dob > now) return null;
  return differenceInYears(now, dob);
}

/**
 * The current month as a 'yyyy-MM' key, in LOCAL time.
 *
 * Use this everywhere instead of `new Date().toISOString().slice(0, 7)` — the
 * ISO form is UTC, so for the first hour or two of each month (Norway is UTC+1/
 * +2) it disagrees with the local-time keys used across the rest of the app
 * (FinanceContext, SalaryPage), landing edits in the wrong month.
 */
export function currentMonthKey(): string {
  return format(new Date(), 'yyyy-MM');
}

/** A specific date as a 'yyyy-MM' key, in LOCAL time. */
export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A 'yyyy-MM' key shifted by `delta` months (negative to go back). */
export function addMonthsKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Inclusive list of 'yyyy-MM' keys from `from` to `to`. Empty if `from > to`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addMonthsKey(cur, 1);
  }
  return out;
}

/** The 4-digit year of a 'yyyy-MM' or 'yyyy-MM-DD' key (or any string starting yyyy). */
export function yearOf(monthOrDate: string): number {
  return parseInt(monthOrDate.slice(0, 4), 10);
}

/**
 * The `n` 'yyyy-MM' keys ending at `anchor`'s month, oldest first.
 * `lastNMonthKeys(new Date(2026, 6, 1), 12)` → ['2025-08', …, '2026-07'].
 * Local-time safe (unlike ISO slicing); replaces the repeated
 * `Array.from({length:n}, (_, i) => format(subMonths(anchor, n-1-i), 'yyyy-MM'))`.
 */
export function lastNMonthKeys(anchor: Date, n: number): string[] {
  const end = monthKeyFromDate(anchor);
  return Array.from({ length: n }, (_, i) => addMonthsKey(end, i - (n - 1)));
}

/**
 * Whether the viewed month is the current month and today falls before payday —
 * i.e. the paycheck hasn't landed yet, so "this month looks incomplete" nudges
 * are premature. `payday` is a day-of-month (1–31); 0 (or less) means unset and
 * never suppresses. A payday past the month's length (e.g. 31 in February) lands
 * on the last day. Only the live (current) month is gated; past/future aren't.
 */
export function isBeforePayday(payday: number, viewedMonth: Date, today: Date): boolean {
  if (payday < 1) return false;
  if (viewedMonth.getFullYear() !== today.getFullYear() || viewedMonth.getMonth() !== today.getMonth()) {
    return false;
  }
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() < Math.min(payday, daysInMonth);
}
