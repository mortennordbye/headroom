/**
 * Input validation helpers shared by modal save handlers.
 * Each returns true when the input is valid.
 */

/** 'YYYY-MM' with month in 01–12. */
export function isValidYearMonth(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  return month >= 1 && month <= 12;
}

/** 'YYYY-MM-DD' that actually parses to the same date (rejects 2024-02-31 etc). */
export function isValidYearMonthDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Optional YYYY-MM (empty string allowed). */
export function isOptionalYearMonth(s: string): boolean {
  return s === '' || isValidYearMonth(s);
}

export function isPositiveNumber(s: string): boolean {
  const n = parseFloat(s);
  return !isNaN(n) && isFinite(n) && n >= 0;
}

export function isFiniteNumber(s: string): boolean {
  const n = parseFloat(s);
  return !isNaN(n) && isFinite(n);
}

export function isNonEmpty(s: string): boolean {
  return s.trim().length > 0;
}
