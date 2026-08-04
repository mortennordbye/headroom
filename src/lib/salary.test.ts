import { describe, it, expect } from 'vitest';
import { salaryAt, hoursAt, nominalHourlyRate, WEEKS_PER_MONTH, computeNewGross, priorSalaryForJob, activeJobBreakdown, salaryVsCpiYoy } from './salary';
import type { SalaryEntry, JobEntry, HoursSnapshot } from '../context/FinanceContext';

const sal = (id: string, effectiveDate: string, grossAnnual: number, jobId = 'j1'): SalaryEntry => ({
  id, jobId, effectiveDate, grossAnnual, changeType: 'raise',
});
const job = (id: string, contractedHoursPerWeek: number): JobEntry => ({
  id, startDate: '2020-01', endDate: null, employer: 'Acme', role: 'Dev', contractedHoursPerWeek,
});
const snap = (id: string, periodMonth: string, actualHoursPerWeek: number, jobId?: string): HoursSnapshot => ({
  id, periodMonth, actualHoursPerWeek, jobId,
});

describe('nominalHourlyRate', () => {
  it('divides monthly pay (base + on-call) by monthly hours', () => {
    // 37.5h/week × 4.345 weeks ≈ 162.94h/month
    expect(nominalHourlyRate(60000, 0, 37.5)).toBeCloseTo(60000 / (WEEKS_PER_MONTH * 37.5), 6);
  });

  it('counts on-call pay toward the rate', () => {
    expect(nominalHourlyRate(60000, 6000, 37.5)).toBeCloseTo(66000 / (WEEKS_PER_MONTH * 37.5), 6);
  });

  it('returns 0 for non-positive hours (no divide-by-zero)', () => {
    expect(nominalHourlyRate(60000, 0, 0)).toBe(0);
    expect(nominalHourlyRate(60000, 0, -5)).toBe(0);
  });
});

describe('salaryAt', () => {
  const salaries = [sal('a', '2024-01', 600000), sal('b', '2025-06', 700000), sal('c', '2026-02', 800000)];

  it('returns the most recent salary in effect at the month (inclusive)', () => {
    expect(salaryAt('2025-06', salaries)?.grossAnnual).toBe(700000);
    expect(salaryAt('2025-12', salaries)?.grossAnnual).toBe(700000);
    expect(salaryAt('2026-03', salaries)?.grossAnnual).toBe(800000);
  });

  it('returns null when no salary is in effect yet', () => {
    expect(salaryAt('2023-12', salaries)).toBeNull();
    expect(salaryAt('2026-01', [])).toBeNull();
  });

  it('is order-independent', () => {
    const shuffled = [salaries[2], salaries[0], salaries[1]];
    expect(salaryAt('2025-12', shuffled)?.id).toBe('b');
  });

  // calcActiveGrossAnnual (FinanceContext) reuses this selection per job, so its
  // tie-break is whatever salaryAt does: on equal effectiveDate the reduce keeps
  // the last entry in array order.
  it('breaks a same-month tie by taking the last entry in array order', () => {
    const tied = [sal('a', '2025-06', 600000), sal('b', '2025-06', 700000)];
    expect(salaryAt('2025-06', tied)?.id).toBe('b');
  });
});

