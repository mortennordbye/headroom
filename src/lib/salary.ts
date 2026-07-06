import type { SalaryEntry, JobEntry, HoursSnapshot } from '../context/FinanceContext';

/** Most recent salary in effect at the given month (inclusive), or null if none. */
export function salaryAt(month: string, salaries: SalaryEntry[]): SalaryEntry | null {
  const eligible = salaries.filter(s => s.effectiveDate <= month);
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (a.effectiveDate > b.effectiveDate ? a : b));
}

/**
 * Most recent hours snapshot at the given month; falls back to the contracted
 * hours of the active salary's job, then to a 37.5h default.
 */
export function hoursAt(
  month: string,
  hoursSnapshots: HoursSnapshot[],
  jobs: JobEntry[],
  salary: SalaryEntry | null,
): number {
  const snap = hoursSnapshots
    .filter(h => h.periodMonth <= month)
    .reduce<HoursSnapshot | null>((a, b) => (a && a.periodMonth > b.periodMonth ? a : b), null);
  if (snap) return snap.actualHoursPerWeek;
  if (salary) {
    const job = jobs.find(j => j.id === salary.jobId);
    if (job) return job.contractedHoursPerWeek;
  }
  return 37.5;
}
