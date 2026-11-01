import { describe, it, expect } from 'vitest';
import { incomeDiffPct, isIncomeOverrideStale } from './income';

describe('incomeDiffPct', () => {
  it('reports the percentage above/below the trailing average', () => {
    expect(incomeDiffPct(55000, 50000)).toBeCloseTo(10, 6);
    expect(incomeDiffPct(45000, 50000)).toBeCloseTo(-10, 6);
    expect(incomeDiffPct(50000, 50000)).toBe(0);
  });

  it('returns 0 when there is no positive baseline (no divide-by-zero)', () => {
    expect(incomeDiffPct(55000, 0)).toBe(0);
    expect(incomeDiffPct(55000, -100)).toBe(0);
  });
});

describe('isIncomeOverrideStale', () => {
  it('is stale when the override differs from the derived net by 1 kr or more', () => {
    expect(isIncomeOverrideStale(50000, 52000)).toBe(true);
    expect(isIncomeOverrideStale(50000, 49999)).toBe(true);
  });

  it('treats sub-krone differences as equal', () => {
    expect(isIncomeOverrideStale(50000, 50000)).toBe(false);
    expect(isIncomeOverrideStale(50000.4, 50000)).toBe(false);
  });

  it('is never stale without a usable override or derived figure', () => {
    expect(isIncomeOverrideStale(undefined, 50000)).toBe(false);
    expect(isIncomeOverrideStale(Number.NaN, 50000)).toBe(false);
    expect(isIncomeOverrideStale(50000, Number.NaN)).toBe(false);
  });
});
