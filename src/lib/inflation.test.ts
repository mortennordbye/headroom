import { describe, it, expect } from 'vitest';
import { latestInflationPct, inTodaysKroner, DEFAULT_INFLATION_PCT } from './inflation';

const point = (month: string, cpiIndex: number) => ({ month, cpiIndex, yoyPercent: 0 });

describe('latestInflationPct', () => {
  it('is the newest month against the same month a year earlier', () => {
    expect(latestInflationPct([point('2025-09', 100), point('2026-09', 103.4), point('2026-08', 103)])).toBe(3.4);
  });

  it('falls back to the default without a usable 12-month pair', () => {
    expect(latestInflationPct([])).toBe(DEFAULT_INFLATION_PCT);
    expect(latestInflationPct([point('2026-09', 103)])).toBe(DEFAULT_INFLATION_PCT);
    expect(latestInflationPct([point('2025-09', 0), point('2026-09', 103)])).toBe(DEFAULT_INFLATION_PCT);
    expect(latestInflationPct([point('2025-09', 105), point('2026-09', 103)])).toBe(DEFAULT_INFLATION_PCT);
  });
});

describe('inTodaysKroner', () => {
  it('discounts by compound inflation over the years', () => {
    expect(inTodaysKroner(1000, 1, 3)).toBeCloseTo(970.87, 2);
    expect(inTodaysKroner(1_000_000, 44, 3)).toBeCloseTo(1_000_000 / Math.pow(1.03, 44), 2);
  });

  it('leaves the amount alone with no years or no inflation', () => {
    expect(inTodaysKroner(500, 0, 3)).toBe(500);
    expect(inTodaysKroner(500, 10, 0)).toBe(500);
  });
});
