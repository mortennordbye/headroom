import { describe, it, expect } from 'vitest';
import { netWorthBands, withTotalBand, BAND_DELTA_PP } from './scenarioBands';
import { calcNetWorthProjectionByBucket } from './calculations';

describe('netWorthBands', () => {
  it('returns years 0..N with year 0 anchored to the start', () => {
    const bands = netWorthBands(100000, [0, 0, 0], 5, 3, 2);
    expect(bands).toHaveLength(3);
    expect(bands[0]).toEqual({ yearIndex: 0, base: 100000, bear: 100000, bull: 100000 });
  });

  it('spreads bear below and bull above the base line', () => {
    const bands = netWorthBands(100000, [0, 0, 0, 0], 5, 3, 3);
    const last = bands[bands.length - 1];
    expect(last.bear).toBeLessThan(last.base);
    expect(last.bull).toBeGreaterThan(last.base);
  });

  it('matches the base recurrence with contributions', () => {
    // start 100k, +10k/yr, 5% return, 1 year → 100000·1.05 + 10000 = 115000.
    const bands = netWorthBands(100000, [0, 10000], 5, 3, 1);
    expect(bands[1].base).toBe(115000);
    // bear at 2%: 100000·1.02 + 10000 = 112000; bull at 8%: 108000 + 10000 = 118000.
    expect(bands[1].bear).toBe(112000);
    expect(bands[1].bull).toBe(118000);
  });

  it('clamps a negative delta to zero (all three legs collapse)', () => {
    const bands = netWorthBands(100000, [0, 5000], 5, -3, 1);
    expect(bands[1].bear).toBe(bands[1].base);
    expect(bands[1].bull).toBe(bands[1].base);
  });

  it('guards a NaN start to zero', () => {
    const bands = netWorthBands(NaN, [0, 0], 5, 3, 1);
    expect(bands[0].base).toBe(0);
  });
});

describe('withTotalBand', () => {
  const rates = { stocks: 6, crypto: 10, cash: 3, house: 2 };
  const start = { stocks: 100000, crypto: 10000, cash: 50000, house: 500000 };
  const run = (r: typeof rates) => calcNetWorthProjectionByBucket(start, 20000, r, 10);

  it('contains the base total every year and pins year 0', () => {
    const base = run(rates);
    const out = withTotalBand(base, rates, BAND_DELTA_PP, run);
    expect(out).toHaveLength(base.length);
    expect(out[0].band).toEqual([base[0].total, base[0].total]);
    out.forEach(p => {
      expect(p.band[0]).toBeLessThanOrEqual(p.total);
      expect(p.band[1]).toBeGreaterThanOrEqual(p.total);
    });
    const last = out[out.length - 1];
    expect(last.band[0]).toBeLessThan(last.total);
    expect(last.band[1]).toBeGreaterThan(last.total);
  });

  it('shifts only the financial buckets, not the home', () => {
    const seen: (typeof rates)[] = [];
    withTotalBand(run(rates), rates, 3, r => { seen.push(r); return run(r); });
    expect(seen).toEqual([
      { stocks: 3, crypto: 7, cash: 0, house: 2 },
      { stocks: 9, crypto: 13, cash: 6, house: 2 },
    ]);
  });

  it('falls back to the base total for missing or non-finite legs', () => {
    const base = [{ total: 100 }, { total: 200 }];
    const out = withTotalBand(base, rates, 3, () => [{ total: NaN }]);
    expect(out.map(p => p.band)).toEqual([[100, 100], [200, 200]]);
  });

  it('treats a non-finite base total as 0 and a negative delta as no spread', () => {
    const out = withTotalBand([{ total: NaN }], rates, -3, () => [{ total: 0 }]);
    expect(out[0].band).toEqual([0, 0]);
  });
});

describe('withTotalBand with debt', () => {
  const rates = { stocks: 6, crypto: 10, cash: 3, house: 2 };

  it('wraps the plotted total (net of debt), not the stack of assets', () => {
    const start = { stocks: 50000, crypto: 0, cash: 30000, house: 400000 };
    const debt = Array.from({ length: 11 }, (_, y) => Math.max(0, 400000 - y * 40000));
    const run = (r: typeof rates) => calcNetWorthProjectionByBucket(start, 0, r, 10, undefined, debt);
    const out = withTotalBand(run(rates), rates, BAND_DELTA_PP, run);
    out.forEach(p => {
      expect(p.band[0]).toBeLessThanOrEqual(p.total);
      expect(p.band[1]).toBeGreaterThanOrEqual(p.total);
    });
    // Year 1: the stack top (assets) sits well above the band, which hugs the total.
    const y1 = out[1];
    expect(y1.stocks + y1.crypto + y1.cash + y1.house).toBeGreaterThan(y1.band[1]);
  });

  it('contains a negative total when debt exceeds assets', () => {
    const start = { stocks: 20000, crypto: 0, cash: 10000, house: 0 };
    const debt = Array(6).fill(300000);
    const run = (r: typeof rates) => calcNetWorthProjectionByBucket(start, 0, r, 5, undefined, debt);
    const out = withTotalBand(run(rates), rates, BAND_DELTA_PP, run);
    out.forEach(p => {
      expect(p.total).toBeLessThan(0);
      expect(p.band[0]).toBeLessThanOrEqual(p.total);
      expect(p.band[1]).toBeGreaterThanOrEqual(p.total);
      expect(p.band.every(Number.isFinite)).toBe(true);
    });
    expect(out[5].band[0]).toBeLessThan(out[5].band[1]);
  });
});
