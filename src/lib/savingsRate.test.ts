import { describe, it, expect } from 'vitest';
import { savingsRateStatus } from './savingsRate';
import type { MonthlyCashflowRow } from './monthlyCashflow';

const row = (month: string, income: number, rate: number): MonthlyCashflowRow => ({
  month, income, variable: 0, expenses: 0, net: 0, rate,
});

describe('savingsRateStatus', () => {
  it('flags a trailing average under the target', () => {
    const rows = [row('2026-01', 50000, 30), row('2026-02', 50000, 10), row('2026-03', 50000, 8)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.trailingRate).toBeCloseTo(16, 5); // (30+10+8)/3
    expect(s.belowTarget).toBe(true);
    expect(s.shortfallPp).toBeCloseTo(4, 5);
    expect(s.months).toBe(3);
  });

  it('does not flag when the trailing average meets the target', () => {
    const rows = [row('2026-01', 50000, 22), row('2026-02', 50000, 25), row('2026-03', 50000, 20)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.belowTarget).toBe(false);
    expect(s.shortfallPp).toBe(0);
  });

  it('skips months with no income so a data gap does not fake a decline', () => {
    // Only the last real month counts; the zero-income month is ignored.
    const rows = [row('2026-01', 0, 0), row('2026-02', 0, 0), row('2026-03', 50000, 25)];
    const s = savingsRateStatus(rows, 20)!;
    expect(s.months).toBe(1);
    expect(s.trailingRate).toBeCloseTo(25, 5);
    expect(s.belowTarget).toBe(false);
  });

  it('returns null when there are no real months in the window', () => {
    const rows = [row('2026-02', 0, 0), row('2026-03', 0, 0)];
    expect(savingsRateStatus(rows, 20)).toBeNull();
  });

  it('honours a custom window length', () => {
    const rows = [row('2026-01', 50000, 40), row('2026-02', 50000, 10), row('2026-03', 50000, 10)];
    // window 2 → average of the last two months (10, 10)
    expect(savingsRateStatus(rows, 20, 2)!.trailingRate).toBeCloseTo(10, 5);
  });
});
