import { describe, it, expect } from 'vitest';
import { buildNetWorthSeries, netWorthFromSnapshot, netWorthSeriesFrom } from './netWorth';
import type { BalanceSnapshot } from '../context/FinanceContext';

// Minimal snapshot — netWorthFromSnapshot only reads `assets` (through the
// ??-guarded equity fn) and `debts`, so the rest can be cast away.
const snap = (assets: Record<string, number>, debts?: { balance: number }[]): BalanceSnapshot =>
  ({ assets, debts } as unknown as BalanceSnapshot);

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

describe('netWorthFromSnapshot', () => {
  it('is post-tax equity minus non-mortgage debts', () => {
    // portfolio 100 (no gain) + savings 50 + houseValue 300 − houseDebt 200 = 250 equity
    const s = snap({ portfolio: 100, savings: 50, houseValue: 300, houseDebt: 200 }, [{ balance: 40 }]);
    expect(netWorthFromSnapshot(s)).toBe(250 - 40);
  });

  it('renders equity-only when the snapshot predates debt historization', () => {
    const s = snap({ savings: 1000 }); // no debts field
    expect(netWorthFromSnapshot(s)).toBe(1000);
  });

  it('does not NaN on a v1 snapshot missing most asset fields', () => {
    expect(netWorthFromSnapshot(snap({}))).toBe(0);
  });

  it('guards a debt object missing/NaN its balance (no NaN leak to the chart)', () => {
    const s = snap({ savings: 1000 }, [{} as { balance: number }, { balance: NaN }]);
    expect(netWorthFromSnapshot(s)).toBe(1000); // bad debts count as 0, not NaN
  });
});

describe('netWorthSeriesFrom', () => {
  const keys = ['2026-01', '2026-02', '2026-03'];

  it('prefers the snapshot-derived value over the scalar history', () => {
    const snapshots = { '2026-02': snap({ savings: 500 }) };
    const history = { '2026-02': 999 }; // disagrees; snapshot wins
    const series = netWorthSeriesFrom(snapshots, history, keys, 0);
    expect(series[1]).toEqual({ monthKey: '2026-02', value: 500, estimated: false });
  });

  it('falls back to scalar history when no snapshot exists', () => {
    const series = netWorthSeriesFrom({}, { '2026-01': 100, '2026-03': 300 }, keys, 0);
    expect(series[0]).toEqual({ monthKey: '2026-01', value: 100, estimated: false });
    expect(series[1]).toEqual({ monthKey: '2026-02', value: 200, estimated: true }); // interpolated + marked
    expect(series[2]).toEqual({ monthKey: '2026-03', value: 300, estimated: false });
  });

  it('anchors the last month to live net worth when neither store has it', () => {
    const series = netWorthSeriesFrom({}, {}, keys, 1234.6);
    expect(series[2]).toEqual({ monthKey: '2026-03', value: 1235, estimated: false });
    expect(series[0].estimated).toBe(true);
  });
});
