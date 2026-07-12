import { describe, it, expect } from 'vitest';
import type { Residence } from '../context/FinanceContext';
import {
  monthDiff,
  currentResidence,
  sortResidences,
  residenceMetrics,
  loanTimeline,
} from './property';

const res = (over: Partial<Residence>): Residence => ({
  id: over.id ?? 'r1',
  address: over.address ?? 'Somewhere 1',
  ...over,
});

describe('monthDiff', () => {
  it('counts whole months forward', () => {
    expect(monthDiff('2020-01', '2021-01')).toBe(12);
    expect(monthDiff('2020-01', '2020-04')).toBe(3);
  });
  it('is negative when to precedes from and 0 for equal', () => {
    expect(monthDiff('2021-01', '2020-01')).toBe(-12);
    expect(monthDiff('2022-06', '2022-06')).toBe(0);
  });
  it('ignores a day component', () => {
    expect(monthDiff('2020-01-15', '2020-03-02')).toBe(2);
  });
});

describe('currentResidence', () => {
  it('returns undefined for an empty list', () => {
    expect(currentResidence([])).toBeUndefined();
  });
  it('picks the open (no move-out) entry, latest move-in wins', () => {
    const a = res({ id: 'a', moveInDate: '2015-01', moveOutDate: '2020-01' });
    const b = res({ id: 'b', moveInDate: '2020-02', moveOutDate: null });
    expect(currentResidence([a, b])?.id).toBe('b');
  });
  it('falls back to the latest move-in when all are closed', () => {
    const a = res({ id: 'a', moveInDate: '2010-01', moveOutDate: '2015-01' });
    const b = res({ id: 'b', moveInDate: '2016-01', moveOutDate: '2019-01' });
    expect(currentResidence([a, b])?.id).toBe('b');
  });
});

describe('sortResidences', () => {
  it('orders newest move-in first without mutating input', () => {
    const input = [
      res({ id: 'a', moveInDate: '2015-01' }),
      res({ id: 'b', moveInDate: '2020-01' }),
      res({ id: 'c', moveInDate: '2018-01' }),
    ];
    expect(sortResidences(input).map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(input.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('residenceMetrics', () => {
  it('computes gain, years owned and annualized return', () => {
    const r = res({ purchasePrice: 3_000_000, moveInDate: '2020-01' });
    const m = residenceMetrics(r, 3_630_000, '2023-01'); // 3 years, +21%
    expect(m.gainKr).toBe(630_000);
    expect(m.gainPct).toBeCloseTo(21, 5);
    expect(m.yearsOwned).toBeCloseTo(3, 5);
    // 1.21^(1/3) - 1 ≈ 6.560%
    expect(m.annualizedPct).toBeCloseTo(6.560, 2);
  });
  it('returns nulls when the purchase price is missing or zero', () => {
    const m = residenceMetrics(res({ moveInDate: '2020-01' }), 4_000_000, '2023-01');
    expect(m.gainKr).toBeNull();
    expect(m.gainPct).toBeNull();
    expect(m.annualizedPct).toBeNull();
    const z = residenceMetrics(res({ purchasePrice: 0, moveInDate: '2020-01' }), 4_000_000, '2023-01');
    expect(z.gainKr).toBeNull();
  });
  it('handles an undefined residence without throwing', () => {
    const m = residenceMetrics(undefined, 4_000_000, '2023-01');
    expect(m).toEqual({ gainKr: null, gainPct: null, yearsOwned: null, annualizedPct: null });
  });
  it('yields no annualized figure when owned under a full computable year', () => {
    const r = res({ purchasePrice: 3_000_000, moveInDate: '2023-01' });
    const m = residenceMetrics(r, 3_100_000, '2023-01'); // 0 months
    expect(m.gainKr).toBe(100_000); // gain still valid
    expect(m.yearsOwned).toBeNull();
    expect(m.annualizedPct).toBeNull();
  });
});

describe('loanTimeline', () => {
  it('derives payoff from now + remaining term, and elapsed from the start date', () => {
    // Originated 2020-01, 25 years left as of 2025-01 → payoff 2050-01.
    const t = loanTimeline('2020-01', 25, '2025-01');
    expect(t.payoffDate).toBe('2050-01');
    expect(t.monthsRemaining).toBe(300);
    expect(t.monthsElapsed).toBe(60);
    // total term = 60 elapsed + 300 remaining = 360 → 16.67% elapsed
    expect(t.elapsedPct).toBeCloseTo(16.667, 2);
  });
  it('derives payoff without a start date; elapsed/pct stay null', () => {
    const t = loanTimeline(undefined, 25, '2025-01');
    expect(t.payoffDate).toBe('2050-01');
    expect(t.monthsRemaining).toBe(300);
    expect(t.monthsElapsed).toBeNull();
    expect(t.elapsedPct).toBeNull();
  });
  it('never reports negative elapsed when the start date is in the future', () => {
    const t = loanTimeline('2030-01', 25, '2025-01');
    expect(t.monthsElapsed).toBe(0);
    expect(t.elapsedPct).toBeCloseTo(0, 5);
  });
  it('returns all-null for a non-positive remaining term', () => {
    expect(loanTimeline('2020-01', 0, '2025-01')).toEqual({
      payoffDate: null, monthsRemaining: null, monthsElapsed: null, elapsedPct: null,
    });
  });
});
