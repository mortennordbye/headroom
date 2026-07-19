import { describe, it, expect } from 'vitest';
import {
  WAGE_UNITS_PER_YEAR,
  WAGE_UNIT_ORDER,
  fromAnnual,
  toAnnual,
  wageBreakdown,
  type WageUnit,
} from './wageUnits';

describe('WAGE_UNITS_PER_YEAR', () => {
  it('uses the fixed textbook divisors', () => {
    expect(WAGE_UNITS_PER_YEAR.month).toBe(12);
    expect(WAGE_UNITS_PER_YEAR.week).toBe(52);
    expect(WAGE_UNITS_PER_YEAR.day).toBe(260);
    expect(WAGE_UNITS_PER_YEAR.hour).toBe(1950);
  });

  it('derives minute and second from the hour divisor', () => {
    expect(WAGE_UNITS_PER_YEAR.minute).toBe(WAGE_UNITS_PER_YEAR.hour * 60);
    expect(WAGE_UNITS_PER_YEAR.second).toBe(WAGE_UNITS_PER_YEAR.hour * 60 * 60);
  });
});

describe('fromAnnual', () => {
  it('reproduces the reference calculator row for 920 000 kr', () => {
    expect(fromAnnual(920_000, 'month')).toBeCloseTo(76_666.67, 2);
    expect(fromAnnual(920_000, 'week')).toBeCloseTo(17_692.31, 2);
    expect(fromAnnual(920_000, 'day')).toBeCloseTo(3_538.46, 2);
    expect(fromAnnual(920_000, 'hour')).toBeCloseTo(471.79, 2);
    expect(fromAnnual(920_000, 'minute')).toBeCloseTo(7.86, 2);
    expect(fromAnnual(920_000, 'second')).toBeCloseTo(0.131, 3);
  });

  it('returns 0 for non-finite or negative input (no NaN leak)', () => {
    expect(fromAnnual(NaN, 'hour')).toBe(0);
    expect(fromAnnual(-100, 'month')).toBe(0);
    expect(fromAnnual(Infinity, 'year')).toBe(0);
  });
});

describe('toAnnual', () => {
  it('is the inverse of fromAnnual for every unit', () => {
    const annual = 920_000;
    for (const unit of WAGE_UNIT_ORDER) {
      expect(toAnnual(fromAnnual(annual, unit), unit)).toBeCloseTo(annual, 6);
    }
  });

  it('scales a per-hour rate back up by 1950', () => {
    expect(toAnnual(500, 'hour')).toBe(975_000);
  });

  it('returns 0 for garbage input', () => {
    expect(toAnnual(NaN, 'hour')).toBe(0);
    expect(toAnnual(-5, 'day')).toBe(0);
  });
});

describe('wageBreakdown', () => {
  it('returns all seven rates keyed by unit', () => {
    const b = wageBreakdown(920_000);
    expect(b.year).toBe(920_000);
    expect(b.hour).toBeCloseTo(471.79, 2);
    expect(Object.keys(b).sort()).toEqual([...WAGE_UNIT_ORDER].sort() as WageUnit[]);
  });
});
