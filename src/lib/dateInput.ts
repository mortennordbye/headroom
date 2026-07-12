/**
 * Forgiving parser for hand-typed month/day dates. Turns the common ways people
 * type a date into a canonical 'YYYY-MM' or 'YYYY-MM-DD', instead of rejecting
 * anything that isn't already zero-padded ISO. Accepts:
 *   - single-digit month/day:            2022-7-15  → 2022-07-15
 *   - any separator (- / . space):       2022/07/15, 15.07.2022
 *   - Norwegian day-first:               15.07.2022 → 2022-07-15
 *   - month-year only:                   07-2022, 2022-07 → 2022-07
 * Requires a 4-digit year somewhere (won't guess the century). Validates month
 * 1–12 and day against the real length of the month.
 *
 * Returns the canonical string, '' for empty input, or null when it genuinely
 * can't be understood (so the caller can show an error).
 *
 * `mode` 'month' drops any typed day; 'day' keeps it (but still allows a
 * month-only value, which some fields treat as valid).
 */
export function normalizeMonthOrDay(input: string, mode: 'month' | 'day' = 'day'): string | null {
  const s = input.trim();
  if (s === '') return '';

  const parts = s.split(/[^0-9]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;

  let year: number;
  let month: number;
  let day: number | null = null;

  if (parts[0].length === 4) {
    // Year-first: YYYY-M(-D)
    year = nums[0];
    month = nums[1];
    if (parts.length === 3) day = nums[2];
  } else if (parts[parts.length - 1].length === 4) {
    // Year-last: D-M-YYYY (day-first) or M-YYYY (month-year)
    year = nums[parts.length - 1];
    if (parts.length === 3) { day = nums[0]; month = nums[1]; }
    else { month = nums[0]; }
  } else {
    return null; // no 4-digit year → ambiguous, don't guess
  }

  if (year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  const mm = String(month).padStart(2, '0');

  if (mode === 'month' || day == null) {
    return `${year}-${mm}`;
  }

  const daysInMonth = new Date(year, month, 0).getDate(); // month is 1-based → last day
  if (day < 1 || day > daysInMonth) return null;
  return `${year}-${mm}-${String(day).padStart(2, '0')}`;
}
