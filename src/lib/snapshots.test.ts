import { describe, it, expect } from 'vitest';
import { nearestSnapshot, historyRows, buildManualSnapshot, resolveMonthView, fixedExpensesForMonth, snapshotHasAssumptions, type SnapshotBalances } from './snapshots';
import { netWorthFromSnapshot } from './netWorth';
import type { BalanceSnapshot, FixedExpense } from '../context/FinanceContext';

const mk = (source: 'auto' | 'manual' = 'auto'): BalanceSnapshot =>
  ({ source, assets: {} } as unknown as BalanceSnapshot);

describe('resolveMonthView', () => {
  const recorded = ['2026-01', '2026-03', '2026-06'];
  const now = '2026-07';

  it('treats the current month as live', () => {
    expect(resolveMonthView(recorded, now, now)).toEqual({ activeKey: now, mode: 'live' });
  });

  it('treats a future month as projected, keeping the picked month', () => {
    // Not 'live': a future month used to resolve to today's balances, which left
    // the page editable under next month's label.
    expect(resolveMonthView(recorded, '2026-09', now)).toEqual({ activeKey: '2026-09', mode: 'projected' });
  });

  it('projects a future month even with nothing recorded', () => {
    expect(resolveMonthView([], '2026-08', now)).toEqual({ activeKey: '2026-08', mode: 'projected' });
  });

  it('snaps a past month with an exact snapshot to itself, read-only', () => {
    expect(resolveMonthView(recorded, '2026-03', now)).toEqual({ activeKey: '2026-03', mode: 'recorded' });
  });

  it('snaps a past gap month to the latest recorded month at or before it', () => {
    expect(resolveMonthView(recorded, '2026-05', now)).toEqual({ activeKey: '2026-03', mode: 'recorded' });
  });

  it('falls back to the earliest recorded month when nothing is that early', () => {
    expect(resolveMonthView(recorded, '2025-11', now)).toEqual({ activeKey: '2026-01', mode: 'recorded' });
  });

  it('degrades to live when nothing is recorded (a past view can only show live)', () => {
    expect(resolveMonthView([], '2026-03', now)).toEqual({ activeKey: now, mode: 'live' });
  });

  it('treats snapping to the current month as live, not read-only history', () => {
    // Only the current month has a snapshot (the common case): viewing an earlier
    // month has nothing older to show, so it degrades to live rather than showing
    // today's data read-only under a past label.
    expect(resolveMonthView([now], '2026-03', now)).toEqual({ activeKey: now, mode: 'live' });
  });

  it('does not assume the input array is sorted', () => {
    expect(resolveMonthView(['2026-06', '2026-01', '2026-03'], '2026-04', now))
      .toEqual({ activeKey: '2026-03', mode: 'recorded' });
  });
});

describe('nearestSnapshot', () => {
  const snaps = { '2026-01': mk(), '2026-03': mk('manual'), '2026-06': mk() };

  it('prefers the nearest older month', () => {
    expect(nearestSnapshot(snaps, '2026-05')).toBe(snaps['2026-03']);
  });

  it('falls back to the nearest newer month when nothing older exists', () => {
    expect(nearestSnapshot(snaps, '2025-12')).toBe(snaps['2026-01']);
  });

  it('ignores the target month itself as a source', () => {
    expect(nearestSnapshot(snaps, '2026-03')).toBe(snaps['2026-01']);
  });

  it('returns null when there are no snapshots', () => {
    expect(nearestSnapshot({}, '2026-05')).toBeNull();
  });
});