describe('hoursAt', () => {
  const jobs = [job('j1', 37.5)];
  const snaps = [snap('s1', '2025-01', 40), snap('s2', '2025-08', 32)];

  it('returns the most recent hours snapshot at the month', () => {
    expect(hoursAt('2025-03', snaps, jobs, null)).toBe(40);
    expect(hoursAt('2025-09', snaps, jobs, null)).toBe(32);
  });

  it('falls back to the active job contracted hours when no snapshot applies', () => {
    expect(hoursAt('2024-12', snaps, jobs, sal('a', '2024-01', 600000))).toBe(37.5);
  });

  it('falls back to 37.5 when neither snapshot nor job resolves', () => {
    expect(hoursAt('2024-12', snaps, jobs, null)).toBe(37.5);
    expect(hoursAt('2024-12', snaps, [], sal('a', '2024-01', 600000, 'missing'))).toBe(37.5);
  });

  it('ignores a snapshot assigned to a different job, using the active job contracted hours', () => {
    const twoJobs = [job('j1', 37.5), job('j2', 20)];
    // A 40h snapshot belongs to the ended job j1; the active salary is for j2.
    const jobSnaps = [snap('s1', '2025-01', 40, 'j1')];
    expect(hoursAt('2025-06', jobSnaps, twoJobs, sal('b', '2025-05', 500000, 'j2'))).toBe(20);
  });

  it('applies a snapshot assigned to the active job', () => {
    const jobSnaps = [snap('s1', '2025-01', 40, 'j1')];
    expect(hoursAt('2025-06', jobSnaps, jobs, sal('b', '2025-05', 500000, 'j1'))).toBe(40);
  });

  it('applies unassigned snapshots to whichever job is active', () => {
    const twoJobs = [job('j1', 37.5), job('j2', 20)];
    expect(hoursAt('2025-09', snaps, twoJobs, sal('b', '2025-05', 500000, 'j2'))).toBe(32);
  });
});

describe('computeNewGross', () => {
  it('grows the prior salary by a percentage', () => {
    expect(computeNewGross('percent', 5, 678571)).toBe(712500); // 678571 * 1.05 = 712499.55 → 712500
  });

  it('adds kroner to the prior salary', () => {
    expect(computeNewGross('kr', 30000, 678571)).toBe(708571);
  });

  it('uses the amount verbatim in total mode and ignores prevGross', () => {
    expect(computeNewGross('total', 712500, 999999)).toBe(712500);
  });

  it('rounds to whole kroner', () => {
    expect(computeNewGross('percent', 3.3, 500000)).toBe(516500);
    expect(computeNewGross('total', 500000.7, 0)).toBe(500001);
  });

  it('handles a zero base without dividing or NaN', () => {
    expect(computeNewGross('percent', 5, 0)).toBe(0);
    expect(computeNewGross('kr', 5000, 0)).toBe(5000);
  });
});

describe('priorSalaryForJob', () => {
  const list = [
    sal('a', '2023-01', 600000, 'j1'),
    sal('b', '2024-01', 650000, 'j1'),
    sal('c', '2024-01', 400000, 'j2'),
  ];

  it('returns the latest same-job salary strictly before the month', () => {
    expect(priorSalaryForJob(list, 'j1', '2025-01')?.grossAnnual).toBe(650000);
  });

  it('is strictly-before: a same-month entry is not the prior', () => {
    expect(priorSalaryForJob(list, 'j1', '2024-01')?.grossAnnual).toBe(600000);
  });

  it('excludes the entry being edited', () => {
    expect(priorSalaryForJob(list, 'j1', '2025-01', 'b')?.grossAnnual).toBe(600000);
  });

  it('ignores other jobs and returns null when none earlier', () => {
    expect(priorSalaryForJob(list, 'j2', '2024-01')).toBeNull();
    expect(priorSalaryForJob(list, 'j1', '2022-01')).toBeNull();
  });
});

