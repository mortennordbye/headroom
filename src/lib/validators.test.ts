import { describe, it, expect } from 'vitest';
import { isValidOrgnr as serverIsValidOrgnr } from '../../server/brreg.js';
import {
  isValidOrgnr,
  parseLocaleNumber,
  isNonNegativeNumber,
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

describe('isNonNegativeNumber / isFiniteNumber', () => {
  it('accepts comma decimals', () => {
    expect(isNonNegativeNumber('4,5')).toBe(true);
    expect(isFiniteNumber('-4,5')).toBe(true);
  });

  it('accepts 0 (name reflects that it allows non-negative, not strictly > 0)', () => {
    expect(isNonNegativeNumber('0')).toBe(true);
  });

  it('rejects negatives for isNonNegativeNumber', () => {
    expect(isNonNegativeNumber('-1')).toBe(false);
    expect(isNonNegativeNumber('4,5kr')).toBe(false);
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

describe('isValidOrgnr', () => {
  it('accepts 9 digits with a correct mod-11 check digit', () => {
    expect(isValidOrgnr('923609016')).toBe(true);
    expect(isValidOrgnr('999900003')).toBe(true);
  });

  it('rejects a wrong check digit, the wrong length and anything but digits', () => {
    expect(isValidOrgnr('923609017')).toBe(false);
    expect(isValidOrgnr('92360901')).toBe(false);
    expect(isValidOrgnr('9236090160')).toBe(false);
    expect(isValidOrgnr('923 609 016')).toBe(false);
    expect(isValidOrgnr('92360901a')).toBe(false);
    expect(isValidOrgnr('')).toBe(false);
  });

  it('rejects a number whose check digit would be 10', () => {
    const weights = [3, 2, 7, 6, 5, 4, 3, 2];
    const prefixes = Array.from({ length: 100 }, (_, i) => `100000${String(i).padStart(2, '0')}`)
      .filter((p) => (11 - (weights.reduce((a, w, i) => a + w * Number(p[i]), 0) % 11)) % 11 === 10);
    expect(prefixes.length).toBeGreaterThan(0);
    for (const p of prefixes) for (let d = 0; d <= 9; d++) expect(isValidOrgnr(`${p}${d}`)).toBe(false);
  });

  it('agrees with the server twin on every check digit of many prefixes', () => {
    for (let n = 0; n < 2000; n++) {
      const prefix = String(10_000_000 + n * 44_987).slice(0, 8);
      for (let d = 0; d <= 9; d++) {
        const s = `${prefix}${d}`;
        expect(serverIsValidOrgnr(s), s).toBe(isValidOrgnr(s));
      }
    }
  });
});
