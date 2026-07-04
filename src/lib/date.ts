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
