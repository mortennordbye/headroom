import { describe, it, expect } from 'vitest';
import { salaryAt, hoursAt } from './salary';
import type { SalaryEntry, JobEntry, HoursSnapshot } from '../context/FinanceContext';

const sal = (id: string, effectiveDate: string, grossAnnual: number, jobId = 'j1'): SalaryEntry => ({
  id, jobId, effectiveDate, grossAnnual, changeType: 'raise',
});
const job = (id: string, contractedHoursPerWeek: number): JobEntry => ({
  id, startDate: '2020-01', endDate: null, employer: 'Acme', role: 'Dev', contractedHoursPerWeek,
});
const snap = (id: string, periodMonth: string, actualHoursPerWeek: number): HoursSnapshot => ({
  id, periodMonth, actualHoursPerWeek,
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
});
