import { describe, it, expect } from 'vitest';
import { monthKeyFromDate, addMonthsKey, monthsBetween, yearOf } from './date';

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

describe('yearOf', () => {
  it('extracts the year from a month key', () => {
    expect(yearOf('2026-07')).toBe(2026);
  });

  it('extracts the year from a full date key', () => {
    expect(yearOf('2024-12-31')).toBe(2024);
  });
});
