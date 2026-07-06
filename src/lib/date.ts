import { format } from 'date-fns';

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
