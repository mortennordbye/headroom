import { describe, it, expect } from 'vitest';
import { buildNetWorthSeries } from './netWorth';

describe('buildNetWorthSeries', () => {
  it('marks every month real when all are anchored in history', () => {
    const keys = ['2026-01', '2026-02', '2026-03'];
    const history = { '2026-01': 100, '2026-02': 200, '2026-03': 300 };
    const series = buildNetWorthSeries(keys, history, 999);
    expect(series).toEqual([
      { monthKey: '2026-01', value: 100, estimated: false },
      { monthKey: '2026-02', value: 200, estimated: false },
      { monthKey: '2026-03', value: 300, estimated: false },
    ]);
  });

  it('anchors the last month to currentEquity when history lacks it', () => {
    const series = buildNetWorthSeries(['2026-01', '2026-02'], { '2026-01': 500 }, 800.4);
    expect(series[1]).toEqual({ monthKey: '2026-02', value: 800, estimated: false });
    expect(series[0].estimated).toBe(false);
  });

  it('linearly interpolates a gap between two anchors', () => {
    const keys = ['2026-01', '2026-02', '2026-03'];
    const series = buildNetWorthSeries(keys, { '2026-01': 100, '2026-03': 300 }, 999);
    expect(series[1]).toEqual({ monthKey: '2026-02', value: 200, estimated: true });
    // last month comes from history, not currentEquity
    expect(series[2]).toEqual({ monthKey: '2026-03', value: 300, estimated: false });
  });

  it('back-projects leading gaps at ~6%/yr from the first anchor', () => {
    const keys = ['2026-01', '2026-02', '2026-03'];
    const series = buildNetWorthSeries(keys, {}, 1000); // only the last month anchored
    expect(series[2]).toEqual({ monthKey: '2026-03', value: 1000, estimated: false });
    expect(series[1]).toEqual({ monthKey: '2026-02', value: Math.round(1000 / 1.005), estimated: true });
    expect(series[0]).toEqual({ monthKey: '2026-01', value: Math.round(1000 / Math.pow(1.005, 2)), estimated: true });
  });

  it('rounds interpolated values', () => {
    const series = buildNetWorthSeries(['a', 'b', 'c', 'd'], { a: 0, d: 100 }, 999);
    // t = 1/3 and 2/3 → 33.33 and 66.67 → rounded
    expect(series[1].value).toBe(33);
    expect(series[2].value).toBe(67);
    expect(series[1].estimated).toBe(true);
  });
});
