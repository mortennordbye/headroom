import { describe, it, expect } from 'vitest';
import {
  parseLocaleNumber,
  isPositiveNumber,
  isFiniteNumber,
  isValidYearMonth,
  isValidYearMonthDay,
} from './validators';

describe('parseLocaleNumber', () => {
  it('parses plain numbers', () => {
    expect(parseLocaleNumber('4')).toBe(4);
    expect(parseLocaleNumber('4.5')).toBe(4.5);
    expect(parseLocaleNumber('-3.2')).toBe(-3.2);
    expect(parseLocaleNumber('.5')).toBe(0.5);
  });

  it('accepts the Norwegian decimal comma (AUDIT §3.13)', () => {
    expect(parseLocaleNumber('4,5')).toBe(4.5);
    expect(parseLocaleNumber('  12,75 ')).toBe(12.75);
  });

  it('rejects trailing garbage instead of truncating like parseFloat', () => {
    // parseFloat('4,5kr') === 4 — the bug this guards against.
    expect(parseLocaleNumber('4,5kr')).toBeNaN();
    expect(parseLocaleNumber('12 000')).toBeNaN();
    expect(parseLocaleNumber('1,2,3')).toBeNaN();
    expect(parseLocaleNumber('abc')).toBeNaN();
    expect(parseLocaleNumber('')).toBeNaN();
  });
});

describe('isPositiveNumber / isFiniteNumber', () => {
  it('accepts comma decimals', () => {
    expect(isPositiveNumber('4,5')).toBe(true);
    expect(isFiniteNumber('-4,5')).toBe(true);
  });

  it('rejects negatives for isPositiveNumber', () => {
    expect(isPositiveNumber('-1')).toBe(false);
    expect(isPositiveNumber('4,5kr')).toBe(false);
  });
});

describe('date validators', () => {
  it('validates YYYY-MM', () => {
    expect(isValidYearMonth('2026-07')).toBe(true);
    expect(isValidYearMonth('2026-13')).toBe(false);
    expect(isValidYearMonth('2026-7')).toBe(false);
  });

  it('rejects impossible calendar days', () => {
    expect(isValidYearMonthDay('2024-02-29')).toBe(true); // leap year
    expect(isValidYearMonthDay('2025-02-29')).toBe(false);
    expect(isValidYearMonthDay('2025-04-31')).toBe(false);
  });
});
