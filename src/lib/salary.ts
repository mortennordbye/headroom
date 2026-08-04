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

/** One job's contribution to a month's gross employment income. */
export interface ActiveJobContribution {
  jobId: string;
  /** The job record, when one still exists for this salary's `jobId`. */
  job: JobEntry | undefined;
  /** Gross annual base salary in effect that month. */
  base: number;
  /** On-call annual attached to the job (0 when none). */
  onCall: number;
  /** base + onCall — what this job adds to the month's gross. */
  gross: number;
}

/**
 * Every job contributing gross employment income in `monthKey`: the latest
 * applicable salary PER job, for each job that hasn't ended before this month.
 *
 * This is the single source of truth for "which jobs count this month" —
 * `calcActiveGrossAnnual` sums it, and the overlap warning reads it, so the
 * warning can never disagree with the figure it is warning about.
 *
 * A salary whose `jobId` has no job record still counts (there is no end date to
 * disqualify it), matching the long-standing behaviour.
 */
export function activeJobBreakdown(
  salaries: SalaryEntry[],
  jobs: JobEntry[],
  monthKey: string,
): ActiveJobContribution[] {
  const out: ActiveJobContribution[] = [];
  for (const jobId of new Set(salaries.map(s => s.jobId))) {
    const sal = salaryAt(monthKey, salaries.filter(s => s.jobId === jobId));
    if (!sal) continue;
    const job = jobs.find(j => j.id === jobId);
    if (job?.endDate && job.endDate < monthKey) continue;
    const base = sal.grossAnnual;
    const onCall = job?.onCallAnnual ?? 0;
    out.push({ jobId, job, base, onCall, gross: base + onCall });
  }
  return out;
}

/** How a salary-change amount is entered when recording a raise/adjustment. */
export type SalaryEntryMode = 'percent' | 'kr' | 'total';

/**
 * The new gross annual for a salary change, given the entry mode and the prior
 * salary it builds on. `percent` grows `prevGross` by `amount`%, `kr` adds
 * `amount` kroner, `total` uses `amount` verbatim. Rounded to whole kroner.
 * `prevGross` is ignored in `total` mode (used when there is no prior salary).
 */
export function computeNewGross(mode: SalaryEntryMode, amount: number, prevGross: number): number {
  if (mode === 'total') return Math.round(amount);
  if (mode === 'kr') return Math.round(prevGross + amount);
  return Math.round(prevGross * (1 + amount / 100));
}

/**
 * The salary entry a raise builds on: the latest one for a job strictly before
 * `month`, ignoring `excludeId` (the entry being edited). Null when the job has
 * no earlier salary — i.e. this is its first (initial) entry.
 */
export function priorSalaryForJob(
  salaries: SalaryEntry[],
  jobId: string,
  month: string,
  excludeId?: string,
): SalaryEntry | null {
  const earlier = salaries.filter(
    s => s.jobId === jobId && s.id !== excludeId && s.effectiveDate < month,
  );
  if (earlier.length === 0) return null;
  return earlier.reduce((a, b) => (a.effectiveDate > b.effectiveDate ? a : b));
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

/** One month of the salary series, as far as the CPI comparison is concerned. */
export interface SalaryCpiPoint {
  totalAnnual: number;
  /**
   * SSB's CPI index for the month. Null/absent for months SSB hasn't published
   * yet — both spellings occur across the callers, and both are falsy, which is
   * exactly what the pairing check below tests for.
   */
  cpiIndex?: number | null;
}

/**
 * Year-over-year salary growth, and the CPI growth to compare it against.
 *
 * The CPI side is anchored on the newest month that actually HAS an index,
 * not on the newest month of the series. SSB publishes a month's CPI about ten
 * days after that month ends, so the last month or two of the series never has
 * one. Reading `cpiIndex` straight off the final point yields undefined, and
 * treating that as 0 asserts that inflation was flat — which silently inflates
 * the "beats CPI" gap and states something false about the user's money.
 *
 * `cpi` is null when no comparable pair exists, so callers can omit the
 * comparison rather than present a wrong one. Returns null when the series is
 * too short to span a year.
 */
export function salaryVsCpiYoy(series: SalaryCpiPoint[]): { salary: number; cpi: number | null } | null {
  if (series.length < 13) return null;
  const last = series[series.length - 1];
  const prior = series[series.length - 13];
  const salary = prior.totalAnnual > 0 ? ((last.totalAnnual / prior.totalAnnual) - 1) * 100 : 0;

  let cpi: number | null = null;
  for (let i = series.length - 1; i >= 12; i--) {
    const now = series[i].cpiIndex;
    const then = series[i - 12].cpiIndex;
    if (now && then) { cpi = ((now / then) - 1) * 100; break; }
  }
  return { salary, cpi };
}
