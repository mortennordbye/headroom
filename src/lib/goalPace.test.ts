import { describe, it, expect } from 'vitest';
import { goalPace, type GoalSourcePoint } from './goalPace';

const series = (...vals: [string, number][]): GoalSourcePoint[] =>
  vals.map(([monthKey, value]) => ({ monthKey, value }));

describe('goalPace', () => {
  it('projects months-to-target from the recent monthly pace', () => {
    // +5 000/mo over the window; 20 000 remaining → 4 months.
    const s = series(['2026-01', 100000], ['2026-02', 105000], ['2026-03', 110000]);
    const p = goalPace(s, 20000);
    expect(p.monthlyPace).toBeCloseTo(5000, 5);
    expect(p.monthsToTarget).toBe(4);
  });

  it('measures pace across real month gaps, not point count', () => {
    // 90k → 120k over a 6-month span = 5 000/mo despite only two points.
    const s = series(['2026-01', 90000], ['2026-07', 120000]);
    const p = goalPace(s, 10000, null, 12);
    expect(p.monthlyPace).toBeCloseTo(5000, 5);
    expect(p.monthsToTarget).toBe(2);
  });

  it('marks a goal on track when the ETA is within the deadline', () => {
    const s = series(['2026-01', 0], ['2026-02', 5000], ['2026-03', 10000]);
    // 20k remaining at 5k/mo = 4 months; deadline is 8 months out.
    const p = goalPace(s, 20000, 8);
    expect(p.onTrack).toBe(true);
    expect(p.monthsAheadOrBehind).toBe(4);
    expect(p.requiredMonthly).toBeCloseTo(2500, 5); // 20k / 8
  });

  it('marks a goal behind when the ETA overshoots the deadline', () => {
    const s = series(['2026-01', 0], ['2026-02', 1000], ['2026-03', 2000]);
    // 20k remaining at 1k/mo = 20 months; deadline is 6 months out.
    const p = goalPace(s, 20000, 6);
    expect(p.onTrack).toBe(false);
    expect(p.monthsAheadOrBehind).toBe(6 - 20);
    expect(p.requiredMonthly).toBeCloseTo(20000 / 6, 5);
  });

  it('returns no ETA when the balance is not progressing', () => {
    const s = series(['2026-01', 50000], ['2026-02', 50000], ['2026-03', 49000]);
    const p = goalPace(s, 10000, 6);
    expect(p.monthlyPace).toBeLessThanOrEqual(0);
    expect(p.monthsToTarget).toBeNull();
    expect(p.onTrack).toBeNull();
    // A required-monthly is still offered so the user knows the ask.
    expect(p.requiredMonthly).toBeCloseTo(10000 / 6, 5);
  });

  it('reports 0 months when the goal is already reached', () => {
    const s = series(['2026-01', 50000], ['2026-02', 60000]);
    const p = goalPace(s, 0, 6);
    expect(p.monthsToTarget).toBe(0);
    expect(p.requiredMonthly).toBeNull();
  });

  it('returns a flat pace with fewer than two points', () => {
    const p = goalPace(series(['2026-03', 10000]), 5000);
    expect(p.monthlyPace).toBe(0);
    expect(p.monthsToTarget).toBeNull();
  });
});