describe('historyRows', () => {
  it('lists every month earliest→now, newest first, tagged by source', () => {
    const rows = historyRows({ '2026-01': mk('auto'), '2026-03': mk('manual') }, {}, '2026-04');
    expect(rows.map(r => r.monthKey)).toEqual(['2026-04', '2026-03', '2026-02', '2026-01']);
    expect(rows.map(r => r.state)).toEqual(['missing', 'manual', 'missing', 'auto']);
  });

  it('crosses a year boundary correctly', () => {
    const rows = historyRows({ '2025-11': mk() }, {}, '2026-02');
    expect(rows.map(r => r.monthKey)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });

  it('extends the grid before the earliest anchor with monthsBefore', () => {
    const rows = historyRows({ '2026-03': mk() }, {}, '2026-03', 2);
    expect(rows.map(r => r.monthKey)).toEqual(['2026-03', '2026-02', '2026-01']);
    expect(rows.every(r => r.monthKey === '2026-03' ? r.state === 'auto' : r.state === 'missing')).toBe(true);
  });

  it('includes scalar-history months as anchors even without a snapshot', () => {
    const rows = historyRows({}, { '2025-12': 100 }, '2026-01');
    expect(rows.map(r => r.monthKey)).toEqual(['2026-01', '2025-12']);
    expect(rows.every(r => r.state === 'missing')).toBe(true);
  });
});

describe('buildManualSnapshot', () => {
  const base: BalanceSnapshot = {
    assets: { portfolio: 1, savings: 0, savingsAccounts: [], bsu: 0, bufferAccount: 0, houseValue: 1, houseDebt: 1, crypto: 0 },
    loan: { rente: 4 }, pension: { otpBalance: 0, ipsBalance: 0 },
    homeowner: { currentMortgageBalance: 1, rente: 4 },
    transition: { currentHouseValue: 1, currentMortgageBalance: 1 },
    housingMode: 'homeowner',
    fixedExpenses: [{ id: 'fx', name: 'Rent', amount: 100 }],
  } as unknown as BalanceSnapshot;

  const balances: SnapshotBalances = {
    savingsAccounts: [{ id: 's1', name: 'Spare', balance: 5000 }],
    bsu: 1000, bufferAccount: 2000, portfolio: 300000, crypto: 40000,
    houseValue: 4000000, houseDebt: 2800000,
    debts: [{ id: 'd1', name: 'Card', type: 'credit_card', balance: 12000, rate: 20, minPayment: 500 }],
    otpBalance: 150000, ipsBalance: 30000,
  };

  it('overlays balances, mirrors the house value and drops old balance copies', () => {
    const s = buildManualSnapshot(base, balances, '2026-03');
    expect(s.assets.houseDebt).toBe(2800000);
    expect(s.homeowner).not.toHaveProperty('currentMortgageBalance');
    expect(s.transition).not.toHaveProperty('currentMortgageBalance');
    expect(s.transition.currentHouseValue).toBe(4000000);
    expect(s.pension.otpBalance).toBe(150000);
    expect(s.debts).toEqual(balances.debts);
    expect(s.source).toBe('manual');
    expect(s.v).toBe(2);
  });

  it("writes the month's co-owners when given, else keeps base's", () => {
    const rows = [{ id: 'c', name: 'C', ownershipPct: 50 }];
    expect(buildManualSnapshot(base, balances, '2026-03', rows).assets.coOwners).toEqual(rows);
    expect(buildManualSnapshot({ ...base, assets: { ...base.assets, coOwners: rows } }, balances, '2026-03').assets.coOwners).toEqual(rows);
    expect(buildManualSnapshot(base, balances, '2026-03').assets.coOwners).toBeUndefined();
  });

  it('stamps the mortgage balance as of the snapshot month', () => {
    const s = buildManualSnapshot({ ...base, homeowner: { ...base.homeowner, currentMortgageBalanceAsOf: '2026-09' } }, balances, '2026-03');
    expect(s.homeowner.currentMortgageBalanceAsOf).toBe('2026-03');
  });

  it('carries loan params and fixed expenses over from base untouched', () => {
    const s = buildManualSnapshot(base, balances, '2026-03');
    expect(s.loan).toEqual(base.loan);
    expect(s.fixedExpenses).toEqual(base.fixedExpenses);
  });

  it('produces a snapshot whose net worth matches the entered balances', () => {
    const s = buildManualSnapshot(base, balances, '2026-03');
    // equity: portfolio 300000 + crypto 40000 + bsu 1000 + savings 5000 + buffer 2000
    //         + (house 4000000 − debt 2800000) = 1548000; minus debt 12000
    expect(netWorthFromSnapshot(s)).toBe(1548000 - 12000);
  });
});

describe('fixedExpensesForMonth', () => {
  const live = [{ id: 'rent', amount: 12000 }] as unknown as FixedExpense[];
  const recorded = [{ id: 'rent', amount: 10000 }] as unknown as FixedExpense[];
  const snapshots = {
    '2026-05': { ...mk(), fixedExpenses: recorded },
    '2026-06': mk(),
  } as unknown as Record<string, BalanceSnapshot>;

  it("reads a past month's captured expenses", () => {
    expect(fixedExpensesForMonth(snapshots, live, '2026-05', '2026-07')).toBe(recorded);
  });

  it('falls back to live for a past month with no captured expenses', () => {
    expect(fixedExpensesForMonth(snapshots, live, '2026-06', '2026-07')).toBe(live);
    expect(fixedExpensesForMonth(snapshots, live, '2026-01', '2026-07')).toBe(live);
  });

  it('reads live for the current and future months even if a snapshot exists', () => {
    expect(fixedExpensesForMonth(snapshots, live, '2026-05', '2026-05')).toBe(live);
    expect(fixedExpensesForMonth(snapshots, live, '2026-05', '2026-04')).toBe(live);
  });
});

describe('snapshotHasAssumptions', () => {
  it('is false for a v1 snapshot with no recorded assumptions', () => {
    expect(snapshotHasAssumptions(mk())).toBe(false);
  });

  it('is true when the month recorded its assumptions', () => {
    const snap = { ...mk(), assumptions: { savingsTargetPercent: 20, growthReturnRate: 7, houseGrowthRate: 3 } };
    expect(snapshotHasAssumptions(snap)).toBe(true);
  });
});
