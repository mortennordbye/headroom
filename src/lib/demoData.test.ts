import { describe, it, expect } from 'vitest';
import { getDemoData } from './demoData';
import { activeJobBreakdown } from './salary';
import { currentMonthKey } from './date';

// The demo's career history is hand-authored, and the one thing easy to get
// wrong is the handoff between jobs: activeJobBreakdown treats `endDate` as
// inclusive, so a job ending the same month the next one starts counts BOTH and
// silently doubles that month's gross. These tests pin the invariants so the
// dataset can be edited without reintroducing that.

const demo = getDemoData();
const jobs = demo.jobs ?? [];
const salaries = demo.salaries ?? [];

/** Every 'YYYY-MM' from the earliest job start through the current month. */
function everyCareerMonth(): string[] {
  const starts = jobs.map(j => j.startDate).sort();
  const [y, m] = starts[0].split('-').map(Number);
  const out: string[] = [];
  const end = currentMonthKey();
  for (const d = new Date(y, m - 1, 1); ; d.setMonth(d.getMonth() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(key);
    if (key >= end) break;
  }
  return out;
}

describe('demo career history', () => {
  it('spans three employers with only the last one open-ended', () => {
    expect(jobs).toHaveLength(3);
    expect(jobs.filter(j => j.endDate === null)).toHaveLength(1);
    expect(jobs.at(-1)?.endDate).toBeNull();
  });

  it('never has two jobs active in the same month', () => {
    const overlaps = everyCareerMonth()
      .map(month => ({ month, active: activeJobBreakdown(salaries, jobs, month) }))
      .filter(r => r.active.length > 1);
    expect(overlaps.map(r => `${r.month}: ${r.active.map(a => a.jobId).join(' + ')}`)).toEqual([]);
  });

  it('leaves no month without income once the career has started', () => {
    const gaps = everyCareerMonth().filter(m => activeJobBreakdown(salaries, jobs, m).length === 0);
    expect(gaps).toEqual([]);
  });

  it('keeps the present-day figures at the current job alone', () => {
    const active = activeJobBreakdown(salaries, jobs, currentMonthKey());
    expect(active).toHaveLength(1);
    expect(active[0].jobId).toBe('demo-job-3');
    expect(active[0].base).toBe(744000);
    expect(active[0].onCall).toBe(24000);
    expect(active[0].gross).toBe(768000);
  });

  it('rises monotonically across the whole career', () => {
    const byDate = [...salaries].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const grosses = byDate.map(s => s.grossAnnual);
    expect(grosses).toEqual([...grosses].sort((a, b) => a - b));
    expect(grosses.at(0)).toBe(455000);
    expect(grosses.at(-1)).toBe(744000);
  });

  it('opens each job with an initial or job_change entry', () => {
    for (const job of jobs) {
      const first = salaries
        .filter(s => s.jobId === job.id)
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0];
      expect(first, `job ${job.id} has no salary`).toBeDefined();
      expect(['initial', 'job_change']).toContain(first.changeType);
      expect(first.effectiveDate).toBe(job.startDate);
    }
  });
});

describe('demo salary extras', () => {
  const jobIds = new Set(jobs.map(j => j.id));

  it('points every bonus, overtime and hours row at a real job', () => {
    const dangling = [
      ...(demo.bonuses ?? []).map(b => ({ kind: 'bonus', id: b.id, jobId: b.jobId })),
      ...(demo.overtime ?? []).map(o => ({ kind: 'overtime', id: o.id, jobId: o.jobId })),
      ...(demo.hoursSnapshots ?? []).map(h => ({ kind: 'hours', id: h.id, jobId: h.jobId })),
    ].filter(r => r.jobId !== undefined && !jobIds.has(r.jobId));
    expect(dangling).toEqual([]);
  });

  it('keeps bonuses and overtime out of the budget', () => {
    // includeInBudget unset — these enrich the salary views without inflating
    // the demo's monthly income.
    expect((demo.bonuses ?? []).some(b => b.includeInBudget)).toBe(false);
    expect((demo.overtime ?? []).some(o => o.includeInBudget)).toBe(false);
  });

  it('records hours that actually vary against the 37.5 contract', () => {
    const hrs = (demo.hoursSnapshots ?? []).map(h => h.actualHoursPerWeek);
    expect(hrs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(hrs).size).toBeGreaterThan(1);
    expect(hrs.some(h => h > 37.5)).toBe(true);
    expect(hrs.some(h => h < 37.5)).toBe(true);
  });

  it('dates every bonus and overtime row as a real calendar day', () => {
    for (const d of [...(demo.bonuses ?? []).map(b => b.date), ...(demo.overtime ?? []).map(o => o.date)]) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(d))).toBe(false);
    }
  });
});

describe('demo transaction ledger', () => {
  const txs = demo.dailyTransactions ?? [];

  it('never dates a transaction in the future', () => {
    // The demo is opened on an arbitrary day; spending that hasn't happened yet
    // would be visible nonsense.
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(txs.filter(t => t.date > todayKey)).toEqual([]);
  });

  it('populates the current month, whatever day it is opened', () => {
    // The regression this guards: fixed day-of-month dates clamped to "today"
    // left the Budget page empty when the demo was opened early in a month.
    const thisMonth = currentMonthKey();
    expect(txs.filter(t => t.date.startsWith(thisMonth)).length).toBeGreaterThan(0);
  });

  it('fills the previous two months completely', () => {
    const now = new Date();
    for (const back of [1, 2]) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const inMonth = txs.filter(t => t.date.startsWith(key));
      expect(inMonth.length, `month ${key}`).toBeGreaterThanOrEqual(28);
    }
  });

  it('spreads across the categories the budget page charts', () => {
    const cats = new Set(txs.map(t => t.category));
    for (const c of ['groceries', 'dining', 'transport', 'health', 'entertainment', 'shopping', 'utilities', 'subscriptions', 'transfers']) {
      expect(cats, `missing category ${c}`).toContain(c);
    }
  });

  it('includes money-in rows so the income/expense split is visible', () => {
    expect(txs.filter(t => t.kind === 'income').length).toBeGreaterThan(0);
  });

  it('tags every row with an account that accountLabels names', () => {
    const labels = demo.accountLabels ?? {};
    const accounts = new Set(txs.map(t => t.account));
    expect(accounts.has(undefined)).toBe(false);
    for (const a of accounts) expect(Object.keys(labels)).toContain(a);
  });

  it('is deterministic — two calls produce identical data', () => {
    // Amounts are varied by index rather than Math.random precisely so the demo
    // looks the same on every load and these assertions can't drift.
    expect(JSON.stringify(getDemoData().dailyTransactions))
      .toBe(JSON.stringify(getDemoData().dailyTransactions));
  });

  it('gives every unique id', () => {
    const ids = txs.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
