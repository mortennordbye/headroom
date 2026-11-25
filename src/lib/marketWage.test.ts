import { describe, it, expect } from 'vitest';
import { projectWage, marketWage, isStyrkCode, MARKET_WAGE_GROWTH_PCT } from './marketWage';

describe('projectWage', () => {
  it('grows by the constant per year to the model year', () => {
    expect(MARKET_WAGE_GROWTH_PCT).toBe(4);
    expect(projectWage(900_000, 2025, 2026)).toBe(936_000);
    expect(projectWage(900_000, 2025, 2027)).toBe(973_440);
  });

  it('keeps the value in the same year and never projects backwards', () => {
    expect(projectWage(900_000, 2025, 2025)).toBe(900_000);
    expect(projectWage(900_000, 2025, 2023)).toBe(900_000);
  });
});

describe('marketWage', () => {
  const ok = { code: '2512', label: 'Programvareutviklere', year: 2025, median: 912_720, p25: 751_920, p75: 1_089_240, measure: 'AvtaltManedslonn', source: 'ssb-live' };

  it('projects median and quartiles to the model year', () => {
    expect(marketWage(ok, 2026)).toEqual({
      year: 2025,
      median: 912_720,
      projected: { median: 949_229, p25: 781_997, p75: 1_132_810 },
    });
  });

  it('drops the band when a quartile is missing or out of order', () => {
    expect(marketWage({ ...ok, p75: undefined }, 2025)?.projected).toEqual({ median: 912_720, p25: null, p75: null });
    expect(marketWage({ ...ok, p25: 2_000_000 }, 2025)?.projected.p25).toBeNull();
  });

  it('gives null for a response it cannot use', () => {
    expect(marketWage(null, 2026)).toBeNull();
    expect(marketWage({ error: 'SSB wage data not available' }, 2026)).toBeNull();
    expect(marketWage({ ...ok, median: Number.NaN }, 2026)).toBeNull();
    expect(marketWage({ ...ok, median: '912720' }, 2026)).toBeNull();
    expect(marketWage({ ...ok, year: 2025.5 }, 2026)).toBeNull();
    expect(marketWage(ok, Number.NaN)).toBeNull();
  });
});

describe('isStyrkCode', () => {
  it('accepts only the offered codes', () => {
    expect(isStyrkCode('2512')).toBe(true);
    expect(isStyrkCode('2523')).toBe(false);
    expect(isStyrkCode(2512)).toBe(false);
  });
});
