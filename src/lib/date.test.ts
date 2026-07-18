import { describe, it, expect } from 'vitest';
import { monthKeyFromDate, addMonthsKey, monthsBetween, yearOf, lastNMonthKeys, isBeforePayday, ageFromBirthDate } from './date';

describe('ageFromBirthDate', () => {
  const now = new Date(2026, 6, 18); // 2026-07-18

  it('counts whole years, respecting whether the birthday has passed this year', () => {
    expect(ageFromBirthDate('1990-05-01', now)).toBe(36); // birthday already passed
    expect(ageFromBirthDate('1990-09-01', now)).toBe(35); // birthday not yet this year
    expect(ageFromBirthDate('1990-07-18', now)).toBe(36); // birthday is today
  });

  it('returns null for absent, unparseable, or future dates', () => {
    expect(ageFromBirthDate(undefined, now)).toBeNull();
    expect(ageFromBirthDate('', now)).toBeNull();
    expect(ageFromBirthDate('not-a-date', now)).toBeNull();
    expect(ageFromBirthDate('2030-01-01', now)).toBeNull();
  });
});

describe('monthKeyFromDate', () => {
  it('formats a date as a local yyyy-MM key with zero-padding', () => {
    expect(monthKeyFromDate(new Date(2026, 0, 15))).toBe('2026-01');
    expect(monthKeyFromDate(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

describe('addMonthsKey', () => {
  it('adds and subtracts months within a year', () => {
    expect(addMonthsKey('2026-03', 2)).toBe('2026-05');
    expect(addMonthsKey('2026-03', -2)).toBe('2026-01');
  });

  it('rolls across year boundaries in both directions', () => {
    expect(addMonthsKey('2026-11', 3)).toBe('2027-02');
    expect(addMonthsKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthsKey('2026-01', -13)).toBe('2024-12');
  });

  it('is a no-op for delta 0', () => {
    expect(addMonthsKey('2026-07', 0)).toBe('2026-07');
  });
});

describe('monthsBetween', () => {
  it('returns an inclusive range of month keys', () => {
    expect(monthsBetween('2026-01', '2026-04')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('spans year boundaries', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('returns a single month when from === to', () => {
    expect(monthsBetween('2026-07', '2026-07')).toEqual(['2026-07']);
  });

  it('returns empty when from is after to', () => {
    expect(monthsBetween('2026-07', '2026-06')).toEqual([]);
  });
});

describe('lastNMonthKeys', () => {
  it('returns n keys ending at the anchor month, oldest first', () => {
    expect(lastNMonthKeys(new Date(2026, 6, 8), 12)).toEqual([
      '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
  });

  it('spans year boundaries and uses local time (not UTC slicing)', () => {
    expect(lastNMonthKeys(new Date(2026, 0, 1), 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('returns a single key for n = 1', () => {
    expect(lastNMonthKeys(new Date(2026, 6, 1), 1)).toEqual(['2026-07']);
  });
});

describe('yearOf', () => {
  it('extracts the year from a month key', () => {
    expect(yearOf('2026-07')).toBe(2026);
  });

  it('extracts the year from a full date key', () => {
    expect(yearOf('2024-12-31')).toBe(2024);
  });
});

describe('isBeforePayday', () => {
  const jul = (d: number) => new Date(2026, 6, d); // July 2026

  it('is false when payday is unset (0 or negative)', () => {
    expect(isBeforePayday(0, jul(1), jul(10))).toBe(false);
    expect(isBeforePayday(-5, jul(1), jul(10))).toBe(false);
  });

  it('is true before payday in the current month', () => {
    expect(isBeforePayday(25, jul(1), jul(10))).toBe(true);
  });

  it('is false on payday and after', () => {
    expect(isBeforePayday(25, jul(1), jul(25))).toBe(false);
    expect(isBeforePayday(25, jul(1), jul(31))).toBe(false);
  });

  it('never suppresses a past or future month', () => {
    expect(isBeforePayday(25, new Date(2026, 5, 1), jul(10))).toBe(false); // June viewed
    expect(isBeforePayday(25, new Date(2026, 7, 1), jul(10))).toBe(false); // August viewed
  });

  it('clamps a payday past the month length to the last day', () => {
    // Feb 2026 has 28 days; payday 31 → effective payday is the 28th.
    const feb = (d: number) => new Date(2026, 1, d);
    expect(isBeforePayday(31, feb(1), feb(27))).toBe(true);
    expect(isBeforePayday(31, feb(1), feb(28))).toBe(false);
  });
});
