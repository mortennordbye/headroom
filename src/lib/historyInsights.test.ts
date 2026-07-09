import { describe, it, expect } from 'vitest';
import { computeHistoryInsights } from './historyInsights';
import type { BalanceSnapshot } from '../context/FinanceContext';

// Snapshot carrying just what the insight readers touch (equity assets, mortgage, debts).
const snap = (over: { savings?: number; mortgage?: number; debt?: number }): BalanceSnapshot => ({
  housingMode: 'homeowner',
  assets: { savings: over.savings ?? 0, houseDebt: over.mortgage ?? 0 },
  homeowner: { currentMortgageBalance: over.mortgage ?? 0, rente: 5, nedbetalingstid: 25 },
  debts: over.debt !== undefined ? [{ id: 'd', name: 'D', type: 'consumer', balance: over.debt, rate: 10, minPayment: 500 }] : [],
} as unknown as BalanceSnapshot);

describe('computeHistoryInsights', () => {
  it('reports equity change over 6/12 months from recorded net worth', () => {
    const snapshots = {
      '2025-07': snap({ savings: 1_000_000 }), // 12 months ago
      '2026-01': snap({ savings: 1_100_000 }), // 6 months ago
    };
    const r = computeHistoryInsights(snapshots, {}, 1_200_000, '2026-07');
    expect(r.equity12).toEqual({ months: 12, abs: 200_000, pct: 20 });
    expect(r.equity6).toEqual({ months: 6, abs: 100_000, pct: expect.closeTo(9.09, 1) });
  });

  it('falls back to scalar history when a baseline month has no snapshot', () => {
    const r = computeHistoryInsights({}, { '2026-01': 500_000 }, 560_000, '2026-07');
    expect(r.equity6).toEqual({ months: 6, abs: 60_000, pct: 12 });
    expect(r.equity12).toBeNull(); // nothing 12 months back
  });

  it('returns null equity insights when the baseline month is unrecorded', () => {
    const r = computeHistoryInsights({}, {}, 100_000, '2026-07');
    expect(r.equity6).toBeNull();
    expect(r.equity12).toBeNull();
  });

  it('surfaces mortgage & debt plan status only with ≥2 recorded months', () => {
    const one = computeHistoryInsights({ '2026-07': snap({ mortgage: 2_000_000, debt: 50_000 }) }, {}, 0, '2026-07');
    expect(one.mortgageMonthsAhead).toBeNull();
    expect(one.debtAheadBy).toBeNull();

    const two = computeHistoryInsights({
      '2026-06': snap({ mortgage: 2_000_000, debt: 50_000 }),
      '2026-07': snap({ mortgage: 1_988_000, debt: 46_000 }),
    }, {}, 0, '2026-07');
    expect(typeof two.mortgageMonthsAhead).toBe('number');
    expect(typeof two.debtAheadBy).toBe('number');
  });
});
