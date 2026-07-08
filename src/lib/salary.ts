import type { SalaryEntry, JobEntry, HoursSnapshot } from '../context/FinanceContext';

/** Average weeks in a month (52 / 12), for converting weekly hours to monthly. */
export const WEEKS_PER_MONTH = 4.345;

/**
 * Nominal hourly rate: a month's total pay (base + on-call) over the hours
 * worked that month. On-call is regular pay for hours on rotation, so it counts.
 * Returns 0 when hours are non-positive (avoids divide-by-zero).
 */
export function nominalHourlyRate(monthlyGross: number, onCallMonthly: number, hoursPerWeek: number): number {
  if (hoursPerWeek <= 0) return 0;
  return (monthlyGross + onCallMonthly) / (WEEKS_PER_MONTH * hoursPerWeek);
}

/** Most recent salary in effect at the given month (inclusive), or null if none. */
export function salaryAt(month: string, salaries: SalaryEntry[]): SalaryEntry | null {
  const eligible = salaries.filter(s => s.effectiveDate <= month);
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (a.effectiveDate > b.effectiveDate ? a : b));
}

/**
 * Most recent hours snapshot at the given month; falls back to the contracted
 * hours of the active salary's job, then to a 37.5h default.
 *
 * A snapshot assigned to a specific job (`jobId`) only applies while that job is
 * the active one — otherwise an old job's part-time snapshot would leak into a
 * later, unrelated job's hourly maths. Unassigned snapshots (`jobId` undefined)
 * are global and apply to whichever job is active.
 */
export function hoursAt(
  month: string,
  hoursSnapshots: HoursSnapshot[],
  jobs: JobEntry[],
  salary: SalaryEntry | null,
): number {
  const jobId = salary?.jobId;
  const snap = hoursSnapshots
    .filter(h => h.periodMonth <= month && (h.jobId == null || h.jobId === jobId))
    .reduce<HoursSnapshot | null>((a, b) => (a && a.periodMonth > b.periodMonth ? a : b), null);
  if (snap) return snap.actualHoursPerWeek;
  if (salary) {
    const job = jobs.find(j => j.id === salary.jobId);
    if (job) return job.contractedHoursPerWeek;
  }
  return 37.5;
}
