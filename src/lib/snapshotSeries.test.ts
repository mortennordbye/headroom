import { describe, it, expect } from 'vitest';
import { savingsSeriesFrom, pensionSeriesFrom } from './snapshotSeries';
import type { BalanceSnapshot } from '../context/FinanceContext';

const snap = (savingsAccounts: { id: string; name: string; balance: number }[], pension?: { otpBalance?: number; ipsBalance?: number }): BalanceSnapshot =>
  ({ assets: { savingsAccounts }, pension } as unknown as BalanceSnapshot);

describe('savingsSeriesFrom', () => {
  it('builds a row per month with each account keyed by id, oldest → newest', () => {
    const { rows, accounts } = savingsSeriesFrom({
      '2026-02': snap([{ id: 'a', name: 'Spare', balance: 200 }]),
      '2026-01': snap([{ id: 'a', name: 'Spare', balance: 100 }]),
    });
    expect(rows.map(r => r.month)).toEqual(['2026-01', '2026-02']);
    expect(rows.map(r => r.a)).toEqual([100, 200]);
    expect(accounts).toEqual([{ id: 'a', name: 'Spare' }]);
  });

  it('unions accounts across months and fills a missing account with 0', () => {
    const { rows, accounts } = savingsSeriesFrom({
      '2026-01': snap([{ id: 'a', name: 'A', balance: 100 }]),
      '2026-02': snap([{ id: 'a', name: 'A', balance: 120 }, { id: 'b', name: 'B', balance: 50 }]),
    });
    expect(accounts.map(a => a.id).sort()).toEqual(['a', 'b']);
    expect(rows[0].b).toBe(0); // b didn't exist in Jan → 0, not undefined
    expect(rows[1].b).toBe(50);
  });

  it('guards a NaN balance to 0', () => {
    const { rows } = savingsSeriesFrom({ '2026-01': snap([{ id: 'a', name: 'A', balance: NaN }]) });
    expect(rows[0].a).toBe(0);
  });

  it('is empty for no snapshots', () => {
    expect(savingsSeriesFrom({})).toEqual({ rows: [], accounts: [] });
  });
});

describe('pensionSeriesFrom', () => {
  it('yields otp/ips per month, oldest → newest, guarding missing values', () => {
    const rows = pensionSeriesFrom({
      '2026-02': snap([], { otpBalance: 210_000, ipsBalance: 48_000 }),
      '2026-01': snap([], { otpBalance: 200_000 }), // ips missing → 0
    });
    expect(rows).toEqual([
      { month: '2026-01', otp: 200_000, ips: 0 },
      { month: '2026-02', otp: 210_000, ips: 48_000 },
    ]);
  });
});
