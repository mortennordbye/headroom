import { describe, it, expect } from 'vitest';
import { birthYearFrom } from './profile';

describe('birthYearFrom', () => {
  it('parses the four-digit year from a YYYY-MM-DD string', () => {
    expect(birthYearFrom('1990-05-12')).toBe(1990);
  });

  it('returns 0 when absent, invalid, or at/before 1900', () => {
    expect(birthYearFrom(undefined)).toBe(0);
    expect(birthYearFrom('not-a-date')).toBe(0);
    expect(birthYearFrom('1900-01-01')).toBe(0);
  });
});
