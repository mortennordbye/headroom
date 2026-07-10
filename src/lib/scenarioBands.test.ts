import { describe, it, expect } from 'vitest';
import { netWorthBands } from './scenarioBands';

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
