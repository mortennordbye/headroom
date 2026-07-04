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

/**
 * Parse a number from user input, accepting the Norwegian decimal comma
 * ("4,5" → 4.5). Returns NaN for anything that isn't a clean number — including
 * trailing garbage like "4,5kr", which `parseFloat` would silently truncate to
 * 4. Use this in every text-input save handler instead of `parseFloat`.
 */
export function parseLocaleNumber(s: string): number {
  const cleaned = s.trim().replace(',', '.');
  // Only an optional sign, digits and at most one decimal point — nothing else.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return NaN;
  return parseFloat(cleaned);
}

export function isPositiveNumber(s: string): boolean {
  const n = parseLocaleNumber(s);
  return !isNaN(n) && isFinite(n) && n >= 0;
}

export function isFiniteNumber(s: string): boolean {
  const n = parseLocaleNumber(s);
  return !isNaN(n) && isFinite(n);
}

export function isNonEmpty(s: string): boolean {
  return s.trim().length > 0;
}