describe('activeJobBreakdown', () => {
  const j = (id: string, startDate: string, endDate: string | null, onCallAnnual: number | null = null): JobEntry => ({
    id, startDate, endDate, employer: 'Acme', role: id, contractedHoursPerWeek: 37.5, onCallAnnual,
  });

  it('excludes a job that ended before the month', () => {
    const b = activeJobBreakdown(
      [sal('s1', '2023-08', 690_000, 'old'), sal('s2', '2026-01', 740_000, 'new')],
      [j('old', '2023-08', '2026-01'), j('new', '2026-01', null)],
      '2026-07',
    );
    expect(b.map(c => c.jobId)).toEqual(['new']);
  });

  it('adds on-call to the job it belongs to', () => {
    const b = activeJobBreakdown([sal('s1', '2026-01', 810_000, 'a')], [j('a', '2026-01', null, 100_000)], '2026-07');
    expect(b[0]).toMatchObject({ base: 810_000, onCall: 100_000, gross: 910_000 });
  });

  it('reports both jobs when an old end date overlaps a new job', () => {
    // The real-world shape: a job change entered without shortening the old
    // job's end date, so two salaries are counted at once.
    const b = activeJobBreakdown(
      [sal('s1', '2026-07', 810_000, 'old'), sal('s2', '2026-07', 925_000, 'new')],
      [j('old', '2026-01', '2027-06', 100_000), j('new', '2026-07', '2027-06')],
      '2026-07',
    );
    expect(b).toHaveLength(2);
    expect(b.reduce((t, c) => t + c.gross, 0)).toBe(1_835_000);
  });

  it('skips a job whose salary has not taken effect yet', () => {
    const b = activeJobBreakdown([sal('s1', '2027-01', 900_000, 'future')], [j('future', '2027-01', null)], '2026-07');
    expect(b).toEqual([]);
  });

  it('keeps a salary whose job record is gone (no end date to disqualify it)', () => {
    const b = activeJobBreakdown([sal('s1', '2026-01', 500_000, 'orphan')], [], '2026-07');
    expect(b).toHaveLength(1);
    expect(b[0].job).toBeUndefined();
    expect(b[0].onCall).toBe(0);
  });
});


describe('salaryVsCpiYoy', () => {
  /** 13+ months where every point carries a CPI index. */
  const withCpi = (n: number, cpiAt: (i: number) => number | undefined) =>
    Array.from({ length: n }, (_, i) => ({ totalAnnual: 600000, cpiIndex: cpiAt(i) }));

  it('is null when the series cannot span a year', () => {
    expect(salaryVsCpiYoy(withCpi(12, () => 100))).toBeNull();
  });

  it('computes salary growth over the trailing 12 months', () => {
    const s = withCpi(13, () => 100);
    s[0].totalAnnual = 600000;
    s[12].totalAnnual = 660000;
    expect(salaryVsCpiYoy(s)!.salary).toBeCloseTo(10, 6);
  });

  it('anchors CPI on the newest month that has an index', () => {
    // The regression: SSB publishes ~2 months late, so the final points have no
    // cpiIndex. Reading the last point gave undefined, which was treated as 0 —
    // reporting "CPI +0.0%" and overstating the beats-CPI gap.
    const s = withCpi(15, i => (i >= 13 ? undefined : 100 + i));
    // Newest indexed point is i=12 (112); its 12-months-prior is i=0 (100).
    expect(salaryVsCpiYoy(s)!.cpi).toBeCloseTo(12, 6);
  });

  it('reports real inflation rather than 0 when the tail is unpublished', () => {
    // Two unpublished trailing months over a series where CPI rose 3%. The old
    // code read the final (indexless) point and reported +0.0%.
    const s = withCpi(15, i => (i >= 13 ? undefined : (i === 12 ? 103 : 100)));
    expect(salaryVsCpiYoy(s)!.cpi).toBeCloseTo(3, 6);
  });

  it('is null for cpi when no pair 12 months apart has both indices', () => {
    const s = withCpi(13, i => (i === 12 ? 110 : undefined));
    expect(salaryVsCpiYoy(s)!.cpi).toBeNull();
  });

  it('still reports salary growth when CPI is unavailable', () => {
    const s = withCpi(13, () => undefined);
    s[0].totalAnnual = 500000;
    s[12].totalAnnual = 550000;
    const r = salaryVsCpiYoy(s)!;
    expect(r.cpi).toBeNull();
    expect(r.salary).toBeCloseTo(10, 6);
  });

  it('guards against a zero prior salary instead of dividing by it', () => {
    const s = withCpi(13, () => 100);
    s[0].totalAnnual = 0;
    expect(salaryVsCpiYoy(s)!.salary).toBe(0);
  });
});
