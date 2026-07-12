import { describe, it, expect } from 'vitest';
import { normalizeMonthOrDay } from './dateInput';

describe('normalizeMonthOrDay — day mode', () => {
  it('zero-pads single-digit month and day', () => {
    expect(normalizeMonthOrDay('2022-7-15')).toBe('2022-07-15');
    expect(normalizeMonthOrDay('2024-9-1')).toBe('2024-09-01');
  });
  it('passes through canonical values unchanged', () => {
    expect(normalizeMonthOrDay('2022-07-15')).toBe('2022-07-15');
  });
  it('accepts slashes, dots and spaces as separators', () => {
    expect(normalizeMonthOrDay('2022/07/15')).toBe('2022-07-15');
    expect(normalizeMonthOrDay('2022.7.15')).toBe('2022-07-15');
    expect(normalizeMonthOrDay('2022 07 15')).toBe('2022-07-15');
  });
  it('understands Norwegian day-first dd.mm.yyyy', () => {
    expect(normalizeMonthOrDay('15.07.2022')).toBe('2022-07-15');
    expect(normalizeMonthOrDay('1-9-2024')).toBe('2024-09-01');
  });
  it('allows a month-only value (no day)', () => {
    expect(normalizeMonthOrDay('2022-7')).toBe('2022-07');
    expect(normalizeMonthOrDay('07-2022')).toBe('2022-07');
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeMonthOrDay('')).toBe('');
    expect(normalizeMonthOrDay('   ')).toBe('');
  });
  it('rejects impossible dates and ambiguous input', () => {
    expect(normalizeMonthOrDay('2022-13-01')).toBeNull(); // month 13
    expect(normalizeMonthOrDay('2022-02-30')).toBeNull(); // Feb 30
    expect(normalizeMonthOrDay('2021-02-29')).toBeNull(); // not a leap year
    expect(normalizeMonthOrDay('07-08')).toBeNull();      // no 4-digit year
    expect(normalizeMonthOrDay('abc')).toBeNull();
    expect(normalizeMonthOrDay('2022')).toBeNull();       // only a year
  });
  it('accepts a valid leap day', () => {
    expect(normalizeMonthOrDay('2024-2-29')).toBe('2024-02-29');
  });
});

describe('normalizeMonthOrDay — month mode', () => {
  it('drops any typed day', () => {
    expect(normalizeMonthOrDay('2022-7-15', 'month')).toBe('2022-07');
    expect(normalizeMonthOrDay('2022-07', 'month')).toBe('2022-07');
  });
  it('still zero-pads and accepts separators', () => {
    expect(normalizeMonthOrDay('2022/7', 'month')).toBe('2022-07');
    expect(normalizeMonthOrDay('7.2022', 'month')).toBe('2022-07');
  });
});
